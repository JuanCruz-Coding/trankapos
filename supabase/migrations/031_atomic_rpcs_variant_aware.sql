-- =====================================================================
-- Migration 031: RPCs atómicas adaptadas a variantes (Sprint VAR)
-- =====================================================================
-- La migration 030 introdujo variant_id en sale_items / stock_items /
-- transfer_items con NOT NULL. Las RPCs hacían sus operaciones por
-- product_id; después de 030 rompen con NOT NULL violation o miss
-- unique. Esta migration las reescribe para usar variant_id.
--
-- Compat: el payload jsonb de p_items puede traer `variant_id` opcional.
-- Si no viene, el SQL resuelve a la variante default del producto. El
-- driver TS adaptado por Pieza A ya manda variant_id siempre, pero
-- callers viejos siguen funcionando.
-- =====================================================================

drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, boolean, uuid, smallint, text, text, text);
drop function if exists public.add_payment_to_sale_atomic(uuid, uuid, jsonb);
drop function if exists public.void_sale_atomic(uuid, uuid);
drop function if exists public.create_transfer_atomic(uuid, uuid, uuid, text, jsonb);
drop function if exists public.adjust_stock_atomic(uuid, uuid, numeric, numeric);


-- ---------------------------------------------------------------------
-- 1. create_sale_atomic — variant-aware
-- ---------------------------------------------------------------------
create function public.create_sale_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_discount numeric,
  p_items jsonb,
  p_payments jsonb,
  p_partial boolean,
  p_customer_id uuid,
  p_customer_doc_type smallint,
  p_customer_doc_number text,
  p_customer_legal_name text,
  p_customer_iva_condition text
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
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
  v_variant_id         uuid;
  v_qty                numeric;
  v_price              numeric;
  v_item_discount      numeric;
  v_subtotal_item      numeric;
  v_product_name       text;
  v_variant_attrs      jsonb;
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
  v_cust_doc_type      smallint;
  v_cust_doc_number    text;
  v_cust_legal_name    text;
  v_cust_iva_cond      text;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'El tenant_id no coincide con la sesión actual' using errcode = '42501';
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

  if p_customer_id is not null then
    select doc_type, doc_number, legal_name, iva_condition
      into v_cust_doc_type, v_cust_doc_number, v_cust_legal_name, v_cust_iva_cond
      from customers
     where id = p_customer_id and tenant_id = p_tenant_id and active;
    if v_cust_doc_type is null then
      raise exception 'Cliente no encontrado o inactivo';
    end if;
    v_cust_doc_type   := coalesce(p_customer_doc_type, v_cust_doc_type);
    v_cust_doc_number := coalesce(p_customer_doc_number, v_cust_doc_number);
    v_cust_legal_name := coalesce(p_customer_legal_name, v_cust_legal_name);
    v_cust_iva_cond   := coalesce(p_customer_iva_condition, v_cust_iva_cond);
  elsif p_customer_doc_number is not null or p_customer_legal_name is not null then
    v_cust_doc_type   := p_customer_doc_type;
    v_cust_doc_number := p_customer_doc_number;
    v_cust_legal_name := p_customer_legal_name;
    v_cust_iva_cond   := p_customer_iva_condition;
    if v_cust_doc_type is not null and v_cust_doc_type not in (80, 86, 96) then
      raise exception 'Tipo de documento inválido para el receptor';
    end if;
    if v_cust_doc_number is not null and v_cust_doc_number !~ '^[0-9]+$' then
      raise exception 'Número de documento inválido (solo dígitos)';
    end if;
  end if;

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
    v_variant_id    := nullif(v_item->>'variant_id', '')::uuid;
    v_qty           := (v_item->>'qty')::numeric;
    v_price         := (v_item->>'price')::numeric;
    v_item_discount := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    if v_price < 0 then raise exception 'Precio inválido (debe ser >= 0)'; end if;
    if v_item_discount < 0 then raise exception 'Descuento de línea inválido'; end if;

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

    if v_variant_id is null then
      select id, attributes into v_variant_id, v_variant_attrs
        from product_variants
       where product_id = v_product_id and is_default = true;
      if v_variant_id is null then
        raise exception 'Producto sin variante default (estado inconsistente post-030)';
      end if;
    else
      select attributes into v_variant_attrs
        from product_variants
       where id = v_variant_id and product_id = v_product_id and tenant_id = p_tenant_id;
      if v_variant_attrs is null then
        raise exception 'Variante % no encontrada o no pertenece al producto', v_variant_id;
      end if;
    end if;

    if v_track_stock then
      select coalesce(qty, 0), coalesce(qty_reserved, 0)
        into v_stock_qty, v_stock_reserved
        from stock_items
       where tenant_id = p_tenant_id
         and warehouse_id = v_warehouse_id
         and variant_id = v_variant_id;

      v_available := coalesce(v_stock_qty, 0) - coalesce(v_stock_reserved, 0);

      if not v_allow_zero and not v_allow_negative and v_available < v_qty then
        raise exception 'Stock insuficiente para %', v_product_name;
      end if;

      if v_stock_mode then
        if exists (
          select 1 from stock_items
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id
        ) then
          update stock_items
             set qty_reserved = coalesce(qty_reserved, 0) + v_qty, updated_at = now()
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty, qty_reserved)
          values (p_tenant_id, v_warehouse_id, v_product_id, v_variant_id, 0, 0, v_qty);
        end if;
      else
        if exists (
          select 1 from stock_items
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id
        ) then
          update stock_items
             set qty = qty - v_qty, updated_at = now()
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty)
          values (p_tenant_id, v_warehouse_id, v_product_id, v_variant_id, -v_qty, 0);
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
    if v_paid <= 0 then raise exception 'Una seña debe tener al menos un pago'; end if;
    if v_paid > v_total then
      raise exception 'El pago de la seña (%) no puede superar el total (%)', v_paid, v_total;
    end if;
    if abs(v_paid - v_total) <= 0.005 then
      v_status := 'paid'; v_stock_mode := false;
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
  ) returning id into v_sale_id;

  insert into sale_items (
    sale_id, tenant_id, product_id, variant_id, name, barcode,
    price, qty, discount, subtotal
  )
  select
    v_sale_id, p_tenant_id, p.id,
    coalesce(
      nullif(it->>'variant_id', '')::uuid,
      (select id from product_variants where product_id = p.id and is_default = true)
    ),
    p.name, p.barcode,
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
$fn$;


