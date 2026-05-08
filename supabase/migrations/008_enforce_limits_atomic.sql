-- =====================================================================
-- Migration 008: cerrar TOCTOU en triggers enforce_*_limit
-- =====================================================================
-- Los 3 triggers de migration 001 (depots, products, memberships) hacen
-- `select count(*)` y comparan contra max_X del plan. Sin un lock entre el
-- count y el insert, dos inserts concurrentes del mismo tenant pueden
-- ambos leer count = N y ambos pasar el check, terminando con N+2 filas
-- aunque el límite sea N+1.
--
-- Reproducción real:
-- - Plan Básico (max_users = 2). Tenant ya tiene 1 user.
-- - Owner A llama a create-team-user; Owner A2 (otro device) también.
-- - Ambas requests cuentan = 1 < 2 → ambas pasan el check.
-- - Ambas insertan → tenant termina con 3 users en plan que solo permite 2.
--
-- Solución: pg_advisory_xact_lock con namespace por tipo de límite +
-- tenant_id. Serializa los inserts concurrentes del mismo tenant, libera
-- el lock al finalizar la transacción. No bloquea a otros tenants.
-- =====================================================================


-- ---------------------------------------------------------------------
-- DEPOTS
-- ---------------------------------------------------------------------
create or replace function public.enforce_depot_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtext('depot_limit:' || NEW.tenant_id::text)::bigint
  );

  select p.max_depots into v_max
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.tenant_id = NEW.tenant_id;

  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_count from depots where tenant_id = NEW.tenant_id;
  if v_count >= v_max then
    raise exception 'Llegaste al límite de tu plan (% sucursales). Actualizá el plan para agregar más.', v_max
      using errcode = 'P0001';
  end if;

  return NEW;
end$$;


-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
create or replace function public.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtext('product_limit:' || NEW.tenant_id::text)::bigint
  );

  select p.max_products into v_max
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.tenant_id = NEW.tenant_id;

  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_count from products where tenant_id = NEW.tenant_id;
  if v_count >= v_max then
    raise exception 'Llegaste al límite de tu plan (% productos). Actualizá el plan para agregar más.', v_max
      using errcode = 'P0001';
  end if;

  return NEW;
end$$;


-- ---------------------------------------------------------------------
-- MEMBERSHIPS
-- ---------------------------------------------------------------------
create or replace function public.enforce_membership_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   integer;
  v_count integer;
begin
  -- Memberships inactivas no consumen cupo: salir antes del lock.
  if NEW.active = false then
    return NEW;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('membership_limit:' || NEW.tenant_id::text)::bigint
  );

  select p.max_users into v_max
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.tenant_id = NEW.tenant_id;

  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_count
  from memberships
  where tenant_id = NEW.tenant_id and active = true;

  if v_count >= v_max then
    raise exception 'Llegaste al límite de tu plan (% usuarios). Actualizá el plan para agregar más.', v_max
      using errcode = 'P0001';
  end if;

  return NEW;
end$$;
