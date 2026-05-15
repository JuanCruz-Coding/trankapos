-- =====================================================================
-- Migration 033: motivos de devolución (Sprint DEV)
-- =====================================================================
-- Cada motivo tiene un comportamiento de stock_destination que decide qué
-- pasa con el item devuelto:
--   - 'original'           : vuelve al depósito original (default).
--   - 'specific_warehouse' : va al warehouse_id configurado (típicamente
--                             un depósito "Service" o "Merma" sin POS).
--   - 'discard'            : no se ingresa a ningún depósito (pérdida).
-- =====================================================================

create table public.return_reasons (
  id                        uuid primary key default uuid_generate_v4(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  code                      text not null,
  label                     text not null,
  stock_destination         text not null default 'original'
                             check (stock_destination in ('original','specific_warehouse','discard')),
  destination_warehouse_id  uuid references public.warehouses(id) on delete set null,
  active                    boolean not null default true,
  sort_order                int not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (tenant_id, code)
);

create index return_reasons_tenant_active_idx
  on public.return_reasons(tenant_id) where active;

alter table public.return_reasons enable row level security;

create policy "tenant_isolation"
  on public.return_reasons for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.return_reasons_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger tr_return_reasons_updated_at
  before update on public.return_reasons
  for each row execute function public.return_reasons_touch_updated_at();

-- Seed: 5 motivos default para cada tenant existente
insert into public.return_reasons (tenant_id, code, label, stock_destination, sort_order)
select t.id, x.code, x.label, x.stock_dest, x.sort_order
from public.tenants t
cross join (values
  ('wrong_size',  'Talle / medida incorrecta', 'original',           10),
  ('not_liked',   'No gustó',                  'original',           20),
  ('preference',  'Cambio de preferencia',     'original',           30),
  ('defective',   'Defectuoso',                'discard',             40),
  ('cashier_error','Error del cajero',         'original',           50)
) as x(code, label, stock_dest, sort_order)
on conflict (tenant_id, code) do nothing;

-- Trigger: seed automático para tenants nuevos
create or replace function public.tenants_seed_return_reasons()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.return_reasons (tenant_id, code, label, stock_destination, sort_order)
  values
    (new.id, 'wrong_size',   'Talle / medida incorrecta', 'original', 10),
    (new.id, 'not_liked',    'No gustó',                  'original', 20),
    (new.id, 'preference',   'Cambio de preferencia',     'original', 30),
    (new.id, 'defective',    'Defectuoso',                'discard',  40),
    (new.id, 'cashier_error','Error del cajero',          'original', 50)
  on conflict (tenant_id, code) do nothing;
  return new;
end; $$;

drop trigger if exists tr_tenants_seed_return_reasons on public.tenants;
create trigger tr_tenants_seed_return_reasons
  after insert on public.tenants
  for each row execute function public.tenants_seed_return_reasons();

comment on table public.return_reasons is
  'Motivos de devolución/cambio configurables por tenant. Seed de 5 default; el owner puede editar/agregar/borrar desde Settings.';
