-- =====================================================================
-- TrankaPos · schema multitenant para Supabase
-- =====================================================================
-- Convenciones:
--   * snake_case en todas las columnas (matchea CLAUDE.md global).
--   * tenant_id en cada tabla del POS, RLS en todas.
--   * Limites en plans: NULL = ilimitado.
--   * Roles: owner > manager > cashier.
--
-- Cómo correrlo:
--   1. Abrir Supabase → SQL Editor → New query → pegar este archivo.
--   2. Run. Si todo OK, lo único que vas a hacer después es crear users
--      desde el flujo de signup (que llama a public.create_tenant_for_owner).
--
-- IMPORTANTE: este script NO es idempotente. Para re-correrlo en un
-- proyecto existente, primero hacé DROP de las tablas (o usá una BD nueva).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Extensiones
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";


-- ---------------------------------------------------------------------
-- 2. Tablas SaaS layer (planes, tenants, suscripciones, memberships)
-- ---------------------------------------------------------------------

create table plans (
  id              uuid primary key default uuid_generate_v4(),
  code            text unique not null,         -- 'free' | 'basic' | 'pro' | 'business'
  name            text not null,
  price_monthly   numeric(10,2) not null default 0,
  max_depots      integer,                      -- NULL = ilimitado
  max_users       integer,                      -- NULL = ilimitado
  max_products    integer,                      -- NULL = ilimitado
  features        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table tenants (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text unique,                      -- opcional, para URLs tipo kiosco.trankapos.com
  created_at  timestamptz not null default now()
);

create type subscription_status as enum ('trialing','active','past_due','canceled');

create table subscriptions (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null unique references tenants(id) on delete cascade,
  plan_id               uuid not null references plans(id),
  status                subscription_status not null default 'trialing',
  trial_ends_at         timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  mp_subscription_id    text,                   -- ID de MP Suscripciones (cobro al kiosco)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on subscriptions(tenant_id);

-- profile = perfil del usuario en el POS (datos globales, no específicos de un tenant)
-- el id matchea auth.users.id (Supabase Auth maneja email/password)
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);

create type member_role as enum ('owner','manager','cashier');

create table memberships (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        member_role not null,
  depot_id    uuid,                             -- FK definida más abajo (depots aún no existe)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, tenant_id)
);
create index on memberships(user_id);
create index on memberships(tenant_id);


-- ---------------------------------------------------------------------
-- 3. Tablas del POS
-- ---------------------------------------------------------------------

