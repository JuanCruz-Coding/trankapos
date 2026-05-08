-- =====================================================================
-- Migration 005: RPCs atómicas para ventas y ajuste de stock
-- =====================================================================
-- Hasta ahora, createSale del SupabaseDriver hace 4 round-trips secuenciales
-- (insert sales, insert sale_items, insert sale_payments, descontar stock)
-- con "rollback manual". Si falla a mitad — especialmente en el descuento
-- de stock — quedan inconsistencias: venta registrada con stock parcialmente
-- descontado, o sin descontar.
--
-- Además, adjustStock hace read-modify-write sin lock: dos cajeros vendiendo
-- el mismo producto al mismo tiempo pueden corromper el stock.
--
-- Esta migration introduce 2 RPCs SECURITY INVOKER (RLS aplica) que hacen
-- todo en una sola transacción Postgres con SELECT ... FOR UPDATE para
-- locking por fila.

-- ---------------------------------------------------------------------
-- create_sale_atomic
-- ---------------------------------------------------------------------
-- Inserta una venta completa (header + items + payments) y descuenta stock,
-- todo en una transacción atómica. Si cualquier paso falla, el rollback
-- automático de Postgres revierte todo.
--
-- Validaciones:
-- - El carrito no está vacío.
-- - tenant_id coincide con el tenant_id() de la sesión.
-- - Cantidad y precio positivos por línea.
-- - Stock disponible >= cantidad solicitada (NO permite vender en negativo).
-- - Pagos suman exactamente el total (con tolerancia 0.005).
--
-- Retorna el sale_id; el cliente luego hace SELECT para reconstruir el objeto.

create or replace function public.create_sale_atomic(
  p_tenant_id    uuid,
  p_depot_id     uuid,
  p_register_id  uuid,
  p_discount     numeric,
  p_items        jsonb,   -- [{product_id, qty, price, discount}, ...]
  p_payments     jsonb    -- [{method, amount}, ...]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id         uuid;
  v_subtotal        numeric := 0;
  v_total           numeric;
  v_paid            numeric := 0;
  v_user_id         uuid := auth.uid();
  v_item            jsonb;
  v_payment         jsonb;
  v_product_id      uuid;
  v_qty             numeric;
  v_price           numeric;
  v_item_discount   numeric;
  v_subtotal_item   numeric;
  v_product_name    text;
  v_stock_qty       numeric;
begin
  -- Validaciones básicas
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

  -- Recorrer items: lock + validar stock + calcular subtotal + descontar
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

    v_subtotal_item := round(v_price * v_qty - v_item_discount, 2);
    if v_subtotal_item < 0 then
      raise exception 'El descuento de una línea supera el subtotal';
    end if;
    v_subtotal := v_subtotal + v_subtotal_item;

    -- Lock por fila + chequeo de stock disponible
    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id  = p_tenant_id
       and s.depot_id   = p_depot_id
       and s.product_id = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en este depósito';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
        v_product_name, v_stock_qty, v_qty;
    end if;

    -- Descontar stock atómicamente (sin race posible gracias al lock anterior)
    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id  = p_tenant_id
       and depot_id   = p_depot_id
       and product_id = v_product_id;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then
    raise exception 'El descuento global supera el subtotal';
  end if;

  -- Validar pagos
  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_payment->>'amount')::numeric;
  end loop;
  if abs(v_paid - v_total) > 0.005 then
    raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
  end if;

  -- Insertar header
  insert into sales (
    tenant_id, depot_id, register_id, cashier_id,
    subtotal, discount, total, voided
  ) values (
    p_tenant_id, p_depot_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false
  )
  returning id into v_sale_id;

  -- Insertar sale_items con snapshot de nombre/barcode al momento de la venta
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

  -- Insertar payments
  insert into sale_payments (sale_id, tenant_id, method, amount)
  select v_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  return v_sale_id;
end;
$$;

comment on function public.create_sale_atomic is
  'Crea una venta completa (sale + sale_items + sale_payments) y descuenta '
  'stock atómicamente. Bloquea filas de stock_items con SELECT FOR UPDATE '
  'para evitar race conditions. NO permite vender más de lo disponible.';

-- ---------------------------------------------------------------------
-- adjust_stock_atomic
-- ---------------------------------------------------------------------
-- Versión atómica de adjustStock: lock + update en lugar de read-modify-write.
-- Si la fila no existe, la inserta. Maneja delta negativo o positivo.

create or replace function public.adjust_stock_atomic(
  p_product_id  uuid,
  p_depot_id    uuid,
  p_delta       numeric,
  p_min_qty     numeric default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant_id    uuid := public.tenant_id();
  v_existing_id  uuid;
  v_existing_min numeric;
begin
  if v_tenant_id is null then
    raise exception 'Sesión sin tenant activo' using errcode = '42501';
  end if;

  -- Lock por fila
  select id, min_qty
    into v_existing_id, v_existing_min
    from stock_items
   where tenant_id  = v_tenant_id
     and depot_id   = p_depot_id
     and product_id = p_product_id
   for update;

  if v_existing_id is not null then
    update stock_items
       set qty        = qty + p_delta,
           min_qty    = coalesce(p_min_qty, v_existing_min),
           updated_at = now()
     where id = v_existing_id;
  else
    insert into stock_items (tenant_id, depot_id, product_id, qty, min_qty)
    values (v_tenant_id, p_depot_id, p_product_id, p_delta, coalesce(p_min_qty, 0));
  end if;
end;
$$;

comment on function public.adjust_stock_atomic is
  'Versión atómica con lock por fila para evitar races en read-modify-write '
  'cuando dos cajeros venden el mismo producto simultáneamente.';
