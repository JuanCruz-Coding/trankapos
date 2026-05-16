-- =====================================================================
-- Migration 040: Listas de precios (Sprint PRC)
-- =====================================================================
-- Cada tenant tiene N listas. Una es default (la que aplica cuando no
-- hay otra asignada al cliente o cuando la venta es anónima).
--
-- Cascada para resolver precio efectivo:
--   1. price_list_items con variant exacta.
--   2. price_list_items a nivel producto (sin variant) en la lista.
--   3. product_variants.price_override.
--   4. products.price.
-- =====================================================================

create table public.price_lists (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  code         text not null,
  name         text not null,
  is_default   boolean not null default false,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

create unique index price_lists_default_per_tenant
  on public.price_lists(tenant_id) where is_default;
create index price_lists_tenant_active_idx
  on public.price_lists(tenant_id) where active;

create table public.price_list_items (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  variant_id    uuid references public.product_variants(id) on delete cascade,
  price         numeric not null check (price >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index price_list_items_with_variant
  on public.price_list_items(price_list_id, product_id, variant_id)
  where variant_id is not null;
create unique index price_list_items_no_variant
  on public.price_list_items(price_list_id, product_id)
  where variant_id is null;
create index price_list_items_tenant_idx on public.price_list_items(tenant_id);

alter table public.customers
  add column price_list_id uuid references public.price_lists(id) on delete set null;

alter table public.price_lists      enable row level security;
alter table public.price_list_items enable row level security;

create policy "tenant_isolation" on public.price_lists for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create policy "tenant_isolation" on public.price_list_items for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.price_lists_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_price_lists_updated_at
  before update on public.price_lists
  for each row execute function public.price_lists_touch_updated_at();
create trigger tr_price_list_items_updated_at
  before update on public.price_list_items
  for each row execute function public.price_lists_touch_updated_at();

-- Seed: lista "General" por tenant existente
insert into public.price_lists (tenant_id, code, name, is_default, sort_order)
select t.id, 'general', 'General', true, 0
from public.tenants t
on conflict (tenant_id, code) do nothing;

-- Trigger: tenant nuevo → lista General default
create or replace function public.tenants_seed_price_list()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.price_lists (tenant_id, code, name, is_default, sort_order)
  values (new.id, 'general', 'General', true, 0)
  on conflict (tenant_id, code) do nothing;
  return new;
end; $$;
drop trigger if exists tr_tenants_seed_price_list on public.tenants;
create trigger tr_tenants_seed_price_list
  after insert on public.tenants
  for each row execute function public.tenants_seed_price_list();

create or replace function public.get_effective_price(
  p_tenant_id     uuid,
  p_product_id    uuid,
  p_variant_id    uuid,
  p_price_list_id uuid
) returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_price numeric;
begin
  if p_variant_id is not null and p_price_list_id is not null then
    select price into v_price
      from public.price_list_items
     where price_list_id = p_price_list_id
       and product_id = p_product_id
       and variant_id = p_variant_id;
    if v_price is not null then return v_price; end if;
  end if;

  if p_price_list_id is not null then
    select price into v_price
      from public.price_list_items
     where price_list_id = p_price_list_id
       and product_id = p_product_id
       and variant_id is null;
    if v_price is not null then return v_price; end if;
  end if;

  if p_variant_id is not null then
    select price_override into v_price
      from public.product_variants
     where id = p_variant_id;
    if v_price is not null then return v_price; end if;
  end if;

  select price into v_price from public.products where id = p_product_id;
  return coalesce(v_price, 0);
end;
$fn$;

revoke all on function public.get_effective_price(uuid,uuid,uuid,uuid) from public;
grant execute on function public.get_effective_price(uuid,uuid,uuid,uuid) to service_role, authenticated;
