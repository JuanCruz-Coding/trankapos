-- =====================================================================
-- Migration 030: Variantes de producto (Sprint VAR)
-- =====================================================================
-- Cada producto puede tener N variantes (talle, color, sabor, formato).
-- products = plantilla. product_variants = lo que realmente se vende.
-- sale_items/stock_items/transfer_items pasan a referenciar variant_id.
--
-- Compatibilidad: cada producto existente recibe 1 variante "default"
-- autogenerada (is_default=true, attributes='{}'). Los kioscos siguen
-- funcionando sin tocar nada — toda venta/stock va contra la default.
--
-- product_id queda en las tablas hijas como denormalización para joins
-- rápidos, pero variant_id es la fuente de verdad de identidad.
-- =====================================================================

create table public.product_variants (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text,
  barcode         text,
  attributes      jsonb not null default '{}'::jsonb,
  price_override  numeric,
  cost_override   numeric,
  active          boolean not null default true,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create unique index product_variants_sku_unique
  on public.product_variants(tenant_id, sku) where sku is not null;
create unique index product_variants_barcode_unique
  on public.product_variants(tenant_id, barcode) where barcode is not null;
create unique index product_variants_default_per_product
  on public.product_variants(product_id) where is_default;
create index product_variants_product_idx on public.product_variants(product_id);
create index product_variants_tenant_idx  on public.product_variants(tenant_id);

-- 1 variante default por cada producto existente
insert into public.product_variants (tenant_id, product_id, sku, barcode, attributes, is_default, active)
select tenant_id, id, sku, barcode, '{}'::jsonb, true, active
from public.products;

-- sale_items
alter table public.sale_items add column variant_id uuid references public.product_variants(id);
update public.sale_items si
   set variant_id = pv.id
  from public.product_variants pv
 where pv.product_id = si.product_id and pv.is_default = true;
alter table public.sale_items alter column variant_id set not null;
create index sale_items_variant_id_idx on public.sale_items(variant_id);

-- stock_items (constraint, no solo index)
alter table public.stock_items add column variant_id uuid references public.product_variants(id);
update public.stock_items si
   set variant_id = pv.id
  from public.product_variants pv
 where pv.product_id = si.product_id and pv.is_default = true;
alter table public.stock_items alter column variant_id set not null;
alter table public.stock_items drop constraint stock_items_tenant_warehouse_product_uk;
alter table public.stock_items add constraint stock_items_tenant_warehouse_variant_uk
  unique (tenant_id, warehouse_id, variant_id);

-- transfer_items
alter table public.transfer_items add column variant_id uuid references public.product_variants(id);
update public.transfer_items ti
   set variant_id = pv.id
  from public.product_variants pv
 where pv.product_id = ti.product_id and pv.is_default = true;
alter table public.transfer_items alter column variant_id set not null;
create index transfer_items_variant_id_idx on public.transfer_items(variant_id);

-- RLS — mismo patrón que products
alter table public.product_variants enable row level security;
create policy "tenant_isolation"
  on public.product_variants
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

comment on table public.product_variants is
  'Variantes vendibles de un producto (talle/color/sabor/formato). Cada producto tiene al menos 1 default. sale_items/stock_items/transfer_items referencian variant_id.';
comment on column public.product_variants.attributes is
  'JSON shape libre: {talle:"M", color:"Negro"}. Claves definidas por el comercio.';
comment on column public.product_variants.is_default is
  'true para la variante autogenerada de migration 030. Para productos simples es la única variante.';
comment on column public.product_variants.price_override is
  'NULL = usa products.price. Solo se setea si la variante cobra distinto al producto padre.';
