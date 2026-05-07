-- =====================================================================
-- Migration 001: chequeos de límite de plan
-- =====================================================================
-- Triggers BEFORE INSERT que rechazan crear depots / products / memberships
-- si el tenant ya alcanzó el max_X de su plan. Convención: NULL = ilimitado.
--
-- Cómo correrlo: pegar todo este archivo en SQL Editor → Run.
-- Es idempotente (drop + create), se puede correr varias veces sin romper.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Reordenar create_tenant_for_owner: subscription antes que depot/membership
-- ---------------------------------------------------------------------
-- Necesario porque los triggers (más abajo) chequean la subscription para
-- saber el plan; si la subscription no existe todavía, el trigger no
-- encuentra max_X y dejaría pasar siempre — peor: el orden viejo creaba
-- el depot/membership ANTES que el sub, así que el primer kiosco no
-- tendría sub al momento de los triggers.

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

  select email into v_email from auth.users where id = auth.uid();

  insert into tenants(name) values (p_tenant_name)
  returning id into v_tenant_id;

  -- subscription primero
  select id into v_plan_free from plans where code = 'free';
  insert into subscriptions(tenant_id, plan_id, status, trial_ends_at)
  values (v_tenant_id, v_plan_free, 'trialing', now() + interval '14 days');

  -- ahora sí el depot (los triggers van a encontrar la subscription)
  insert into depots(tenant_id, name) values (v_tenant_id, p_depot_name)
  returning id into v_depot_id;

  insert into profiles(id, name, email)
  values (auth.uid(), p_owner_name, v_email)
  on conflict (id) do update set name = excluded.name;

  insert into memberships(user_id, tenant_id, role, depot_id)
  values (auth.uid(), v_tenant_id, 'owner', v_depot_id);

  return v_tenant_id;
end$$;


-- ---------------------------------------------------------------------
-- 2. Funciones de chequeo + triggers
-- ---------------------------------------------------------------------
-- Patrón: cada función lee el max_X del plan del tenant. Si NULL → pasa.
-- Si no, cuenta filas actuales y compara. Si llegó al tope, raise exception.

-- DEPOTS

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

drop trigger if exists trg_enforce_depot_limit on depots;
create trigger trg_enforce_depot_limit
  before insert on depots
  for each row execute function public.enforce_depot_limit();


-- PRODUCTS

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

drop trigger if exists trg_enforce_product_limit on products;
create trigger trg_enforce_product_limit
  before insert on products
  for each row execute function public.enforce_product_limit();


-- MEMBERSHIPS (defensa en profundidad: la Edge Function ya valida, pero
-- duplicamos en SQL para que cualquier path de inserción respete el límite)

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
  -- Solo aplicamos límite a memberships activas. Una membership inactiva
  -- (active=false) no consume cupo del plan.
  if NEW.active = false then
    return NEW;
  end if;

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

drop trigger if exists trg_enforce_membership_limit on memberships;
create trigger trg_enforce_membership_limit
  before insert on memberships
  for each row execute function public.enforce_membership_limit();
