-- =====================================================================
-- Migration 041: Medios de pago configurables (Sprint PMP)
-- =====================================================================
-- Cada tenant define sus propios "medios" (ej. "Visa 3 cuotas").
-- Cada uno tiene un recargo opcional aplicado al monto del pago.
--
-- Modelo:
--  - payment_methods_config: catálogo del tenant.
--  - sale_payments.method_config_id: FK opcional.
--  - sale_payments.surcharge_amount: monto exacto de recargo aplicado.
--  - sales.surcharge_total: suma de surcharges del ticket.
--    sales.total = subtotal - discount + surcharge_total.
-- =====================================================================

create table public.payment_methods_config (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  code                 text not null,
  label                text not null,
  payment_method_base  payment_method not null,
  card_brand           text,
  installments         int,
  surcharge_pct        numeric not null default 0,
  active               boolean not null default true,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, code)
);

create index payment_methods_config_tenant_active_idx
  on public.payment_methods_config(tenant_id) where active;

alter table public.payment_methods_config enable row level security;
create policy "tenant_isolation" on public.payment_methods_config for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.payment_methods_config_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_payment_methods_config_updated_at
  before update on public.payment_methods_config
  for each row execute function public.payment_methods_config_touch_updated_at();

alter table public.sale_payments
  add column method_config_id uuid references public.payment_methods_config(id) on delete set null,
  add column surcharge_amount numeric not null default 0;

alter table public.sales
  add column surcharge_total numeric not null default 0;

comment on table public.payment_methods_config is
  'Catálogo de medios de pago configurables por tenant. Sprint PMP.';
comment on column public.payment_methods_config.surcharge_pct is
  'Recargo aplicado al monto del pago. Puede ser negativo (descuento por método).';
comment on column public.sale_payments.surcharge_amount is
  'Monto exacto de recargo aplicado a este pago. amount ya lo incluye.';
comment on column public.sales.surcharge_total is
  'Suma de surcharge_amount de todos los payments. total = subtotal - discount + surcharge_total.';