create table depots (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  address     text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on depots(tenant_id);

-- ahora sí podemos atar memberships.depot_id a depots
alter table memberships
  add constraint memberships_depot_fk
  foreign key (depot_id) references depots(id) on delete set null;

create table categories (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index on categories(tenant_id);

create table products (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  barcode      text,
  price        numeric(12,2) not null default 0,
  cost         numeric(12,2) not null default 0,
  category_id  uuid references categories(id) on delete set null,
  tax_rate     numeric(5,2) not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, barcode)
);
create index on products(tenant_id);
create index on products(tenant_id, category_id);

create table stock_items (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  depot_id    uuid not null references depots(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  qty         numeric(12,3) not null default 0,
  min_qty     numeric(12,3) not null default 0,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, depot_id, product_id)
);
create index on stock_items(tenant_id, depot_id);

create table cash_registers (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  depot_id        uuid not null references depots(id) on delete cascade,
  opened_by       uuid not null references auth.users(id),
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(12,2) not null default 0,
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  closing_amount  numeric(12,2),
  expected_cash   numeric(12,2),
  difference      numeric(12,2),
  notes           text
);
create index on cash_registers(tenant_id, depot_id);
create unique index cash_registers_one_open_per_depot
  on cash_registers(depot_id) where closed_at is null;

create type cash_movement_kind as enum ('in','out');

create table cash_movements (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  register_id  uuid not null references cash_registers(id) on delete cascade,
  kind         cash_movement_kind not null,
  amount       numeric(12,2) not null,
  reason       text not null default '',
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on cash_movements(tenant_id, register_id);

create table sales (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  depot_id     uuid not null references depots(id),
  register_id  uuid references cash_registers(id),
  cashier_id   uuid not null references auth.users(id),
  subtotal     numeric(12,2) not null,
  discount     numeric(12,2) not null default 0,
  total        numeric(12,2) not null,
  voided       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on sales(tenant_id, created_at desc);
create index on sales(tenant_id, depot_id, created_at desc);
create index on sales(tenant_id, voided);

-- sale_items y sale_payments están normalizados (vs el array embebido del modelo local).
-- El motivo es que en SQL los reportes (top productos, ventas por método de pago)
-- salen mucho más prolijos con tablas hijas que con jsonb.
create table sale_items (
  id          uuid primary key default uuid_generate_v4(),
  sale_id     uuid not null references sales(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  product_id  uuid not null references products(id),
  name        text not null,                    -- snapshot al momento de la venta
  barcode     text,                             -- snapshot
  price       numeric(12,2) not null,
  qty         numeric(12,3) not null,
  discount    numeric(12,2) not null default 0,
  subtotal    numeric(12,2) not null
);
create index on sale_items(sale_id);
create index on sale_items(tenant_id, product_id);

create type payment_method as enum ('cash','debit','credit','qr','transfer');

create table sale_payments (
  id         uuid primary key default uuid_generate_v4(),
  sale_id    uuid not null references sales(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  method     payment_method not null,
  amount     numeric(12,2) not null
);
create index on sale_payments(sale_id);

create table transfers (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  from_depot_id  uuid not null references depots(id),
  to_depot_id    uuid not null references depots(id),
  created_by     uuid not null references auth.users(id),
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
create index on transfers(tenant_id, created_at desc);

create table transfer_items (
  id           uuid primary key default uuid_generate_v4(),
  transfer_id  uuid not null references transfers(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  product_id   uuid not null references products(id),
  qty          numeric(12,3) not null
);
create index on transfer_items(transfer_id);


-- ---------------------------------------------------------------------
-- 4. Helpers de RLS — qué tenant y qué rol tiene el usuario logueado
-- ---------------------------------------------------------------------
-- Estas funciones son lo que hace que RLS funcione: cada policy las llama
-- para saber el tenant del usuario actual. Las creamos en `public` (no en
-- `auth`) para no requerir permisos especiales.
--
-- security definer + search_path vacío: práctica recomendada por Supabase
-- para evitar search-path injection.

create or replace function public.tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- MVP: asume 1 membership activa por user. Cuando soportemos
  -- multi-tenant por user, leer current_tenant_id desde auth.jwt().
  select tenant_id
  from public.memberships
  where user_id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.role_in_tenant()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role::text
  from public.memberships
  where user_id = auth.uid()
    and tenant_id = public.tenant_id()
    and active = true
  limit 1
$$;


-- ---------------------------------------------------------------------
-- 5. Activar RLS en todas las tablas
-- ---------------------------------------------------------------------
alter table plans          enable row level security;
alter table tenants        enable row level security;
alter table subscriptions  enable row level security;
alter table profiles       enable row level security;
alter table memberships    enable row level security;
alter table depots         enable row level security;
alter table categories     enable row level security;
alter table products       enable row level security;
alter table stock_items    enable row level security;
alter table cash_registers enable row level security;
alter table cash_movements enable row level security;
alter table sales          enable row level security;
alter table sale_items     enable row level security;
alter table sale_payments  enable row level security;
alter table transfers      enable row level security;
alter table transfer_items enable row level security;


-- ---------------------------------------------------------------------
-- 6. Policies
-- ---------------------------------------------------------------------

-- plans: catálogo público para users autenticados (tienen que ver opciones de upgrade)
create policy plans_read on plans
  for select to authenticated using (true);

-- tenants: solo el propio
create policy tenants_self on tenants
  for select to authenticated
  using (id = public.tenant_id());

-- subscriptions: ver la propia, modificar solo owner
create policy subs_select on subscriptions
  for select to authenticated
  using (tenant_id = public.tenant_id());
create policy subs_update on subscriptions
  for update to authenticated
  using (tenant_id = public.tenant_id() and public.role_in_tenant() = 'owner');

-- profiles: el user ve su perfil + perfiles de gente de su tenant (para listar usuarios)
create policy profiles_select on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id in (select user_id from memberships where tenant_id = public.tenant_id())
  );
create policy profiles_self_update on profiles
  for update to authenticated
  using (id = auth.uid());

-- memberships: ver las del tenant. CRUD completo solo owner.
create policy memberships_select on memberships
  for select to authenticated
  using (tenant_id = public.tenant_id());
create policy memberships_owner_write on memberships
  for all to authenticated
  using (tenant_id = public.tenant_id() and public.role_in_tenant() = 'owner')
  with check (tenant_id = public.tenant_id() and public.role_in_tenant() = 'owner');

-- Resto de tablas: aislamiento total por tenant_id.
-- Loop para no repetir 11 veces el mismo CREATE POLICY.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'depots','categories','products','stock_items',
      'cash_registers','cash_movements',
      'sales','sale_items','sale_payments',
      'transfers','transfer_items'
    ])
  loop
    execute format($f$
      create policy tenant_isolation on %I
        for all to authenticated
        using (tenant_id = public.tenant_id())
        with check (tenant_id = public.tenant_id())
    $f$, t);
  end loop;
end$$;


-- ---------------------------------------------------------------------
-- 7. Trigger: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end$$;

create trigger trg_subs_updated
  before update on subscriptions
  for each row execute function public.set_updated_at();

create trigger trg_stock_updated
  before update on stock_items
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 8. RPC para signup — crea tenant + depot + profile + membership + sub trial
-- ---------------------------------------------------------------------
-- Se llama desde el frontend después de `supabase.auth.signUp(...)`:
--
--   await supabase.rpc('create_tenant_for_owner', {
--     p_tenant_name: 'Kiosco Don Juan',
--     p_depot_name:  'Local Centro',
--     p_owner_name:  'Juan Pérez',
--   });
--
-- security definer: corre con permisos elevados, así puede crear filas en
-- todas las tablas a pesar de que el user nuevo todavía no tiene membership.

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


-- ---------------------------------------------------------------------
-- 9. Seed de planes (precios en 0, los afinás cuando definas montos)
-- ---------------------------------------------------------------------
insert into plans (code, name, price_monthly, max_depots, max_users, max_products, features) values
  ('free', 'Free Trial', 0,
   1, 2, 100,
   '{"transfers": true, "advanced_reports": true, "csv_export": true, "api": false}'::jsonb),

  ('basic', 'Básico', 0,
   1, 2, null,
   '{"transfers": false, "advanced_reports": false, "csv_export": false, "api": false}'::jsonb),

  ('pro', 'Pro', 0,
   3, 10, null,
   '{"transfers": true, "advanced_reports": true, "csv_export": true, "api": false}'::jsonb),

  ('business', 'Empresa', 0,
   null, null, null,
   '{"transfers": true, "advanced_reports": true, "csv_export": true, "api": true}'::jsonb);