-- ---------------------------------------------------------------------
-- 2. add_payment_to_sale_atomic
-- ---------------------------------------------------------------------
create function public.add_payment_to_sale_atomic(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_payments jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id      uuid := auth.uid();
  v_status       sale_status;
  v_total        numeric;
  v_branch_id    uuid;
  v_stock_mode   boolean;
  v_paid_so_far  numeric;
  v_new_payments numeric := 0;
  v_payment      jsonb;
  v_warehouse_id uuid;
  v_item         record;
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

  select status, total, branch_id, stock_reserved_mode
    into v_status, v_total, v_branch_id, v_stock_mode
    from sales
   where id = p_sale_id and tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_status = 'paid' then raise exception 'La venta ya está saldada'; end if;

  select coalesce(sum(amount), 0)
    into v_paid_so_far
    from sale_payments
   where sale_id = p_sale_id;

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

  insert into sale_payments (sale_id, tenant_id, method, amount)
  select p_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  if abs((v_paid_so_far + v_new_payments) - v_total) <= 0.005 then
    update sales set status = 'paid' where id = p_sale_id;

    if v_stock_mode then
      select id into v_warehouse_id
        from warehouses
       where tenant_id = p_tenant_id and branch_id = v_branch_id
         and is_default = true and active = true;

      for v_item in
        select variant_id, qty
          from sale_items
         where sale_id = p_sale_id and tenant_id = p_tenant_id
      loop
        update stock_items
           set qty          = qty - v_item.qty,
               qty_reserved = greatest(coalesce(qty_reserved, 0) - v_item.qty, 0),
               updated_at   = now()
         where tenant_id    = p_tenant_id
           and warehouse_id = v_warehouse_id
           and variant_id   = v_item.variant_id;
      end loop;
    end if;

    return 'paid';
  else
    return 'partial';
  end if;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 3. void_sale_atomic
-- ---------------------------------------------------------------------
create function public.void_sale_atomic(
  p_tenant_id uuid,
  p_sale_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_sale_voided then return; end if;

  select id into v_warehouse_id
    from warehouses
   where tenant_id = p_tenant_id and branch_id = v_sale_branch
     and is_default = true and active = true;
  if v_warehouse_id is null then
    raise exception 'La sucursal de la venta no tiene un depósito principal';
  end if;

  update sales set voided = true where id = p_sale_id;

  for v_item in
    select product_id, variant_id, qty
      from sale_items
     where sale_id = p_sale_id and tenant_id = p_tenant_id
  loop
    v_stock_id := null;
    select id into v_stock_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = v_warehouse_id
       and variant_id   = v_item.variant_id
     for update;

    if v_sale_status = 'partial' and v_stock_mode then
      if v_stock_id is not null then
        update stock_items
           set qty_reserved = greatest(coalesce(qty_reserved, 0) - v_item.qty, 0),
               updated_at   = now()
         where id = v_stock_id;
      end if;
    else
      if v_stock_id is not null then
        update stock_items
           set qty = qty + v_item.qty, updated_at = now()
         where id = v_stock_id;
      else
        insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty)
        values (p_tenant_id, v_warehouse_id, v_item.product_id, v_item.variant_id, v_item.qty, 0);
      end if;
    end if;
  end loop;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 4. create_transfer_atomic
-- ---------------------------------------------------------------------
create function public.create_transfer_atomic(
  p_tenant_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_transfer_id  uuid;
  v_user_id      uuid := auth.uid();
  v_item         jsonb;
  v_product_id   uuid;
  v_variant_id   uuid;
  v_qty          numeric;
  v_stock_qty    numeric;
  v_product_name text;
  v_dest_id      uuid;
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
    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    v_qty        := (v_item->>'qty')::numeric;

    if v_qty <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;

    if v_variant_id is null then
      select id into v_variant_id
        from product_variants
       where product_id = v_product_id and is_default = true;
      if v_variant_id is null then
        raise exception 'Producto sin variante default';
      end if;
    end if;

    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id    = p_tenant_id
       and s.warehouse_id = p_from_warehouse_id
       and s.variant_id   = v_variant_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'La variante no tiene stock registrado en el depósito origen';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente de "%" en origen (disponible: %, pedido: %)',
        v_product_name, v_stock_qty, v_qty;
    end if;

    update stock_items
       set qty = qty - v_qty, updated_at = now()
     where tenant_id    = p_tenant_id
       and warehouse_id = p_from_warehouse_id
       and variant_id   = v_variant_id;

    v_dest_id := null;
    select id into v_dest_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = p_to_warehouse_id
       and variant_id   = v_variant_id
     for update;

    if v_dest_id is not null then
      update stock_items
         set qty = qty + v_qty, updated_at = now()
       where id = v_dest_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty)
      values (p_tenant_id, p_to_warehouse_id, v_product_id, v_variant_id, v_qty, 0);
    end if;
  end loop;

  insert into transfers (tenant_id, from_warehouse_id, to_warehouse_id, created_by, notes)
  values (p_tenant_id, p_from_warehouse_id, p_to_warehouse_id, v_user_id, coalesce(p_notes, ''))
  returning id into v_transfer_id;

  insert into transfer_items (transfer_id, tenant_id, product_id, variant_id, qty)
  select v_transfer_id, p_tenant_id,
         (it->>'product_id')::uuid,
         coalesce(
           nullif(it->>'variant_id', '')::uuid,
           (select id from product_variants where product_id = (it->>'product_id')::uuid and is_default = true)
         ),
         (it->>'qty')::numeric
    from jsonb_array_elements(p_items) it;

  return v_transfer_id;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 5. adjust_stock_atomic — agrega param opcional p_variant_id
-- ---------------------------------------------------------------------
create function public.adjust_stock_atomic(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_delta numeric,
  p_min_qty numeric,
  p_variant_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant_id    uuid := public.tenant_id();
  v_existing_id  uuid;
  v_existing_min numeric;
  v_variant_id   uuid := p_variant_id;
begin
  if v_tenant_id is null then
    raise exception 'Sesión sin tenant activo' using errcode = '42501';
  end if;

  if v_variant_id is null then
    select id into v_variant_id
      from product_variants
     where product_id = p_product_id and is_default = true;
    if v_variant_id is null then
      raise exception 'Producto sin variante default (estado inconsistente)';
    end if;
  end if;

  select id, min_qty
    into v_existing_id, v_existing_min
    from stock_items
   where tenant_id = v_tenant_id and warehouse_id = p_warehouse_id and variant_id = v_variant_id
   for update;

  if v_existing_id is not null then
    update stock_items
       set qty = qty + p_delta,
           min_qty = coalesce(p_min_qty, v_existing_min),
           updated_at = now()
     where id = v_existing_id;
  else
    insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty)
    values (v_tenant_id, p_warehouse_id, p_product_id, v_variant_id, p_delta, coalesce(p_min_qty, 0));
  end if;
end;
$fn$;
