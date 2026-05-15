-- =====================================================================
-- Migration 035: saldo a favor / cuenta corriente del cliente
-- =====================================================================
-- customer_credits.balance:
--   - Positivo = saldo a favor (vale, devolución no cobrada).
--   - Negativo = fiado (no implementado; el schema lo soporta).
--
-- customer_credit_movements: audit trail de cada cambio de balance.
-- =====================================================================

create table public.customer_credits (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  balance     numeric not null default 0,
  currency    text not null default 'ARS',
  updated_at  timestamptz not null default now(),
  unique (tenant_id, customer_id, currency)
);

create index customer_credits_tenant_idx on public.customer_credits(tenant_id);

create table public.customer_credit_movements (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  amount          numeric not null,
  reason          text not null check (reason in ('return_credit','sale_payment','manual_adjust','fiado','fiado_payment')),
  related_sale_id uuid references public.sales(id) on delete set null,
  related_doc_id  uuid references public.afip_documents(id) on delete set null,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create index customer_credit_movements_customer_idx
  on public.customer_credit_movements(customer_id, created_at desc);

alter table public.customer_credits          enable row level security;
alter table public.customer_credit_movements enable row level security;

create policy "tenant_isolation" on public.customer_credits
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create policy "tenant_isolation" on public.customer_credit_movements
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create or replace function public.apply_customer_credit_movement(
  p_tenant_id       uuid,
  p_customer_id     uuid,
  p_amount          numeric,
  p_reason          text,
  p_related_sale_id uuid default null,
  p_related_doc_id  uuid default null,
  p_notes           text default null,
  p_created_by      uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_new_balance numeric;
begin
  if p_reason not in ('return_credit','sale_payment','manual_adjust','fiado','fiado_payment') then
    raise exception 'reason inválido: %', p_reason;
  end if;

  insert into public.customer_credits (tenant_id, customer_id, balance)
  values (p_tenant_id, p_customer_id, p_amount)
  on conflict (tenant_id, customer_id, currency) do update
    set balance    = customer_credits.balance + excluded.balance,
        updated_at = now()
  returning balance into v_new_balance;

  insert into public.customer_credit_movements (
    tenant_id, customer_id, amount, reason,
    related_sale_id, related_doc_id, notes, created_by
  ) values (
    p_tenant_id, p_customer_id, p_amount, p_reason,
    p_related_sale_id, p_related_doc_id, p_notes, p_created_by
  );

  return v_new_balance;
end;
$fn$;

revoke all on function public.apply_customer_credit_movement(uuid,uuid,numeric,text,uuid,uuid,text,uuid) from public;
grant execute on function public.apply_customer_credit_movement(uuid,uuid,numeric,text,uuid,uuid,text,uuid) to service_role;

comment on table public.customer_credits is
  'Saldo del cliente. Positivo=a favor (vale). Negativo=fiado (no implementado). Migration 035 (Sprint DEV).';
comment on column public.customer_credit_movements.reason is
  'return_credit | sale_payment | manual_adjust | fiado | fiado_payment';
