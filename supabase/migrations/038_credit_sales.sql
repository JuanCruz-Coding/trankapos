-- =====================================================================
-- Migration 038: ventas a cuenta corriente (vender fiado) — Sprint FIA
-- =====================================================================
-- Modelo: la venta se cierra normal pero con `payment_method='on_account'`
-- (nuevo enum). El monto fiado se carga como movement negativo en
-- customer_credits, dejando al cliente con balance negativo (deuda).
-- Posteriormente, el comercio registra el pago con `recordCreditPayment`
-- que crea un movement positivo (reason='fiado_payment').
--
-- Por qué `on_account` y no reusar `credit`: `credit` ya significa
-- "tarjeta de crédito" en el sistema. Mezclarlos confunde reportes y UX.
-- =====================================================================

alter type payment_method add value if not exists 'on_account';

alter table public.tenants
  add column credit_sales_enabled boolean not null default false,
  add column credit_sales_default_limit numeric;

alter table public.customers
  add column credit_limit numeric;

comment on column public.tenants.credit_sales_enabled is
  'Si true, el POS muestra opcion "Cuenta corriente" como medio de pago. Sprint FIA.';
comment on column public.tenants.credit_sales_default_limit is
  'Limite default de deuda por cliente (negativo cuando hay saldo). NULL = sin limite.';
comment on column public.customers.credit_limit is
  'Override del limite default del tenant para este cliente. NULL = usa el default.';

create or replace function public.validate_customer_credit_limit(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_amount      numeric
) returns table (
  ok            boolean,
  current_debt  numeric,
  limit_amount  numeric,
  reason        text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance       numeric;
  v_tenant_limit  numeric;
  v_customer_limit numeric;
  v_effective_limit numeric;
  v_new_debt      numeric;
begin
  if p_customer_id is null then
    return query select false, 0::numeric, null::numeric, 'Se requiere cliente identificado para fiar';
    return;
  end if;

  select balance into v_balance
    from public.customer_credits
   where tenant_id = p_tenant_id and customer_id = p_customer_id;
  v_balance := coalesce(v_balance, 0);

  select credit_sales_default_limit into v_tenant_limit
    from public.tenants where id = p_tenant_id;
  select credit_limit into v_customer_limit
    from public.customers where id = p_customer_id;
  v_effective_limit := coalesce(v_customer_limit, v_tenant_limit);

  v_new_debt := (case when v_balance < 0 then -v_balance else 0 end) + p_amount;

  if v_effective_limit is null then
    return query select true, v_new_debt, null::numeric, null::text;
    return;
  end if;

  if v_new_debt > v_effective_limit then
    return query select
      false,
      v_new_debt,
      v_effective_limit,
      format('La deuda total (%s) superaría el limite del cliente (%s)',
             v_new_debt::text, v_effective_limit::text);
  else
    return query select true, v_new_debt, v_effective_limit, null::text;
  end if;
end;
$fn$;

revoke all on function public.validate_customer_credit_limit(uuid,uuid,numeric) from public;
grant execute on function public.validate_customer_credit_limit(uuid,uuid,numeric) to service_role, authenticated;
