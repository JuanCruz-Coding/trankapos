-- =====================================================================
-- Migration 043: Customer Groups (Sprint PROMO)
-- =====================================================================
-- Grupos de clientes (VIP, mayorista, empresas, cta cte). Sirven para:
--   1. Asignar una lista de precios por defecto al grupo.
--   2. Condicionar promociones a un segmento específico.
--
-- Cascada de listas de precios (resolución en cliente y en RPC):
--   1. customer.price_list_id
--   2. customer.group.default_price_list_id
--   3. tenant default price_list
-- =====================================================================

create table public.customer_groups (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  default_price_list_id uuid references public.price_lists(id) on delete set null,
  active                boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, code)
);

create index customer_groups_tenant_active_idx
  on public.customer_groups(tenant_id) where active;

alter table public.customers
  add column group_id uuid references public.customer_groups(id) on delete set null;

create index customers_group_idx on public.customers(group_id);

-- products.brand: campo text opcional para condicionar promociones por marca.
-- Si no existe ya. Lo dejamos nullable para no romper productos existentes.
alter table public.products
  add column if not exists brand text;

create index if not exists products_brand_idx
  on public.products(tenant_id, brand) where brand is not null;

alter table public.customer_groups enable row level security;

create policy "tenant_isolation" on public.customer_groups for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.customer_groups_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_customer_groups_updated_at
  before update on public.customer_groups
  for each row execute function public.customer_groups_touch_updated_at();
