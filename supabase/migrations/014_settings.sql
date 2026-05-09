-- =====================================================================
-- Migration 014: configuración del comercio (Sprint Settings)
-- =====================================================================
-- Suma columnas configurables en 4 tablas para que el dueño pueda
-- ajustar el comportamiento del POS sin tocar código:
--
--   tenants    → datos fiscales + ticket + reglas de POS + stock global
--   branches   → datos de contacto de la sucursal (phone, email)
--   warehouses → toggles por depósito (participa en ventas, alertas)
--   products   → control granular de stock por producto
--
-- También actualiza create_sale_atomic para que respete las nuevas
-- reglas: track_stock, allow_sale_when_zero, pos_allow_negative_stock,
-- pos_max_discount_percent.
--
-- IDempotente: usa ADD COLUMN IF NOT EXISTS y CREATE TYPE IF NOT EXISTS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Enum tax_condition_type (condición frente al IVA en AR)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tax_condition_type') then
    create type public.tax_condition_type as enum (
      'responsable_inscripto',
      'monotributista',
      'exento',
      'consumidor_final'
    );
  end if;
end$$;


-- ---------------------------------------------------------------------
-- 2. tenants → datos fiscales + ticket + reglas POS + stock
-- ---------------------------------------------------------------------
alter table public.tenants
  -- Empresa / fiscal
  add column if not exists legal_name      text not null default '',
  add column if not exists tax_id          text not null default '',
  add column if not exists tax_condition   tax_condition_type not null default 'monotributista',
  add column if not exists legal_address   text not null default '',
  add column if not exists phone           text not null default '',
  add column if not exists email           text not null default '',
  -- Ticket / impresión
  add column if not exists ticket_title       text     not null default 'Comprobante no fiscal',
  add column if not exists ticket_footer      text     not null default '¡Gracias por su compra!',
  add column if not exists ticket_show_logo   boolean  not null default true,
  add column if not exists ticket_show_tax_id boolean  not null default true,
  add column if not exists ticket_width_mm    smallint not null default 80,
  -- POS / venta
  add column if not exists pos_allow_negative_stock  boolean       not null default false,
  add column if not exists pos_max_discount_percent  numeric(5,2)  not null default 100,
  add column if not exists pos_round_to              numeric(8,2)  not null default 1,
  add column if not exists pos_require_customer      boolean       not null default false,
  -- Stock
  add column if not exists stock_alerts_enabled boolean not null default true;

-- Backfill: legal_name = name si quedó vacío
update public.tenants
set legal_name = name
where legal_name = '';

-- Constraints suaves
alter table public.tenants
  drop constraint if exists tenants_ticket_width_mm_check;
alter table public.tenants
  add constraint tenants_ticket_width_mm_check
  check (ticket_width_mm in (58, 80));

alter table public.tenants
  drop constraint if exists tenants_pos_max_discount_check;
alter table public.tenants
  add constraint tenants_pos_max_discount_check
  check (pos_max_discount_percent >= 0 and pos_max_discount_percent <= 100);

alter table public.tenants
  drop constraint if exists tenants_pos_round_to_check;
alter table public.tenants
  add constraint tenants_pos_round_to_check
  check (pos_round_to > 0);

comment on column public.tenants.tax_condition is
  'Condición frente al IVA: responsable_inscripto, monotributista, exento, consumidor_final.';
comment on column public.tenants.ticket_width_mm is
  'Ancho del papel en mm (58 o 80). Define el formato de impresión.';
comment on column public.tenants.pos_allow_negative_stock is
  'Si true, permite vender aunque el stock_items.qty quede en negativo. Por producto se puede afinar con products.allow_sale_when_zero.';
comment on column public.tenants.pos_max_discount_percent is
  'Tope global del descuento (% sobre subtotal) que un cajero puede aplicar en una venta. 100 = sin tope.';
comment on column public.tenants.pos_round_to is
  'Múltiplo al que se redondea el total de la venta (ej. 1, 10, 100).';


-- ---------------------------------------------------------------------
-- 3. branches → contacto de la sucursal
-- ---------------------------------------------------------------------
alter table public.branches
  add column if not exists phone text not null default '',
  add column if not exists email text not null default '';


