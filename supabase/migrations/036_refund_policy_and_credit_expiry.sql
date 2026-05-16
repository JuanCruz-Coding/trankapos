-- =====================================================================
-- Migration 036: política de refund + vencimiento de vales (DEV.fix)
-- =====================================================================
-- tenants.refund_policy: cómo se devuelve el dinero en una devolución
--   cash_or_credit (default): cajero elige caso a caso
--   credit_only             : siempre saldo a favor (vale)
--   cash_only               : siempre efectivo (sin módulo de vales)
--
-- tenants.store_credit_validity_months: meses de vigencia del vale.
--   null = sin vencimiento. Default 12 si querés sumarlo en UI.
--
-- return_reasons.allows_cash_refund: si el motivo permite cash incluso
--   bajo policy='credit_only' (ej: "Defectuoso" — derecho del consumidor
--   bajo Ley 24.240).
--
-- customer_credit_movements.expires_at: vencimiento individual del vale
--   generado por devolución. Calculado al insertar.
-- =====================================================================

alter table public.tenants
  add column refund_policy text not null default 'cash_or_credit'
    check (refund_policy in ('cash_or_credit','credit_only','cash_only')),
  add column store_credit_validity_months int;

alter table public.return_reasons
  add column allows_cash_refund boolean not null default false;

update public.return_reasons
   set allows_cash_refund = true
 where code = 'defective';

alter table public.customer_credit_movements
  add column expires_at timestamptz;

create index customer_credit_movements_expires_at_idx
  on public.customer_credit_movements(expires_at)
  where expires_at is not null;

drop function if exists public.apply_customer_credit_movement(uuid,uuid,numeric,text,uuid,uuid,text,uuid);

create or replace function public.apply_customer_credit_movement(
  p_tenant_id       uuid,
  p_customer_id     uuid,
  p_amount          numeric,
  p_reason          text,
  p_related_sale_id uuid default null,
  p_related_doc_id  uuid default null,
  p_notes           text default null,
  p_created_by      uuid default null,
  p_expires_at      timestamptz default null
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
    related_sale_id, related_doc_id, notes, created_by, expires_at
  ) values (
    p_tenant_id, p_customer_id, p_amount, p_reason,
    p_related_sale_id, p_related_doc_id, p_notes, p_created_by, p_expires_at
  );

  return v_new_balance;
end;
$fn$;

revoke all on function public.apply_customer_credit_movement(uuid,uuid,numeric,text,uuid,uuid,text,uuid,timestamptz) from public;
grant execute on function public.apply_customer_credit_movement(uuid,uuid,numeric,text,uuid,uuid,text,uuid,timestamptz) to service_role;

create or replace function public.get_customer_available_credit(
  p_tenant_id   uuid,
  p_customer_id uuid
) returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from customer_credit_movements
  where tenant_id   = p_tenant_id
    and customer_id = p_customer_id
    and (expires_at is null or expires_at > now());
$$;

revoke all on function public.get_customer_available_credit(uuid,uuid) from public;
grant execute on function public.get_customer_available_credit(uuid,uuid) to service_role, authenticated;

comment on column public.tenants.refund_policy is
  'Política de devolución: cash_or_credit | credit_only | cash_only. Migration 036.';
comment on column public.tenants.store_credit_validity_months is
  'Meses de vigencia del vale generado por devolución. NULL = sin vencimiento.';
comment on column public.return_reasons.allows_cash_refund is
  'Si true, este motivo permite cash incluso bajo refund_policy=credit_only (ej: defectuoso por Ley 24.240).';
comment on column public.customer_credit_movements.expires_at is
  'Vencimiento individual del movement. NULL = no vence. Migration 036.';
