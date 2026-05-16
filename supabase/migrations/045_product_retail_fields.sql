-- =====================================================================
-- Migration 045: Product retail fields (Sprint PROD-RETAIL)
-- =====================================================================
-- 1. Brands como entidad (FK), no text libre.
-- 2. Categories jerárquicas (rubro → sub-rubro). Max 2 niveles enforced.
-- 3. Campos extra para retail: description, unit_of_measure, tags[],
--    image_url, season.
-- =====================================================================

create table public.brands (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- case-insensitive uniqueness por tenant
create unique index brands_unique_name_per_tenant
  on public.brands (tenant_id, lower(name));
create index brands_tenant_active_idx
  on public.brands (tenant_id) where active;

alter table public.brands enable row level security;

create policy "tenant_isolation" on public.brands for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.brands_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_brands_updated_at
  before update on public.brands
  for each row execute function public.brands_touch_updated_at();

-- Migrar products.brand text → brand_id ----------------------------------
alter table public.products
  add column brand_id uuid references public.brands(id) on delete set null;

-- Crear brands a partir de productos existentes con brand text.
-- Insertamos uno por (tenant_id, lower(trim(brand))) único.
insert into public.brands (tenant_id, name)
select distinct on (p.tenant_id, lower(trim(p.brand)))
  p.tenant_id, trim(p.brand)
from public.products p
where p.brand is not null
  and trim(p.brand) <> ''
order by p.tenant_id, lower(trim(p.brand)), trim(p.brand);

-- Linkear productos al brand recién creado.
update public.products p
set brand_id = b.id
from public.brands b
where p.tenant_id = b.tenant_id
  and p.brand is not null
  and lower(trim(p.brand)) = lower(b.name);

-- Drop la columna text vieja.
drop index if exists products_brand_idx;
alter table public.products drop column brand;

create index products_brand_idx on public.products(tenant_id, brand_id) where brand_id is not null;

-- Categories jerárquicas (max 2 niveles) --------------------------------
alter table public.categories
  add column parent_id uuid references public.categories(id) on delete restrict,
  add column sort_order int not null default 0;

create index categories_parent_idx on public.categories(parent_id);

create or replace function public.categories_enforce_depth()
returns trigger language plpgsql as $$
declare
  v_parent_parent uuid;
begin
  if new.parent_id is not null then
    -- No puede ser su propio padre.
    if new.parent_id = new.id then
      raise exception 'Una categoría no puede ser su propio padre';
    end if;
    -- El padre no puede tener padre (max 2 niveles: rubro → sub-rubro).
    select parent_id into v_parent_parent
      from public.categories
      where id = new.parent_id;
    if v_parent_parent is not null then
      raise exception 'Máximo 2 niveles de categorías permitidos (rubro → sub-rubro)';
    end if;
  end if;
  return new;
end;
$$;
create trigger tr_categories_enforce_depth
  before insert or update on public.categories
  for each row execute function public.categories_enforce_depth();

-- Campos extra para retail ----------------------------------------------
alter table public.products
  add column description       text,
  add column unit_of_measure   text not null default 'unit'
    check (unit_of_measure in ('unit','kg','g','l','ml','m','m2','cm','pair','box','dozen')),
  add column tags              text[] not null default '{}'::text[],
  add column image_url         text,
  add column season            text;

create index products_tags_idx on public.products using gin (tags);
