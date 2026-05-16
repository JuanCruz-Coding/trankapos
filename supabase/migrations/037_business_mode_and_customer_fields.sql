-- =====================================================================
-- Migration 037: Business mode + customer fields extra + required config
-- =====================================================================
-- Sprint CRM-RETAIL.
--
-- tenants.business_mode: 'kiosk' | 'retail'. Default 'kiosk' para no
-- romper kioscos existentes.
--
-- tenants.business_subtype: subtipo informativo del rubro retail
-- (clothing, electronics, home, pharmacy, other). Más adelante puede
-- precargar attribute keys para variantes.
--
-- tenants.customer_required_fields jsonb: configuración granular de qué
-- datos del cliente son obligatorios al cargarlo.
--
-- customers gana: phone, address, city, state_province, birthdate,
-- marketing_opt_in.
--
-- Triggers:
--   tr_tenants_apply_business_mode_preset (AFTER INSERT): si el tenant
--   se crea con business_mode='retail', aplica defaults sugeridos.
--
-- RPCs: tenant_apply_business_mode_preset + get_customer_sales_stats.
-- =====================================================================

alter table public.tenants
  add column business_mode text not null default 'kiosk'
    check (business_mode in ('kiosk','retail')),
  add column business_subtype text,
  add column customer_required_fields jsonb not null default jsonb_build_object(
    'docNumber',     false,
    'ivaCondition',  false,
    'phone',         false,
    'email',         false,
    'address',       false,
    'birthdate',     false
  );

alter table public.customers
  add column phone text,
  add column address text,
  add column city text,
  add column state_province text,
  add column birthdate date,
  add column marketing_opt_in boolean not null default false;

create index customers_marketing_opt_in_idx
  on public.customers(tenant_id) where marketing_opt_in;

create or replace function public.tenants_apply_business_mode_preset()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_mode = 'retail' then
    update public.tenants
       set refund_policy = 'credit_only',
           store_credit_validity_months = 6,
           customer_required_fields = jsonb_build_object(
             'docNumber',    true,
             'ivaCondition', true,
             'phone',        true,
             'email',        false,
             'address',      false,
             'birthdate',    false
           )
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_tenants_apply_business_mode_preset on public.tenants;
create trigger tr_tenants_apply_business_mode_preset
  after insert on public.tenants
  for each row execute function public.tenants_apply_business_mode_preset();

create or replace function public.tenant_apply_business_mode_preset(
  p_tenant_id uuid,
  p_mode      text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_mode not in ('kiosk','retail') then
    raise exception 'mode inválido: %', p_mode;
  end if;
  if p_mode = 'retail' then
    update public.tenants
       set business_mode = 'retail',
           refund_policy = 'credit_only',
           store_credit_validity_months = 6,
           customer_required_fields = jsonb_build_object(
             'docNumber',    true,
             'ivaCondition', true,
             'phone',        true,
             'email',        false,
             'address',      false,
             'birthdate',    false
           )
     where id = p_tenant_id;
  else
    update public.tenants
       set business_mode = 'kiosk',
           refund_policy = 'cash_or_credit',
           store_credit_validity_months = null,
           customer_required_fields = jsonb_build_object(
             'docNumber',    false,
             'ivaCondition', false,
             'phone',        false,
             'email',        false,
             'address',      false,
             'birthdate',    false
           )
     where id = p_tenant_id;
  end if;
end;
$fn$;

revoke all on function public.tenant_apply_business_mode_preset(uuid,text) from public;
grant execute on function public.tenant_apply_business_mode_preset(uuid,text) to service_role, authenticated;

create or replace function public.get_customer_sales_stats(
  p_tenant_id   uuid,
  p_customer_id uuid
) returns table (
  total_spent      numeric,
  sales_count      bigint,
  last_sale_at     timestamptz,
  first_sale_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.total), 0) as total_spent,
    count(*)                  as sales_count,
    max(s.created_at)         as last_sale_at,
    min(s.created_at)         as first_sale_at
  from public.sales s
  where s.tenant_id = p_tenant_id
    and s.customer_id = p_customer_id
    and s.voided = false;
$$;

revoke all on function public.get_customer_sales_stats(uuid,uuid) from public;
grant execute on function public.get_customer_sales_stats(uuid,uuid) to service_role, authenticated;

comment on column public.tenants.business_mode is
  'Modo del negocio (kiosk|retail). Default kiosk. Sprint CRM-RETAIL.';
comment on column public.tenants.business_subtype is
  'Subtipo informativo (clothing/electronics/etc). Solo retail.';
comment on column public.tenants.customer_required_fields is
  'JSON con flags de campos obligatorios al cargar customer: {docNumber, ivaCondition, phone, email, address, birthdate}.';
comment on column public.customers.marketing_opt_in is
  'Cliente acepta recibir comunicaciones de marketing. Ley 25.326.';