-- ---------------------------------------------------------------------
-- 4. warehouses → toggles por depósito
-- ---------------------------------------------------------------------
alter table public.warehouses
  add column if not exists participates_in_pos boolean not null default true,
  add column if not exists alert_low_stock     boolean not null default true;

comment on column public.warehouses.participates_in_pos is
  'Si true, el depósito puede actuar como source de stock en ventas. Hoy el POS resta del default; este flag se vuelve relevante cuando habilitemos POS multi-warehouse.';
comment on column public.warehouses.alert_low_stock is
  'Si true, este depósito participa de las alertas globales de stock mínimo (tenants.stock_alerts_enabled).';


-- ---------------------------------------------------------------------
-- 5. products → control de stock por producto
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists track_stock          boolean not null default true,
  add column if not exists allow_sale_when_zero boolean not null default false;

comment on column public.products.track_stock is
  'Si false, el producto no controla stock (ej. servicios). create_sale_atomic salta la validación de cantidad disponible.';
comment on column public.products.allow_sale_when_zero is
  'Si true, permite vender este producto aunque el stock sea 0 (queda en negativo). Override granular sobre tenants.pos_allow_negative_stock.';


-- ---------------------------------------------------------------------
-- 6. Recrear create_sale_atomic respetando las nuevas reglas.
-- ---------------------------------------------------------------------
-- Reglas nuevas:
--   - Si products.track_stock = false, no chequea stock ni descuenta.
--   - Si stock < qty pedida:
--       OK si products.allow_sale_when_zero = true
--       OK si tenants.pos_allow_negative_stock = true
--       sino → error 'stock insuficiente'
--   - Si descuento global > tenants.pos_max_discount_percent → error.
--   - Si descuento de línea > tenants.pos_max_discount_percent → error.

drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);

create or replace function public.create_sale_atomic(
  p_tenant_id    uuid,
  p_branch_id    uuid,
  p_register_id  uuid,
  p_discount     numeric,
  p_items        jsonb,
  p_payments     jsonb
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
  v_max_discount_pct   numeric;
  v_allow_negative     boolean;
  v_line_pct           numeric;
  v_global_pct         numeric;
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

  -- Settings del tenant relevantes para la venta
  select pos_max_discount_percent, pos_allow_negative_stock
    into v_max_discount_pct, v_allow_negative
    from tenants
   where id = p_tenant_id;

  -- Resolver warehouse default de la branch
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

    -- Validación de descuento de línea contra el tope global del tenant
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

    -- Lookup producto: track_stock + allow_sale_when_zero + name
    select track_stock, allow_sale_when_zero, name
      into v_track_stock, v_allow_zero, v_product_name
      from products
     where id = v_product_id and tenant_id = p_tenant_id;

    if v_product_name is null then
      raise exception 'Producto no encontrado';
    end if;

    -- Si el producto NO controla stock, no validamos ni descontamos
    if v_track_stock then
      select s.qty into v_stock_qty
        from stock_items s
       where s.tenant_id    = p_tenant_id
         and s.warehouse_id = v_warehouse_id
         and s.product_id   = v_product_id
       for update of s;

      if v_stock_qty is null then
        -- Sin fila de stock: tratamos como stock 0
        v_stock_qty := 0;
      end if;

      if v_stock_qty < v_qty then
        if not (v_allow_zero or v_allow_negative) then
          raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
            v_product_name, v_stock_qty, v_qty;
        end if;
      end if;

      -- Descontar stock (puede quedar negativo si la venta lo permite)
      if v_stock_qty is not null and v_stock_qty > 0 or v_stock_qty = 0 then
        -- Insert si no existía la fila + qty negativa permitida; sino update.
        if v_stock_qty = 0 then
          -- ¿hay fila? Re-chequear (puede haber sido null arriba).
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
        else
          update stock_items
             set qty = qty - v_qty, updated_at = now()
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id;
        end if;
      end if;
    end if;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then
    raise exception 'El descuento global supera el subtotal';
  end if;

  -- Validación de descuento global contra el tope del tenant
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
  if abs(v_paid - v_total) > 0.005 then
    raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
  end if;

  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided
  ) values (
    p_tenant_id, p_branch_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false
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

comment on function public.create_sale_atomic is
  'Crea una venta atómicamente. Respeta tenants.pos_allow_negative_stock + pos_max_discount_percent + products.track_stock + products.allow_sale_when_zero.';
