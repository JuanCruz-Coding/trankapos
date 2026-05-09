-- =====================================================================
-- Migration 018: señas / pagos parciales (status partial)
-- =====================================================================
-- Permite cobrar menos del total en una venta. La venta queda con
-- status = 'partial' y se completa después con add_payment_to_sale_atomic.
--
-- Modelo:
--   sale_status enum: 'paid' | 'partial'.
--   sales.status (default 'paid').
--   sales.stock_reserved_mode (bool): se setea al crear la venta con el
--     valor del flag tenants.pos_partial_reserves_stock. Lo guardamos en
--     la propia venta porque define cómo se mueve el stock — y el tenant
--     puede cambiar el flag más tarde, lo que confundiría al void.
--   stock_items.qty_reserved (numeric): tracking de stock apartado por
--     señas pendientes en modo reserva. Stock disponible = qty - qty_reserved.
--   tenants.pos_partial_reserves_stock (bool, default false): elige cómo
--     se mueve el stock al cobrar una seña.
--       false → "el cliente se lleva los productos": descuenta qty al instante.
--       true  → "reservar para retirar después": suma qty_reserved (qty queda).
--
-- RPCs:
--   create_sale_atomic acepta p_partial → si true: paid<total OK + setea
--     status='partial' + ramifica el stock según pos_partial_reserves_stock.
--   add_payment_to_sale_atomic(p_sale_id, p_payments): inserta pagos y, si
--     llegó al total, promueve a 'paid' (materializando stock si aplicaba).
--   void_sale_atomic: libera qty_reserved en lugar de sumar qty si la venta
--     estaba en modo reserva y todavía no se materializó.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. enum + columnas nuevas
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sale_status') then
    create type public.sale_status as enum ('paid', 'partial');
  end if;
end$$;

alter table public.sales
  add column if not exists status              sale_status not null default 'paid',
  add column if not exists stock_reserved_mode boolean     not null default false;

create index if not exists sales_partial_idx
  on public.sales (tenant_id, status)
  where status = 'partial';

alter table public.stock_items
  add column if not exists qty_reserved numeric(12,3) not null default 0;

alter table public.tenants
  add column if not exists pos_partial_reserves_stock boolean not null default false;

comment on column public.tenants.pos_partial_reserves_stock is
  'Si true, las señas reservan stock (no descuentan qty hasta cobrar el saldo). Si false, descuentan qty al instante (el cliente se lleva los productos).';
comment on column public.stock_items.qty_reserved is
  'Stock apartado por señas pendientes en modo reserva. Stock disponible para vender = qty - qty_reserved.';
comment on column public.sales.stock_reserved_mode is
  'Snapshot del flag tenants.pos_partial_reserves_stock al momento de crear la venta. Guía el comportamiento del void y del add_payment.';


-- ---------------------------------------------------------------------
-- 2. create_sale_atomic con soporte de partial + qty_reserved
-- ---------------------------------------------------------------------
-- Cambios respecto a la versión de migration 014:
--   - Stock disponible = qty - qty_reserved (no solo qty).
--   - Nuevo p_partial: si true, paid puede ser < total (pero > 0).
--   - Si p_partial && tenant.pos_partial_reserves_stock: sumar qty_reserved
--     en lugar de bajar qty.
--   - sales.status y sales.stock_reserved_mode se guardan según el modo.

drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);
drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, boolean);

