-- =====================================================================
-- Migration 044: Promotions (Sprint PROMO)
-- =====================================================================
-- 2 tipos: percent_off + nxm. Una condición opcional por customer_group_id.
-- Stack EXCLUSIVO: el engine evalúa todas las promos aplicables a un item
-- y elige la que mejor descuento le da al cliente (cliente-side, en el
-- driver). Persistimos las promos efectivamente aplicadas en sale_promotions
-- para reportes y para que el ticket pueda re-renderizarlas.
--
-- Scope: a qué productos aplica la promo.
--   - 'all'      → todos los productos del tenant
--   - 'product'  → un producto específico (scope_value = product_id)
--   - 'category' → una categoría (scope_value = category_id)
--   - 'brand'    → una marca (scope_value = brand text)
-- =====================================================================

create table public.promotions (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null,
  promo_type            text not null check (promo_type in ('percent_off', 'nxm')),
  -- percent_off: 1..100
  percent_off           numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  -- nxm: buy_qty >= pay_qty + 1 (al menos 1 gratis)
  buy_qty               int check (buy_qty is null or buy_qty >= 2),
  pay_qty               int check (pay_qty is null or pay_qty >= 1),
  -- scope
  scope_type            text not null check (scope_type in ('all','product','category','brand')),
  scope_value           text,
  -- condición de cliente (opcional)
  customer_group_id     uuid references public.customer_groups(id) on delete set null,
  -- vigencia (nullable = sin límite)
  starts_at             timestamptz,
  ends_at               timestamptz,
  active                boolean not null default true,
  priority              int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Coherencia: si es percent_off, percent_off no puede ser null.
  -- Si es nxm, buy_qty y pay_qty no pueden ser null y buy_qty > pay_qty.
  check (
    (promo_type = 'percent_off' and percent_off is not null and buy_qty is null and pay_qty is null)
    or
    (promo_type = 'nxm' and buy_qty is not null and pay_qty is not null and buy_qty > pay_qty and percent_off is null)
  ),
  -- Si scope_type es 'all', scope_value debe ser null.
  -- Si es product/category/brand, scope_value no puede ser null.
  check (
    (scope_type = 'all' and scope_value is null)
    or
    (scope_type <> 'all' and scope_value is not null)
  )
);

create index promotions_tenant_active_idx
  on public.promotions(tenant_id) where active;
create index promotions_scope_idx
  on public.promotions(tenant_id, scope_type, scope_value);

alter table public.promotions enable row level security;

create policy "tenant_isolation" on public.promotions for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.promotions_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_promotions_updated_at
  before update on public.promotions
  for each row execute function public.promotions_touch_updated_at();

-- Promos aplicadas a una venta concreta. Se rellena cuando el engine del
-- driver decide qué promos aplican al cart y crea la sale. Para NxM el
-- amount es el descuento total (no por item). Para percent_off también.
create table public.sale_promotions (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sale_id       uuid not null references public.sales(id) on delete cascade,
  promotion_id  uuid references public.promotions(id) on delete set null,
  promo_name    text not null,
  promo_type    text not null,
  amount        numeric not null check (amount >= 0),
  description   text,
  created_at    timestamptz not null default now()
);

create index sale_promotions_sale_idx on public.sale_promotions(sale_id);
create index sale_promotions_tenant_idx on public.sale_promotions(tenant_id);

alter table public.sale_promotions enable row level security;

create policy "tenant_isolation" on public.sale_promotions for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

-- Campo de descuento total por promociones en la sale. Sirve para que
-- reports/financiero pueda separar "descuento manual" de "descuento por promo".
alter table public.sales
  add column if not exists promo_discount_total numeric not null default 0;

comment on column public.sales.promo_discount_total is
  'Sprint PROMO: suma de sale_promotions.amount. El total ya viene calculado con este descuento (subtotal - discount - promo_discount_total + surcharge_total).';
