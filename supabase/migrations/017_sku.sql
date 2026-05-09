-- =====================================================================
-- Migration 017: SKU para productos sin EAN
-- =====================================================================
-- Caso de uso: productos a granel (frutas, harina), servicios (café chico),
-- combos armados. No tienen código de barras pero el cajero necesita un
-- identificador para tipear / buscar rápido.
--
-- Modelo:
--   products.sku (text nullable) — único por tenant cuando no es null.
--   tenants.sku_auto_enabled — si true, generar SKU automático.
--   tenants.sku_prefix — prefijo configurable (default '200', rango GS1
--     reservado para uso interno). Permite a cada comercio elegir el suyo.
--   generate_next_sku(tenant_id) — devuelve el próximo correlativo.
--   trigger before_insert_product — si sku es null y barcode también, y el
--     tenant tiene auto_enabled, asigna {prefix}-{NNNN}.
--
-- El POS busca por barcode primero, después por SKU (TS).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tenants: settings de SKU
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists sku_auto_enabled boolean not null default true,
  add column if not exists sku_prefix       text    not null default '200';

comment on column public.tenants.sku_auto_enabled is
  'Si true, generar SKU automático cuando un producto se crea sin barcode y sin SKU manual.';
comment on column public.tenants.sku_prefix is
  'Prefijo del SKU auto-generado. Default 200 (rango GS1 interno). Se concatena: {prefix}-{NNNN}.';


-- ---------------------------------------------------------------------
-- 2. products.sku
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists sku text;

-- Único por tenant cuando no es null (parcial).
drop index if exists products_sku_unique;
create unique index products_sku_unique
  on public.products (tenant_id, sku)
  where sku is not null;


-- ---------------------------------------------------------------------
-- 3. generate_next_sku — siguiente correlativo del tenant
-- ---------------------------------------------------------------------
-- Lee los SKU existentes con el prefijo del tenant y devuelve el próximo.
-- Si no hay ninguno, arranca en 1.
-- Formato del valor numérico: padding con ceros a la izquierda hasta 5 dígitos.
-- Ej. prefijo '200' → '200-00001', '200-00002', ...
create or replace function public.generate_next_sku(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_max    integer;
  v_next   integer;
begin
  select sku_prefix into v_prefix
  from tenants
  where id = p_tenant_id;

  if v_prefix is null then
    v_prefix := '200';
  end if;

  -- Buscar el correlativo más alto entre los SKU que matchean el patrón.
  -- substring extrae el número después del guion, casteo a int para max.
  select coalesce(
    max(
      nullif(
        regexp_replace(sku, '^' || v_prefix || '-', ''),
        ''
      )::integer
    ),
    0
  )
  into v_max
  from products
  where tenant_id = p_tenant_id
    and sku ~ ('^' || v_prefix || '-\d+$');

  v_next := v_max + 1;
  return v_prefix || '-' || lpad(v_next::text, 5, '0');
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Trigger before_insert_product — asigna SKU automático si corresponde
-- ---------------------------------------------------------------------
create or replace function public.assign_product_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto    boolean;
begin
  -- Solo aplica si el producto se creó SIN SKU manual.
  if NEW.sku is not null then
    return NEW;
  end if;

  -- Y SIN barcode (productos con barcode no necesitan SKU automático;
  -- igual el dueño puede agregarlo a mano si quiere).
  if NEW.barcode is not null then
    return NEW;
  end if;

  -- Mira el flag del tenant.
  select sku_auto_enabled into v_auto
  from tenants
  where id = NEW.tenant_id;

  if not coalesce(v_auto, true) then
    return NEW;
  end if;

  NEW.sku := public.generate_next_sku(NEW.tenant_id);
  return NEW;
end;
$$;

drop trigger if exists trg_assign_product_sku on public.products;
create trigger trg_assign_product_sku
  before insert on public.products
  for each row execute function public.assign_product_sku();
