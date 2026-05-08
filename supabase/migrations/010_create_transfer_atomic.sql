-- =====================================================================
-- Migration 010: RPC atómica para createTransfer
-- =====================================================================
-- Hasta ahora, createTransfer del SupabaseDriver hace:
--   1) SELECT stock origen para validar
--   2) INSERT transfers header
--   3) INSERT transfer_items (rollback manual del header si falla)
--   4) for cada item: adjustStock(-qty origen) + adjustStock(+qty destino)
--
-- Si falla a mitad del paso 4, queda transferencia con stock movido
-- parcialmente: ej. salió del origen pero no llegó al destino.
--
-- También hay race posible: la pre-validación del paso 1 lee stock sin
-- lock; entre el SELECT y el descuento, otro cajero puede vender stock
-- y la transferencia se ejecuta sobre stock inexistente.
--
-- Esta RPC hace todo en una sola transacción Postgres con SELECT FOR
-- UPDATE en stock origen (lock por fila). Stock destino se crea si no
-- existe (caso típico: producto nuevo en el depósito destino).
-- =====================================================================

create or replace function public.create_transfer_atomic(
  p_tenant_id     uuid,
  p_from_depot_id uuid,
  p_to_depot_id   uuid,
  p_notes         text,
  p_items         jsonb     -- [{product_id, qty}, ...]
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
  if p_from_depot_id = p_to_depot_id then
    raise exception 'Origen y destino deben ser distintos';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene items';
  end if;

  -- Recorrer items: lock stock origen + validar + descontar + sumar destino
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'qty')::numeric;

    if v_qty <= 0 then
      raise exception 'Cantidad inválida (debe ser > 0)';
    end if;

    -- Lock por fila del stock origen + chequeo
    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id  = p_tenant_id
       and s.depot_id   = p_from_depot_id
       and s.product_id = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en el depósito origen';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente de "%" en el depósito origen (disponible: %, pedido: %)',
        v_product_name, v_stock_qty, v_qty;
    end if;

    -- Descontar origen
    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id  = p_tenant_id
       and depot_id   = p_from_depot_id
       and product_id = v_product_id;

    -- Sumar destino: lock + update si existe, insert si no
    v_dest_id := null;
    select id into v_dest_id
      from stock_items
     where tenant_id  = p_tenant_id
       and depot_id   = p_to_depot_id
       and product_id = v_product_id
     for update;

    if v_dest_id is not null then
      update stock_items
         set qty = qty + v_qty,
             updated_at = now()
       where id = v_dest_id;
    else
      insert into stock_items (tenant_id, depot_id, product_id, qty, min_qty)
      values (p_tenant_id, p_to_depot_id, v_product_id, v_qty, 0);
    end if;
  end loop;

  -- Insertar header
  insert into transfers (tenant_id, from_depot_id, to_depot_id, created_by, notes)
  values (p_tenant_id, p_from_depot_id, p_to_depot_id, v_user_id, coalesce(p_notes, ''))
  returning id into v_transfer_id;

  -- Insertar transfer_items
  insert into transfer_items (transfer_id, tenant_id, product_id, qty)
  select v_transfer_id, p_tenant_id,
         (it->>'product_id')::uuid,
         (it->>'qty')::numeric
    from jsonb_array_elements(p_items) it;

  return v_transfer_id;
end;
$$;

comment on function public.create_transfer_atomic is
  'Crea una transferencia (header + items) y mueve stock origen→destino '
  'atómicamente. Lock por fila en stock_items origen. Crea fila de stock '
  'destino si no existe. NO permite transferir más de lo disponible.';
