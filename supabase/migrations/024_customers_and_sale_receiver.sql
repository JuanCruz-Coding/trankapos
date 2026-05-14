-- =====================================================================
-- Migration 024: tabla customers + snapshot de receptor en sales
-- =====================================================================
-- Sprint A3.2 — mini-CRM para emitir Factura A (receptor identificado).
--
-- Modelo:
--   - tabla `customers`: CRM básico (CUIT/nombre/cond IVA). El cliente
--     recurrente vive acá y se reutiliza vía autocomplete en POS.
--   - columnas `customer_*` en `sales`: SNAPSHOT del receptor en el momento
--     de la venta. Si después editan al customer, las facturas viejas no
--     mutan (snapshot pattern, mismo que `sale_items.name`/`barcode`).
--   - una venta puede tener customer_id (referencia) + snapshot, solo
--     snapshot (cliente "inline" que no se guarda), o ningún customer (anónimo).
--
-- Extensión de `create_sale_atomic` para aceptar los campos del receptor.
-- Los parámetros nuevos van al final con DEFAULT NULL → llamadas viejas
-- siguen funcionando sin tocar nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabla customers
-- ---------------------------------------------------------------------
-- doc_type: smallint con códigos AFIP (80=CUIT, 86=CUIL, 96=DNI).
-- doc_number: solo dígitos, validamos con CHECK y módulo 11 en frontend.
-- iva_condition: texto libre con CHECK contra valores conocidos. Reusa
--   los mismos valores que tenants.tax_condition + 'no_categorizado'
--   (que existe en AFIP pero no como condición del tenant emisor).

create table public.customers (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  doc_type        smallint not null,
  doc_number      text not null,
  legal_name      text not null,
  iva_condition   text not null,
  email           text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint customers_doc_type_check
    check (doc_type in (80, 86, 96)),
  constraint customers_doc_number_format
    check (doc_number ~ '^[0-9]+$'),
  constraint customers_iva_condition_check
    check (iva_condition in (
      'responsable_inscripto',
      'monotributista',
      'exento',
      'consumidor_final',
      'no_categorizado'
    )),
  constraint customers_legal_name_not_empty
    check (length(trim(legal_name)) > 0)
);

-- Un mismo doc no puede repetirse activo dentro de un tenant.
-- (al hacer "desactivar" en lugar de borrar, pueden quedar duplicados
-- inactivos — eso es OK).
create unique index customers_doc_unique
  on public.customers (tenant_id, doc_type, doc_number)
  where active;

-- Búsquedas típicas en POS
create index customers_tenant_active_name_idx
  on public.customers (tenant_id, active, legal_name text_pattern_ops);
create index customers_tenant_doc_idx
  on public.customers (tenant_id, doc_number);

comment on table public.customers is
  'CRM básico de clientes para emitir Factura A/B identificada. Snapshot del receptor se guarda en sales.customer_* para no perder datos si se edita.';


-- ---------------------------------------------------------------------
-- 2. Snapshot del receptor en sales
-- ---------------------------------------------------------------------
alter table public.sales
  add column if not exists customer_id          uuid references public.customers(id) on delete set null,
  add column if not exists customer_doc_type    smallint,
  add column if not exists customer_doc_number  text,
  add column if not exists customer_legal_name  text,
  add column if not exists customer_iva_condition text;

create index if not exists sales_customer_idx
  on public.sales (customer_id)
  where customer_id is not null;

comment on column public.sales.customer_id is
  'FK opcional al customer. Puede ser NULL si la venta fue "inline" (sin guardar customer) o totalmente anónima.';
comment on column public.sales.customer_legal_name is
  'Snapshot del nombre del receptor al momento de la venta. Independiente de customers.legal_name (que puede cambiar después).';


-- ---------------------------------------------------------------------
-- 3. RLS — customers
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;

-- SELECT/INSERT/UPDATE/DELETE: cualquier autenticado del tenant.
-- (Si en el futuro querés restringir, agregar permission key manage_customers
-- y filtrar acá.)
drop policy if exists "customers_tenant_select" on public.customers;
create policy "customers_tenant_select"
on public.customers
for select to authenticated
using (tenant_id = public.tenant_id());

drop policy if exists "customers_tenant_insert" on public.customers;
create policy "customers_tenant_insert"
on public.customers
for insert to authenticated
with check (tenant_id = public.tenant_id());

drop policy if exists "customers_tenant_update" on public.customers;
create policy "customers_tenant_update"
on public.customers
for update to authenticated
using (tenant_id = public.tenant_id())
with check (tenant_id = public.tenant_id());

drop policy if exists "customers_tenant_delete" on public.customers;
create policy "customers_tenant_delete"
on public.customers
for delete to authenticated
using (tenant_id = public.tenant_id());


