-- =====================================================================
-- Migration 006: Sprint 2 quick wins
-- =====================================================================
-- Dos fixes chicos detectados en el QA del 2026-05-08:
--
-- 1) Cash registers: hoy nada impide tener 2 cajas abiertas en el mismo
--    depósito. Con dos pestañas / dos cajeros simultáneos en el mismo
--    depot la UI permite abrir una segunda caja y los reportes de cash
--    arrancan a divergir. Un partial unique index lo cierra a nivel base
--    sin afectar las cajas históricas (ya cerradas).
--
-- 2) create_tenant_for_owner: la función no chequea si el usuario ya
--    tiene una membership. Un doble click en el signup, o un retry del
--    cliente, crea un segundo tenant con la misma membership y deja
--    al usuario en un estado raro (¿en cuál tenant entra?). El guard
--    al inicio resuelve el TOCTOU sin tocar la lógica posterior.
--
-- Pre-flight check antes de aplicar el partial unique en prod:
--   select depot_id, count(*) from cash_registers
--   where closed_at is null group by depot_id having count(*) > 1;
--   -- si devuelve filas, cerrar manualmente las duplicadas antes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Partial unique index — una sola caja abierta por depósito
-- ---------------------------------------------------------------------
create unique index if not exists cash_registers_one_open_per_depot
  on cash_registers(depot_id)
  where closed_at is null;


-- ---------------------------------------------------------------------
-- 2. Guard en create_tenant_for_owner contra doble signup
-- ---------------------------------------------------------------------
create or replace function public.create_tenant_for_owner(
  p_tenant_name text,
  p_depot_name  text,
  p_owner_name  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id  uuid;
  v_depot_id   uuid;
  v_plan_free  uuid;
  v_email      text;
begin
  if auth.uid() is null then
    raise exception 'No authenticated user';
  end if;

  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'User already has a tenant';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into tenants(name) values (p_tenant_name)
  returning id into v_tenant_id;

  insert into depots(tenant_id, name) values (v_tenant_id, p_depot_name)
  returning id into v_depot_id;

  insert into profiles(id, name, email)
  values (auth.uid(), p_owner_name, v_email)
  on conflict (id) do update set name = excluded.name;

  insert into memberships(user_id, tenant_id, role, depot_id)
  values (auth.uid(), v_tenant_id, 'owner', v_depot_id);

  select id into v_plan_free from plans where code = 'free';
  insert into subscriptions(tenant_id, plan_id, status, trial_ends_at)
  values (v_tenant_id, v_plan_free, 'trialing', now() + interval '14 days');

  return v_tenant_id;
end$$;
