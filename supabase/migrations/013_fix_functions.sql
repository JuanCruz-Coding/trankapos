-- =====================================================================
-- Migration 013: completar las RPCs que la 012 no pudo recrear
-- =====================================================================
-- La migration 012 falló al llegar a `create or replace function
-- adjust_stock_atomic(...)` porque Postgres no permite renombrar los
-- parámetros de una función existente con OR REPLACE
-- (error 42P13). Las funciones viejas usan p_depot_id; las nuevas
-- usan p_warehouse_id / p_branch_id.
--
-- Esta migration:
--   1) Verifica que las tablas branches/warehouses existan (sino, la 012
--      fue revertida y hay que volver a correrla).
--   2) DROP de las 3 funciones afectadas (signatures viejas).
--   3) CREATE de las 4 funciones con la lógica nueva
--      (adjust_stock_atomic, create_sale_atomic, void_sale_atomic,
--      create_transfer_atomic).
--   4) Sanity checks finales.
--
-- Es idempotente: se puede correr varias veces sin romper.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Pre-check: branches/warehouses tienen que existir.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'branches') then
    raise exception 'No existe la tabla branches. La migration 012 no se aplicó (o se revirtió). Volvé a correr 012_branches_warehouses.sql primero.';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'warehouses') then
    raise exception 'No existe la tabla warehouses. La migration 012 no se aplicó (o se revirtió).';
  end if;
end$$;


-- ---------------------------------------------------------------------
-- 2. DROP de signatures viejas (las que aún tienen p_depot_id).
-- ---------------------------------------------------------------------
-- IF EXISTS para que sea seguro si alguien ya las dropeó manualmente.
drop function if exists public.adjust_stock_atomic(uuid, uuid, numeric, numeric);
drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);
drop function if exists public.create_transfer_atomic(uuid, uuid, uuid, text, jsonb);


-- ---------------------------------------------------------------------
-- 3. adjust_stock_atomic (warehouse_id en lugar de depot_id).
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock_atomic(
  p_product_id   uuid,
  p_warehouse_id uuid,
  p_delta        numeric,
  p_min_qty      numeric default null
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

  select id, min_qty
    into v_existing_id, v_existing_min
    from stock_items
   where tenant_id    = v_tenant_id
     and warehouse_id = p_warehouse_id
     and product_id   = p_product_id
   for update;

  if v_existing_id is not null then
    update stock_items
       set qty        = qty + p_delta,
           min_qty    = coalesce(p_min_qty, v_existing_min),
           updated_at = now()
     where id = v_existing_id;
  else
    insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
    values (v_tenant_id, p_warehouse_id, p_product_id, p_delta, coalesce(p_min_qty, 0));
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. create_sale_atomic (branch_id; resta del warehouse default).
-- ---------------------------------------------------------------------
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
  v_sale_id         uuid;
  v_warehouse_id    uuid;
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

    v_subtotal_item := round(v_price * v_qty - v_item_discount, 2);
    if v_subtotal_item < 0 then
      raise exception 'El descuento de una línea supera el subtotal';
    end if;
    v_subtotal := v_subtotal + v_subtotal_item;

    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id    = p_tenant_id
       and s.warehouse_id = v_warehouse_id
       and s.product_id   = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en este depósito';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
        v_product_name, v_stock_qty, v_qty;
    end if;

    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id    = p_tenant_id
       and warehouse_id = v_warehouse_id
       and product_id   = v_product_id;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then
    raise exception 'El descuento global supera el subtotal';
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


-- ---------------------------------------------------------------------
-- 5. void_sale_atomic (devuelve stock al warehouse default de la branch).
-- ---------------------------------------------------------------------
-- Misma signature que la versión vieja (p_tenant_id, p_sale_id), por eso
-- alcanza con CREATE OR REPLACE sin DROP.
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
  v_sale_voided  boolean;
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

  select branch_id, voided
    into v_sale_branch, v_sale_voided
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

    if v_stock_id is not null then
      update stock_items
         set qty        = qty + v_item.qty,
             updated_at = now()
       where id = v_stock_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
      values (p_tenant_id, v_warehouse_id, v_item.product_id, v_item.qty, 0);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. create_transfer_atomic (warehouse↔warehouse).
-- ---------------------------------------------------------------------
create or replace function public.create_transfer_atomic(
  p_tenant_id         uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_notes             text,
  p_items             jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_transfer_id    uuid;
  v_user_id        uuid := auth.uid();
  v_item           jsonb;
  v_product_id     uuid;
  v_qty            numeric;
  v_stock_qty      numeric;
  v_product_name   text;
  v_dest_id        uuid;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'Origen y destino deben ser distintos';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'qty')::numeric;

    if v_qty <= 0 then
      raise exception 'Cantidad inválida (debe ser > 0)';
    end if;

    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id    = p_tenant_id
       and s.warehouse_id = p_from_warehouse_id
       and s.product_id   = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en el depósito origen';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente de "%" en el depósito origen (disponible: %, pedido: %)',
        v_product_name, v_stock_qty, v_qty;
    end if;

    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id    = p_tenant_id
       and warehouse_id = p_from_warehouse_id
       and product_id   = v_product_id;

    v_dest_id := null;
    select id into v_dest_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = p_to_warehouse_id
       and product_id   = v_product_id
     for update;

    if v_dest_id is not null then
      update stock_items
         set qty = qty + v_qty,
             updated_at = now()
       where id = v_dest_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
      values (p_tenant_id, p_to_warehouse_id, v_product_id, v_qty, 0);
    end if;
  end loop;

  insert into transfers (tenant_id, from_warehouse_id, to_warehouse_id, created_by, notes)
  values (p_tenant_id, p_from_warehouse_id, p_to_warehouse_id, v_user_id, coalesce(p_notes, ''))
  returning id into v_transfer_id;

  insert into transfer_items (transfer_id, tenant_id, product_id, qty)
  select v_transfer_id, p_tenant_id,
         (it->>'product_id')::uuid,
         (it->>'qty')::numeric
    from jsonb_array_elements(p_items) it;

  return v_transfer_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Sanity checks finales.
-- ---------------------------------------------------------------------
do $$
declare
  v_orphan int;
  v_bad    int;
begin
  -- Cada branch tiene exactamente 1 warehouse default activo
  select count(*) into v_orphan
  from branches b
  where not exists (
    select 1 from warehouses w
    where w.branch_id = b.id and w.is_default = true and w.active = true
  );
  if v_orphan > 0 then
    raise exception 'Hay % branches sin warehouse default activo.', v_orphan;
  end if;

  select count(*) into v_bad from stock_items where warehouse_id is null;
  if v_bad > 0 then raise exception '% stock_items sin warehouse_id', v_bad; end if;

  select count(*) into v_bad from sales where branch_id is null;
  if v_bad > 0 then raise exception '% sales sin branch_id', v_bad; end if;

  select count(*) into v_bad from cash_registers where branch_id is null;
  if v_bad > 0 then raise exception '% cash_registers sin branch_id', v_bad; end if;

  select count(*) into v_bad from transfers where from_warehouse_id is null or to_warehouse_id is null;
  if v_bad > 0 then raise exception '% transfers sin warehouses', v_bad; end if;

  raise notice 'Sanity checks OK. Migration 013 completada.';
end$$;
