-- =====================================================================
-- Migration 032: Auto-crear variante default al insertar un producto nuevo
-- =====================================================================
-- Migration 030 hizo el backfill para productos existentes, pero los
-- productos NUEVOS no tienen variante default auto-creada. Cualquier
-- INSERT a stock_items/sale_items/transfer_items con variant_id=null
-- falla con NOT NULL violation.
--
-- Este trigger se dispara AFTER INSERT en products y crea una variante
-- default copiando sku/barcode/active del product. Garantía: todo
-- producto siempre tiene al menos 1 variante (la default).
-- =====================================================================

create or replace function public.products_create_default_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.product_variants (
    tenant_id, product_id, sku, barcode, attributes, is_default, active
  ) values (
    new.tenant_id, new.id, new.sku, new.barcode, '{}'::jsonb, true, new.active
  );
  return new;
end;
$fn$;

drop trigger if exists tr_products_create_default_variant on public.products;
create trigger tr_products_create_default_variant
  after insert on public.products
  for each row
  execute function public.products_create_default_variant();