create or replace function public.create_sale_atomic(
  p_tenant_id    uuid,
  p_branch_id    uuid,
  p_register_id  uuid,
  p_discount     numeric,
  p_items        jsonb,
  p_payments     jsonb,
  p_partial      boolean default false
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
  v_stock_mode         boolean;  -- true = modo reserva
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

  -- Settings del tenant
  select pos_max_discount_percent, pos_allow_negative_stock, pos_partial_reserves_stock
    into v_max_discount_pct, v_allow_negative, v_partial_reserves
    from tenants
   where id = p_tenant_id;

  -- Modo de stock para esta venta: solo usa reserva si es partial Y el tenant lo tiene activo.
  v_stock_mode := coalesce(p_partial, false) and coalesce(v_partial_reserves, false);

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
      select s.qty, s.qty_reserved
        into v_stock_qty, v_stock_reserved
        from stock_items s
       where s.tenant_id    = p_tenant_id
         and s.warehouse_id = v_warehouse_id
         and s.product_id   = v_product_id
       for update of s;

      if v_stock_qty is null then
        v_stock_qty := 0;
        v_stock_reserved := 0;
      end if;

      v_available := v_stock_qty - coalesce(v_stock_reserved, 0);

      if v_available < v_qty then
        if not (v_allow_zero or v_allow_negative) then
          raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
            v_product_name, v_available, v_qty;
        end if;
      end if;

      if v_stock_mode then
        -- Modo reserva: sumar qty_reserved, qty no cambia
        if exists (
          select 1 from stock_items
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id
        ) then
          update stock_items
             set qty_reserved = coalesce(qty_reserved, 0) + v_qty,
                 updated_at = now()
           where tenant_id = p_tenant_id
             and warehouse_id = v_warehouse_id
             and product_id = v_product_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty, qty_reserved)
          values (p_tenant_id, v_warehouse_id, v_product_id, 0, 0, v_qty);
        end if;
      else
        -- Modo se-lleva (incluye ventas paid normales): bajar qty
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
    -- Seña: paid debe ser > 0 y < total
    if v_paid <= 0 then
      raise exception 'Una seña debe tener al menos un pago';
    end if;
    if v_paid > v_total then
      raise exception 'El pago de la seña (%) no puede superar el total (%)', v_paid, v_total;
    end if;
    if abs(v_paid - v_total) <= 0.005 then
      -- Si el "partial" cubre el total exacto, lo registramos como paid normal.
      v_status := 'paid';
      v_stock_mode := false;  -- ya descontamos qty en el loop
    else
      v_status := 'partial';
    end if;
  else
    -- Venta normal: paid debe ser exacto
    if abs(v_paid - v_total) > 0.005 then
      raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
    end if;
    v_status := 'paid';
  end if;

  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided, status, stock_reserved_mode
  ) values (
    p_tenant_id, p_branch_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false, v_status, v_stock_mode
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


-- ---------------------------------------------------------------------
-- 3. add_payment_to_sale_atomic — agrega pagos y promueve a paid si llega
-- ---------------------------------------------------------------------
create or replace function public.add_payment_to_sale_atomic(
  p_tenant_id uuid,
  p_sale_id   uuid,
  p_payments  jsonb
) returns sale_status
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_status      sale_status;
  v_total       numeric;
  v_branch_id   uuid;
  v_stock_mode  boolean;
  v_paid_so_far numeric;
  v_new_payments numeric := 0;
  v_payment     jsonb;
  v_warehouse_id uuid;
  v_item        record;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'No hay pagos para agregar';
  end if;

  -- Lock de la venta
  select status, total, branch_id, stock_reserved_mode
    into v_status, v_total, v_branch_id, v_stock_mode
    from sales
   where id = p_sale_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_status = 'paid' then
    raise exception 'La venta ya está saldada';
  end if;

  -- Cuánto se pagó hasta ahora
  select coalesce(sum(amount), 0)
    into v_paid_so_far
    from sale_payments
   where sale_id = p_sale_id;

  -- Validar y sumar nuevos pagos
  for v_payment in select * from jsonb_array_elements(p_payments) loop
    if (v_payment->>'amount')::numeric <= 0 then
      raise exception 'Los montos de pago deben ser mayores a 0';
    end if;
    v_new_payments := v_new_payments + (v_payment->>'amount')::numeric;
  end loop;

  if v_paid_so_far + v_new_payments > v_total + 0.005 then
    raise exception 'Los pagos (%) superan el saldo pendiente (%)',
      v_new_payments, v_total - v_paid_so_far;
  end if;

  -- Insertar los nuevos pagos
  insert into sale_payments (sale_id, tenant_id, method, amount)
  select p_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  -- Si llegó al total, promover a paid + materializar stock reservado si aplica
  if abs((v_paid_so_far + v_new_payments) - v_total) <= 0.005 then
    update sales set status = 'paid' where id = p_sale_id;

    if v_stock_mode then
      -- Materializar: qty_reserved -= qty, qty -= qty
      select id into v_warehouse_id
      from warehouses
      where tenant_id = p_tenant_id
        and branch_id = v_branch_id
        and is_default = true
        and active = true;

      for v_item in
        select product_id, qty
          from sale_items
         where sale_id = p_sale_id and tenant_id = p_tenant_id
      loop
        update stock_items
           set qty          = qty - v_item.qty,
               qty_reserved = greatest(coalesce(qty_reserved, 0) - v_item.qty, 0),
               updated_at   = now()
         where tenant_id    = p_tenant_id
           and warehouse_id = v_warehouse_id
           and product_id   = v_item.product_id;
      end loop;
    end if;

    return 'paid';
  else
    return 'partial';
  end if;
end;
$$;

comment on function public.add_payment_to_sale_atomic is
  'Agrega pagos a una venta con status=partial. Si los pagos cubren el saldo, promueve la venta a paid y materializa stock si estaba reservado.';


-- ---------------------------------------------------------------------
-- 4. void_sale_atomic — versión 3, considera stock reservado
-- ---------------------------------------------------------------------
-- Si la venta era partial con stock reservado y todavía NO se materializó:
--   liberar qty_reserved (no sumar qty).
-- Si la venta era partial en modo se-lleva, o paid:
--   sumar qty (estándar).
create or replace function public.void_sale_atomic(
  p_tenant_id uuid,
  p_sale_id   uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_branch  uuid;
  v_sale_status  sale_status;
  v_sale_voided  boolean;
  v_stock_mode   boolean;
  v_warehouse_id uuid;
  v_item         record;
  v_stock_id     uuid;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;

  select branch_id, status, voided, stock_reserved_mode
    into v_sale_branch, v_sale_status, v_sale_voided, v_stock_mode
    from sales
   where id = p_sale_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_sale_voided then
    return;
  end if;

  select id into v_warehouse_id
  from warehouses
  where tenant_id = p_tenant_id
    and branch_id = v_sale_branch
    and is_default = true
    and active = true;

  if v_warehouse_id is null then
    raise exception 'La sucursal de la venta no tiene un depósito principal';
  end if;

  update sales set voided = true where id = p_sale_id;

  for v_item in
    select product_id, qty
      from sale_items
     where sale_id = p_sale_id and tenant_id = p_tenant_id
  loop
    v_stock_id := null;
    select id into v_stock_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = v_warehouse_id
       and product_id   = v_item.product_id
     for update;

    if v_sale_status = 'partial' and v_stock_mode then
      -- Stock estaba reservado y no se materializó: liberar qty_reserved
      if v_stock_id is not null then
        update stock_items
           set qty_reserved = greatest(coalesce(qty_reserved, 0) - v_item.qty, 0),
               updated_at   = now()
         where id = v_stock_id;
      end if;
    else
      -- Modo estándar: sumar qty (devolver el stock)
      if v_stock_id is not null then
        update stock_items
           set qty        = qty + v_item.qty,
               updated_at = now()
         where id = v_stock_id;
      else
        insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
        values (p_tenant_id, v_warehouse_id, v_item.product_id, v_item.qty, 0);
      end if;
    end if;
  end loop;
end;
$$;