-- Trigger updated_at
create or replace function public.customers_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_customers_updated_at on public.customers;
create trigger tr_customers_updated_at
before update on public.customers
for each row execute function public.customers_touch_updated_at();


-- ---------------------------------------------------------------------
-- 4. Extender create_sale_atomic
-- ---------------------------------------------------------------------
-- Agregamos parámetros opcionales al final. Llamadas existentes (sin
-- estos params) siguen funcionando porque tienen DEFAULT NULL.
--
-- Si p_customer_id viene seteado, validamos que pertenezca al tenant.
-- Para el snapshot, priorizamos los campos explícitos p_customer_doc_*.
-- Si no vienen pero hay p_customer_id, leemos del customer.
-- Si nada viene, la sale queda anónima (todos los campos NULL).

create or replace function public.create_sale_atomic(
  p_tenant_id              uuid,
  p_branch_id              uuid,
  p_register_id            uuid,
  p_discount               numeric,
  p_items                  jsonb,
  p_payments               jsonb,
  p_partial                boolean default false,
  p_customer_id            uuid default null,
  p_customer_doc_type      smallint default null,
  p_customer_doc_number    text default null,
  p_customer_legal_name    text default null,
  p_customer_iva_condition text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id            uuid;
  v_warehouse_id       uuid;
  v_subtotal           numeric := 0;
  v_total              numeric;
  v_paid               numeric := 0;
  v_user_id            uuid := auth.uid();
  v_item               jsonb;
  v_payment            jsonb;
  v_product_id         uuid;
  v_qty                numeric;
  v_price              numeric;
  v_item_discount      numeric;
  v_subtotal_item      numeric;
  v_product_name       text;
  v_track_stock        boolean;
  v_allow_zero         boolean;
  v_stock_qty          numeric;
  v_stock_reserved     numeric;
  v_available          numeric;
  v_max_discount_pct   numeric;
  v_allow_negative     boolean;
  v_partial_reserves   boolean;
  v_line_pct           numeric;
  v_global_pct         numeric;
  v_status             sale_status;
  v_stock_mode         boolean;
  -- Snapshot del receptor: resueltos antes del INSERT
  v_cust_doc_type      smallint;
  v_cust_doc_number    text;
  v_cust_legal_name    text;
  v_cust_iva_cond      text;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'El tenant_id no coincide con la sesión actual'
      using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if coalesce(p_discount, 0) < 0 then
    raise exception 'El descuento global no puede ser negativo';
  end if;

  -- Resolver snapshot del receptor.
  -- Caso 1: viene customer_id → validamos pertenencia y, si no hay snapshot
  --         explícito, leemos del customer.
  -- Caso 2: no viene customer_id pero sí snapshot → cliente "inline".
  -- Caso 3: nada → todo NULL (venta anónima).
  if p_customer_id is not null then
    select doc_type, doc_number, legal_name, iva_condition
      into v_cust_doc_type, v_cust_doc_number, v_cust_legal_name, v_cust_iva_cond
      from customers
     where id = p_customer_id and tenant_id = p_tenant_id and active;
    if v_cust_doc_type is null then
      raise exception 'Cliente no encontrado o inactivo';
    end if;
    -- Si el caller mandó snapshot explícito, esos prevalecen (permite
    -- overrides puntuales sin tocar el customer).
    v_cust_doc_type   := coalesce(p_customer_doc_type, v_cust_doc_type);
    v_cust_doc_number := coalesce(p_customer_doc_number, v_cust_doc_number);
    v_cust_legal_name := coalesce(p_customer_legal_name, v_cust_legal_name);
    v_cust_iva_cond   := coalesce(p_customer_iva_condition, v_cust_iva_cond);
  elsif p_customer_doc_number is not null or p_customer_legal_name is not null then
    -- Cliente inline: snapshot directo
    v_cust_doc_type   := p_customer_doc_type;
    v_cust_doc_number := p_customer_doc_number;
    v_cust_legal_name := p_customer_legal_name;
    v_cust_iva_cond   := p_customer_iva_condition;
    -- Validaciones mínimas para inline (la tabla customers tiene CHECK
    -- equivalentes; acá replicamos las clave porque el dato va directo a sales).
    if v_cust_doc_type is not null and v_cust_doc_type not in (80, 86, 96) then
      raise exception 'Tipo de documento inválido para el receptor';
    end if;
    if v_cust_doc_number is not null and v_cust_doc_number !~ '^[0-9]+$' then
      raise exception 'Número de documento inválido (solo dígitos)';
    end if;
  end if;

  -- Settings del tenant
  select pos_max_discount_percent, pos_allow_negative_stock, pos_partial_reserves_stock
    into v_max_discount_pct, v_allow_negative, v_partial_reserves
    from tenants
   where id = p_tenant_id;

  v_stock_mode := coalesce(p_partial, false) and coalesce(v_partial_reserves, false);

  select id into v_warehouse_id
  from warehouses
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and is_default = true
    and active = true;

  if v_warehouse_id is null then
    raise exception 'La sucursal no tiene un depósito principal configurado';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id    := (v_item->>'product_id')::uuid;
    v_qty           := (v_item->>'qty')::numeric;
    v_price         := (v_item->>'price')::numeric;
    v_item_discount := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'Cantidad inválida (debe ser > 0)';
    end if;
    if v_price < 0 then
      raise exception 'Precio inválido (debe ser >= 0)';
    end if;
    if v_item_discount < 0 then
      raise exception 'Descuento de línea inválido';
    end if;

    if v_price * v_qty > 0 then
      v_line_pct := (v_item_discount / (v_price * v_qty)) * 100;
      if v_line_pct > v_max_discount_pct then
        raise exception 'El descuento de línea (%.2f%%) supera el tope del comercio (%.2f%%)',
          v_line_pct, v_max_discount_pct;
      end if;
    end if;

    v_subtotal_item := round(v_price * v_qty - v_item_discount, 2);
    if v_subtotal_item < 0 then
      raise exception 'El descuento de una línea supera el subtotal';
    end if;
    v_subtotal := v_subtotal + v_subtotal_item;

    select track_stock, allow_sale_when_zero, name
      into v_track_stock, v_allow_zero, v_product_name
      from products
     where id = v_product_id and tenant_id = p_tenant_id;

    if v_product_name is null then
      raise exception 'Producto no encontrado';
    end if;

    if v_track_stock then
      select coalesce(qty, 0), coalesce(qty_reserved, 0)
        into v_stock_qty, v_stock_reserved
        from stock_items
       where tenant_id = p_tenant_id
         and warehouse_id = v_warehouse_id
         and product_id = v_product_id;

      v_available := coalesce(v_stock_qty, 0) - coalesce(v_stock_reserved, 0);

      if not v_allow_zero and not v_allow_negative and v_available < v_qty then
        raise exception 'Stock insuficiente para %', v_product_name;
      end if;

      if v_stock_mode then
        if exists (
          select 1 from stock_items
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id
        ) then
          update stock_items
             set qty_reserved = coalesce(qty_reserved, 0) + v_qty, updated_at = now()
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty, qty_reserved)
          values (p_tenant_id, v_warehouse_id, v_product_id, 0, 0, v_qty);
        end if;
      else
        if exists (
          select 1 from stock_items
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id
        ) then
          update stock_items
             set qty = qty - v_qty, updated_at = now()
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
          values (p_tenant_id, v_warehouse_id, v_product_id, -v_qty, 0);
        end if;
      end if;
    end if;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then
    raise exception 'El descuento global supera el subtotal';
  end if;

  if v_subtotal > 0 then
    v_global_pct := (coalesce(p_discount, 0) / v_subtotal) * 100;
    if v_global_pct > v_max_discount_pct then
      raise exception 'El descuento global (%.2f%%) supera el tope del comercio (%.2f%%)',
        v_global_pct, v_max_discount_pct;
    end if;
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_payment->>'amount')::numeric;
  end loop;

  if coalesce(p_partial, false) then
    if v_paid <= 0 then
      raise exception 'Una seña debe tener al menos un pago';
    end if;
    if v_paid > v_total then
      raise exception 'El pago de la seña (%) no puede superar el total (%)', v_paid, v_total;
    end if;
    if abs(v_paid - v_total) <= 0.005 then
      v_status := 'paid';
      v_stock_mode := false;
    else
      v_status := 'partial';
    end if;
  else
    if abs(v_paid - v_total) > 0.005 then
      raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
    end if;
    v_status := 'paid';
  end if;

  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided, status, stock_reserved_mode,
    customer_id, customer_doc_type, customer_doc_number,
    customer_legal_name, customer_iva_condition
  ) values (
    p_tenant_id, p_branch_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false, v_status, v_stock_mode,
    p_customer_id, v_cust_doc_type, v_cust_doc_number,
    v_cust_legal_name, v_cust_iva_cond
  )
  returning id into v_sale_id;

  insert into sale_items (
    sale_id, tenant_id, product_id, name, barcode,
    price, qty, discount, subtotal
  )
  select
    v_sale_id, p_tenant_id, p.id, p.name, p.barcode,
    (it->>'price')::numeric,
    (it->>'qty')::numeric,
    coalesce((it->>'discount')::numeric, 0),
    round(
      (it->>'price')::numeric * (it->>'qty')::numeric
      - coalesce((it->>'discount')::numeric, 0),
      2
    )
  from jsonb_array_elements(p_items) it
  join products p on p.id = (it->>'product_id')::uuid;

  insert into sale_payments (sale_id, tenant_id, method, amount)
  select v_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  return v_sale_id;
end;
$$;
