-- =====================================================================
-- Migration 007: RPC atómica para anular ventas (voidSale)
-- =====================================================================
-- Hasta ahora, voidSale del SupabaseDriver hace 3 pasos secuenciales:
--   1) select sale + items
--   2) update sales set voided = true
--   3) for cada item → adjustStock(+qty)  ← N round-trips, sin lock
--
-- Si falla a mitad del paso 3, queda venta marcada como voided con stock
-- parcialmente revertido. No hay forma fácil de detectar la inconsistencia.
--
-- Esta RPC hace todo en una sola transacción Postgres:
-- - Lock de la venta (FOR UPDATE) para evitar doble void simultáneo.
-- - Idempotente: si la venta ya está voided, retorna sin error.
-- - Lock por fila de cada stock_item al sumar el stock.
-- - Si stock_items no existe (producto borrado), lo crea con la qty a devolver.
-- =====================================================================

create or replace function public.void_sale_atomic(
  p_tenant_id uuid,
  p_sale_id   uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_depot   uuid;
  v_sale_voided  boolean;
  v_item         record;
  v_stock_id     uuid;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;

  -- Lock de la venta para que dos void simultáneos no se pisen
  select depot_id, voided
    into v_sale_depot, v_sale_voided
    from sales
   where id = p_sale_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_sale_voided then
    return;  -- idempotente
  end if;

  update sales set voided = true where id = p_sale_id;

  -- Devolver stock por cada item de la venta, con lock por fila
  for v_item in
    select product_id, qty
      from sale_items
     where sale_id = p_sale_id and tenant_id = p_tenant_id
  loop
    v_stock_id := null;

    select id into v_stock_id
      from stock_items
     where tenant_id  = p_tenant_id
       and depot_id   = v_sale_depot
       and product_id = v_item.product_id
     for update;

    if v_stock_id is not null then
      update stock_items
         set qty        = qty + v_item.qty,
             updated_at = now()
       where id = v_stock_id;
    else
      -- Producto sin fila de stock (ej. borrado) → recuperar stock virtual
      insert into stock_items (tenant_id, depot_id, product_id, qty, min_qty)
      values (p_tenant_id, v_sale_depot, v_item.product_id, v_item.qty, 0);
    end if;
  end loop;
end;
$$;

comment on function public.void_sale_atomic is
  'Anula una venta y devuelve stock atómicamente. Lock por fila en sales y '
  'stock_items. Idempotente: si la venta ya está voided, retorna sin error.';
