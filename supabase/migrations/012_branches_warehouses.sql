-- =====================================================================
-- Migration 012: separar sucursales (branches) de depósitos (warehouses)
-- =====================================================================
-- Hasta ahora `depots` cumplía dos roles distintos en uno: sucursal física
-- (donde está la caja, donde se vende) y depósito de stock (donde están
-- las cantidades). Cada cliente tenía 1 fila = 1 lugar.
--
-- A partir de esta migration:
--   * `branches` es la sucursal física. Tiene cajas, ventas, cajeros.
--   * `warehouses` es el depósito de stock. Pertenece a una branch
--     (`branch_id` NOT NULL para depósitos de sucursal) o es central
--     del tenant (`branch_id` IS NULL — feature de plan Empresa).
--   * Cada branch tiene exactamente 1 warehouse `is_default = true`
--     que es desde el cual el POS resta stock por default.
--
-- Modelo de datos:
--   stock_items.warehouse_id        — el stock vive en warehouses
--   transfers.from_warehouse_id     — las transferencias se hacen warehouse↔warehouse
--   transfers.to_warehouse_id
--   cash_registers.branch_id        — las cajas son de la sucursal
--   sales.branch_id                 — la venta se registra a la sucursal
--   memberships.branch_id           — el cajero se asigna a una sucursal
--
-- Cambios en plans:
--   max_depots → max_branches
--   + max_warehouses_per_branch (nuevo)
--   + features ampliadas (scanner_camera, csv_import, customers, multi_cash,
--     variants, purchases, audit_log, granular_perms, webhooks, custom_branding,
--     central_warehouse)
--
-- IMPORTANTE: esta migration es destructiva (drop columnas y tabla `depots`).
-- Idempotencia parcial: las creaciones de tablas/columnas usan IF NOT EXISTS,
-- pero los drops y backfills no son seguros para correr dos veces. Hacé
-- backup desde el dashboard de Supabase antes de aplicarla.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Pre-flight: si ya hay branches creadas, abortar (evita correr dos veces).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'branches') then
    raise exception 'La tabla branches ya existe. Esta migration ya fue aplicada.';
  end if;
end$$;


-- ---------------------------------------------------------------------
-- 1. Tabla branches (sucursales) — clon estructural de depots.
-- ---------------------------------------------------------------------
-- Mismo schema que `depots` así el backfill es trivial. Los IDs se preservan
-- (branches.id == depots.id) para que las columnas que renombramos a
-- branch_id no necesiten remapeo.
create table public.branches (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  address     text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index branches_tenant_idx on public.branches(tenant_id);

insert into public.branches (id, tenant_id, name, address, active, created_at)
select id, tenant_id, name, address, active, created_at
from public.depots;


-- ---------------------------------------------------------------------
-- 2. Tabla warehouses (depósitos) — donde realmente vive el stock.
-- ---------------------------------------------------------------------
-- branch_id NULL = depósito central del tenant (feature de plan Empresa).
-- is_default = true marca al warehouse principal de cada branch (el que
-- usa el POS por default). Constraint partial unique para que no haya
-- dos defaults activos en la misma branch.
create table public.warehouses (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,  -- NULL = central
  name        text not null,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index warehouses_tenant_idx on public.warehouses(tenant_id);
create index warehouses_branch_idx on public.warehouses(branch_id);

create unique index warehouses_one_default_per_branch
  on public.warehouses(branch_id)
  where is_default = true and active = true and branch_id is not null;

-- Por cada branch existente, creamos 1 warehouse default con el mismo
-- nombre. Lo que era "1 depot" pasa a ser "1 branch + 1 warehouse default".
insert into public.warehouses (tenant_id, branch_id, name, is_default, active, created_at)
select tenant_id, id, name, true, active, created_at
from public.branches;


-- ---------------------------------------------------------------------
-- 3. Agregar columnas nuevas en las tablas que referenciaban depot_id.
-- ---------------------------------------------------------------------
-- Las creo nullable para poder backfillear; al final las paso a NOT NULL
-- (excepto memberships.branch_id, que ya era NULL en memberships.depot_id).

alter table public.stock_items
  add column warehouse_id uuid references public.warehouses(id) on delete cascade;

alter table public.transfers
  add column from_warehouse_id uuid references public.warehouses(id),
  add column to_warehouse_id   uuid references public.warehouses(id);

alter table public.cash_registers
  add column branch_id uuid references public.branches(id) on delete cascade;

alter table public.sales
  add column branch_id uuid references public.branches(id);

alter table public.memberships
  add column branch_id uuid references public.branches(id) on delete set null;


-- ---------------------------------------------------------------------
-- 4. Backfill: poblar las columnas nuevas desde las viejas.
-- ---------------------------------------------------------------------
-- Reglas de mapeo:
--   * cash_registers.branch_id = cash_registers.depot_id (porque branches.id == depots.id).
--   * sales.branch_id          = sales.depot_id.
--   * memberships.branch_id    = memberships.depot_id.
--   * stock_items.warehouse_id = warehouse default de la branch que matchea con el depot viejo.
--   * transfers.from/to_warehouse_id = warehouse default de la branch correspondiente.

update public.cash_registers
set branch_id = depot_id;

update public.sales
set branch_id = depot_id;

update public.memberships
set branch_id = depot_id
where depot_id is not null;

update public.stock_items s
set warehouse_id = w.id
from public.warehouses w
where w.branch_id = s.depot_id
  and w.is_default = true;

update public.transfers t
set from_warehouse_id = w.id
from public.warehouses w
where w.branch_id = t.from_depot_id
  and w.is_default = true;

update public.transfers t
set to_warehouse_id = w.id
from public.warehouses w
where w.branch_id = t.to_depot_id
  and w.is_default = true;


-- ---------------------------------------------------------------------
-- 5. NOT NULL y unique constraints en las nuevas columnas.
-- ---------------------------------------------------------------------
alter table public.stock_items
  alter column warehouse_id set not null;

alter table public.transfers
  alter column from_warehouse_id set not null,
  alter column to_warehouse_id   set not null;

alter table public.cash_registers
  alter column branch_id set not null;

alter table public.sales
  alter column branch_id set not null;

-- memberships.branch_id sigue siendo nullable (igual que depot_id).

-- Unique de stock_items: ahora por warehouse en lugar de depot.
alter table public.stock_items
  drop constraint if exists stock_items_tenant_id_depot_id_product_id_key;
alter table public.stock_items
  add constraint stock_items_tenant_warehouse_product_uk
  unique (tenant_id, warehouse_id, product_id);

-- Recrear el partial unique index de cash_registers contra branch_id.
drop index if exists public.cash_registers_one_open_per_depot;
create unique index cash_registers_one_open_per_branch
  on public.cash_registers(branch_id)
  where closed_at is null;


-- ---------------------------------------------------------------------
-- 6. Drop columnas viejas y tabla depots.
-- ---------------------------------------------------------------------
-- En este punto todo el sistema referencia branches/warehouses; las
-- columnas depot_id y la tabla depots ya no se usan.

alter table public.stock_items     drop column depot_id;
alter table public.transfers       drop column from_depot_id, drop column to_depot_id;
alter table public.cash_registers  drop column depot_id;
alter table public.sales           drop column depot_id;
alter table public.memberships     drop column depot_id;

-- Dropear policies viejas de depots antes de dropear la tabla.
drop policy if exists tenant_isolation on public.depots;

-- Dropear triggers viejos asociados a depots (recreamos análogos sobre branches/warehouses abajo).
drop trigger if exists trg_enforce_depot_limit on public.depots;
drop function if exists public.enforce_depot_limit();

drop table public.depots;


-- ---------------------------------------------------------------------
-- 7. RLS para las tablas nuevas.
-- ---------------------------------------------------------------------
alter table public.branches    enable row level security;
alter table public.warehouses  enable row level security;

create policy tenant_isolation on public.branches
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

create policy tenant_isolation on public.warehouses
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());


-- ---------------------------------------------------------------------
-- 8. plans: renombrar max_depots → max_branches + agregar max_warehouses_per_branch.
-- ---------------------------------------------------------------------
alter table public.plans rename column max_depots to max_branches;
alter table public.plans add column if not exists max_warehouses_per_branch integer;

comment on column public.plans.max_branches is
  'Máximo de sucursales por tenant. NULL = ilimitado.';
comment on column public.plans.max_warehouses_per_branch is
  'Máximo de depósitos (warehouses) por sucursal. NULL = ilimitado.';


-- ---------------------------------------------------------------------
-- 9. UPDATE planes con la matriz nueva.
-- ---------------------------------------------------------------------
-- Free Trial: durante 14 días, todo Pro + central warehouse para probar.
update public.plans
set max_branches              = 1,
    max_warehouses_per_branch = 1,
    max_users                 = 2,
    max_products              = 100,
    features = jsonb_build_object(
      'scanner_camera',  true,
      'csv_import',      true,
      'csv_export',      true,
      'advanced_reports',true,
      'transfers',       true,
      'customers',       true,
      'multi_cash',      true,
      'variants',        true,
      'purchases',       true,
      'audit_log',       true,
      'granular_perms',  true,
      'api',             true,
      'webhooks',        true,
      'custom_branding', true,
      'central_warehouse', true
    )
where code = 'free';

-- Básico: POS puro. 1 sucursal, 1 depósito, sin features extras.
update public.plans
set max_branches              = 1,
    max_warehouses_per_branch = 1,
    max_users                 = 3,
    max_products              = 500,
    features = jsonb_build_object(
      'scanner_camera',  false,
      'csv_import',      false,
      'csv_export',      false,
      'advanced_reports',false,
      'transfers',       false,
      'customers',       false,
      'multi_cash',      false,
      'variants',        false,
      'purchases',       false,
      'audit_log',       false,
      'granular_perms',  false,
      'api',             false,
      'webhooks',        false,
      'custom_branding', false,
      'central_warehouse', false
    )
where code = 'basic';

-- Pro: 3 sucursales, hasta 2 depósitos por sucursal. Features de operación.
update public.plans
set max_branches              = 3,
    max_warehouses_per_branch = 2,
    max_users                 = 10,
    max_products              = null,
    features = jsonb_build_object(
      'scanner_camera',  true,
      'csv_import',      true,
      'csv_export',      true,
      'advanced_reports',true,
      'transfers',       true,
      'customers',       true,
      'multi_cash',      true,
      'variants',        false,
      'purchases',       false,
      'audit_log',       false,
      'granular_perms',  false,
      'api',             false,
      'webhooks',        false,
      'custom_branding', false,
      'central_warehouse', false
    )
where code = 'pro';

-- Empresa: ilimitado todo + central warehouse + features avanzadas.
update public.plans
set max_branches              = null,
    max_warehouses_per_branch = null,
    max_users                 = null,
    max_products              = null,
    features = jsonb_build_object(
      'scanner_camera',  true,
      'csv_import',      true,
      'csv_export',      true,
      'advanced_reports',true,
      'transfers',       true,
      'customers',       true,
      'multi_cash',      true,
      'variants',        true,
      'purchases',       true,
      'audit_log',       true,
      'granular_perms',  true,
      'api',             true,
      'webhooks',        true,
      'custom_branding', true,
      'central_warehouse', true
    )
where code = 'business';


-- ---------------------------------------------------------------------
-- 10. Triggers de límites: branches + warehouses (los de products/users quedan).
-- ---------------------------------------------------------------------
-- enforce_branch_limit: el viejo enforce_depot_limit, renombrado y apuntando
-- a la columna max_branches. Mantiene el advisory lock para cerrar TOCTOU
-- (mismo patrón que migration 008).

create or replace function public.enforce_branch_limit()
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
    hashtext('branch_limit:' || NEW.tenant_id::text)::bigint
  );

  select p.max_branches into v_max
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.tenant_id = NEW.tenant_id;

  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_count from branches where tenant_id = NEW.tenant_id;
  if v_count >= v_max then
    raise exception 'Llegaste al límite de tu plan (% sucursales). Actualizá el plan para agregar más.', v_max
      using errcode = 'P0001';
  end if;

  return NEW;
end$$;

drop trigger if exists trg_enforce_branch_limit on public.branches;
create trigger trg_enforce_branch_limit
  before insert on public.branches
  for each row execute function public.enforce_branch_limit();


-- enforce_warehouse_per_branch_limit: el límite es por branch, no por tenant.
-- Para warehouses centrales (branch_id IS NULL), exige el flag features.central_warehouse.
create or replace function public.enforce_warehouse_per_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max         integer;
  v_count       integer;
  v_features    jsonb;
  v_can_central boolean;
begin
  -- Lock por branch (o por tenant para warehouses centrales) para cerrar TOCTOU.
  perform pg_advisory_xact_lock(
    hashtext('wh_limit:' || NEW.tenant_id::text || ':' || coalesce(NEW.branch_id::text, 'central'))::bigint
  );

  select p.max_warehouses_per_branch, p.features
  into v_max, v_features
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.tenant_id = NEW.tenant_id;

  -- Warehouse central: no consume cupo de branch, pero requiere feature flag.
  if NEW.branch_id is null then
    v_can_central := coalesce((v_features->>'central_warehouse')::boolean, false);
    if not v_can_central then
      raise exception 'Tu plan no permite depósitos centrales. Actualizá a Empresa para crearlos.'
        using errcode = 'P0001';
    end if;
    return NEW;
  end if;

  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_count
  from warehouses
  where branch_id = NEW.branch_id;

  if v_count >= v_max then
    raise exception 'Llegaste al límite de tu plan (% depósitos por sucursal). Actualizá el plan para agregar más.', v_max
      using errcode = 'P0001';
  end if;

  return NEW;
end$$;

drop trigger if exists trg_enforce_warehouse_limit on public.warehouses;
create trigger trg_enforce_warehouse_limit
  before insert on public.warehouses
  for each row execute function public.enforce_warehouse_per_branch_limit();


-- ---------------------------------------------------------------------
-- 11. RPC create_tenant_for_owner — ahora crea branch + warehouse default.
-- ---------------------------------------------------------------------
-- Nota: el parámetro p_depot_name lo dejamos así por backward-compat con
-- los clientes existentes que llaman a la RPC. En la signup nueva (paso
-- siguiente del sprint) se renombra el campo.
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
  v_tenant_id    uuid;
  v_branch_id    uuid;
  v_warehouse_id uuid;
  v_plan_free    uuid;
  v_email        text;
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

  -- Subscription primero (los triggers leen el plan para validar límites)
  select id into v_plan_free from plans where code = 'free';
  insert into subscriptions(tenant_id, plan_id, status, trial_ends_at)
  values (v_tenant_id, v_plan_free, 'trialing', now() + interval '14 days');

  -- Branch + warehouse default
  insert into branches(tenant_id, name) values (v_tenant_id, p_depot_name)
  returning id into v_branch_id;

  insert into warehouses(tenant_id, branch_id, name, is_default)
  values (v_tenant_id, v_branch_id, p_depot_name, true)
  returning id into v_warehouse_id;

  insert into profiles(id, name, email)
  values (auth.uid(), p_owner_name, v_email)
  on conflict (id) do update set name = excluded.name;

  insert into memberships(user_id, tenant_id, role, branch_id)
  values (auth.uid(), v_tenant_id, 'owner', v_branch_id);

  return v_tenant_id;
end$$;


-- ---------------------------------------------------------------------
-- 12. RPC adjust_stock_atomic (warehouse_id en lugar de depot_id).
-- ---------------------------------------------------------------------
-- DROP previo: Postgres no permite renombrar parámetros con OR REPLACE
-- (error 42P13). La signature vieja es (uuid, uuid, numeric, numeric)
-- con p_depot_id como segundo argumento.
drop function if exists public.adjust_stock_atomic(uuid, uuid, numeric, numeric);

create or replace function public.adjust_stock_atomic(
  p_product_id   uuid,
  p_warehouse_id uuid,
  p_delta        numeric,
  p_min_qty      numeric default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant_id    uuid := public.tenant_id();
  v_existing_id  uuid;
  v_existing_min numeric;
begin
  if v_tenant_id is null then
    raise exception 'Sesión sin tenant activo' using errcode = '42501';
  end if;

  select id, min_qty
    into v_existing_id, v_existing_min
    from stock_items
   where tenant_id    = v_tenant_id
     and warehouse_id = p_warehouse_id
     and product_id   = p_product_id
   for update;

  if v_existing_id is not null then
    update stock_items
       set qty        = qty + p_delta,
           min_qty    = coalesce(p_min_qty, v_existing_min),
           updated_at = now()
     where id = v_existing_id;
  else
    insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
    values (v_tenant_id, p_warehouse_id, p_product_id, p_delta, coalesce(p_min_qty, 0));
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 13. RPC create_sale_atomic (branch_id; resta del warehouse default).
-- ---------------------------------------------------------------------
-- La venta vive en una branch. Por ahora el POS resta SIEMPRE del
-- warehouse default de esa branch. Cuando habilitemos "POS multi-warehouse"
-- (sprint posterior), agregamos un parámetro p_warehouse_id opcional.
drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);

create or replace function public.create_sale_atomic(
  p_tenant_id    uuid,
  p_branch_id    uuid,
  p_register_id  uuid,
  p_discount     numeric,
  p_items        jsonb,
  p_payments     jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id         uuid;
  v_warehouse_id    uuid;
  v_subtotal        numeric := 0;
  v_total           numeric;
  v_paid            numeric := 0;
  v_user_id         uuid := auth.uid();
  v_item            jsonb;
  v_payment         jsonb;
  v_product_id      uuid;
  v_qty             numeric;
  v_price           numeric;
  v_item_discount   numeric;
  v_subtotal_item   numeric;
  v_product_name    text;
  v_stock_qty       numeric;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'El tenant_id no coincide con la sesión actual'
      using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if coalesce(p_discount, 0) < 0 then
    raise exception 'El descuento global no puede ser negativo';
  end if;

  -- Resolver warehouse default de la branch
  select id into v_warehouse_id
  from warehouses
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and is_default = true
    and active = true;

  if v_warehouse_id is null then
    raise exception 'La sucursal no tiene un depósito principal configurado';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id    := (v_item->>'product_id')::uuid;
    v_qty           := (v_item->>'qty')::numeric;
    v_price         := (v_item->>'price')::numeric;
    v_item_discount := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'Cantidad inválida (debe ser > 0)';
    end if;
    if v_price < 0 then
      raise exception 'Precio inválido (debe ser >= 0)';
    end if;
    if v_item_discount < 0 then
      raise exception 'Descuento de línea inválido';
    end if;

    v_subtotal_item := round(v_price * v_qty - v_item_discount, 2);
    if v_subtotal_item < 0 then
      raise exception 'El descuento de una línea supera el subtotal';
    end if;
    v_subtotal := v_subtotal + v_subtotal_item;

    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id    = p_tenant_id
       and s.warehouse_id = v_warehouse_id
       and s.product_id   = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en este depósito';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
        v_product_name, v_stock_qty, v_qty;
    end if;

    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id    = p_tenant_id
       and warehouse_id = v_warehouse_id
       and product_id   = v_product_id;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then
    raise exception 'El descuento global supera el subtotal';
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_payment->>'amount')::numeric;
  end loop;
  if abs(v_paid - v_total) > 0.005 then
    raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
  end if;

  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided
  ) values (
    p_tenant_id, p_branch_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false
  )
  returning id into v_sale_id;

  insert into sale_items (
    sale_id, tenant_id, product_id, name, barcode,
    price, qty, discount, subtotal
  )
  select
    v_sale_id, p_tenant_id, p.id, p.name, p.barcode,
    (it->>'price')::numeric,
    (it->>'qty')::numeric,
    coalesce((it->>'discount')::numeric, 0),
    round(
      (it->>'price')::numeric * (it->>'qty')::numeric
      - coalesce((it->>'discount')::numeric, 0),
      2
    )
  from jsonb_array_elements(p_items) it
  join products p on p.id = (it->>'product_id')::uuid;

  insert into sale_payments (sale_id, tenant_id, method, amount)
  select v_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  return v_sale_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 14. RPC void_sale_atomic (devuelve stock al warehouse default de la branch).
-- ---------------------------------------------------------------------
create or replace function public.void_sale_atomic(
  p_tenant_id uuid,
  p_sale_id   uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_branch  uuid;
  v_sale_voided  boolean;
  v_warehouse_id uuid;
  v_item         record;
  v_stock_id     uuid;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;

  select branch_id, voided
    into v_sale_branch, v_sale_voided
    from sales
   where id = p_sale_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_sale_voided then
    return;
  end if;

  select id into v_warehouse_id
  from warehouses
  where tenant_id = p_tenant_id
    and branch_id = v_sale_branch
    and is_default = true
    and active = true;

  if v_warehouse_id is null then
    raise exception 'La sucursal de la venta no tiene un depósito principal';
  end if;

  update sales set voided = true where id = p_sale_id;

  for v_item in
    select product_id, qty
      from sale_items
     where sale_id = p_sale_id and tenant_id = p_tenant_id
  loop
    v_stock_id := null;

    select id into v_stock_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = v_warehouse_id
       and product_id   = v_item.product_id
     for update;

    if v_stock_id is not null then
      update stock_items
         set qty        = qty + v_item.qty,
             updated_at = now()
       where id = v_stock_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
      values (p_tenant_id, v_warehouse_id, v_item.product_id, v_item.qty, 0);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 15. RPC create_transfer_atomic (warehouse↔warehouse).
-- ---------------------------------------------------------------------
drop function if exists public.create_transfer_atomic(uuid, uuid, uuid, text, jsonb);

create or replace function public.create_transfer_atomic(
  p_tenant_id         uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_notes             text,
  p_items             jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_transfer_id    uuid;
  v_user_id        uuid := auth.uid();
  v_item           jsonb;
  v_product_id     uuid;
  v_qty            numeric;
  v_stock_qty      numeric;
  v_product_name   text;
  v_dest_id        uuid;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'tenant_id no coincide con la sesión' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'Origen y destino deben ser distintos';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'qty')::numeric;

    if v_qty <= 0 then
      raise exception 'Cantidad inválida (debe ser > 0)';
    end if;

    select s.qty, p.name into v_stock_qty, v_product_name
      from stock_items s
      join products p on p.id = s.product_id
     where s.tenant_id    = p_tenant_id
       and s.warehouse_id = p_from_warehouse_id
       and s.product_id   = v_product_id
     for update of s;

    if v_stock_qty is null then
      raise exception 'El producto no tiene stock registrado en el depósito origen';
    end if;
    if v_stock_qty < v_qty then
      raise exception 'Stock insuficiente de "%" en el depósito origen (disponible: %, pedido: %)',
        v_product_name, v_stock_qty, v_qty;
    end if;

    update stock_items
       set qty = qty - v_qty,
           updated_at = now()
     where tenant_id    = p_tenant_id
       and warehouse_id = p_from_warehouse_id
       and product_id   = v_product_id;

    v_dest_id := null;
    select id into v_dest_id
      from stock_items
     where tenant_id    = p_tenant_id
       and warehouse_id = p_to_warehouse_id
       and product_id   = v_product_id
     for update;

    if v_dest_id is not null then
      update stock_items
         set qty = qty + v_qty,
             updated_at = now()
       where id = v_dest_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty)
      values (p_tenant_id, p_to_warehouse_id, v_product_id, v_qty, 0);
    end if;
  end loop;

  insert into transfers (tenant_id, from_warehouse_id, to_warehouse_id, created_by, notes)
  values (p_tenant_id, p_from_warehouse_id, p_to_warehouse_id, v_user_id, coalesce(p_notes, ''))
  returning id into v_transfer_id;

  insert into transfer_items (transfer_id, tenant_id, product_id, qty)
  select v_transfer_id, p_tenant_id,
         (it->>'product_id')::uuid,
         (it->>'qty')::numeric
    from jsonb_array_elements(p_items) it;

  return v_transfer_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 16. Comments + verificación final.
-- ---------------------------------------------------------------------
comment on table public.branches is
  'Sucursales físicas del tenant. Cada una tiene cajas, ventas y al menos 1 warehouse default.';
comment on table public.warehouses is
  'Depósitos donde vive el stock. branch_id NULL = depósito central (feature plan Empresa). is_default = true marca el principal de cada branch (POS resta de él).';

-- Sanity check: cada branch debe tener exactamente 1 warehouse default activo.
do $$
declare
  v_orphan int;
begin
  select count(*) into v_orphan
  from branches b
  where not exists (
    select 1 from warehouses w
    where w.branch_id = b.id and w.is_default = true and w.active = true
  );
  if v_orphan > 0 then
    raise exception 'Hay % branches sin warehouse default activo. La migration falló.', v_orphan;
  end if;
end$$;

-- Sanity check: cada stock_item, sale, cash_register, transfer debe tener
-- branch_id/warehouse_id seteados (NOT NULL constraints ya lo garantizan,
-- esto es defensa en profundidad).
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad from stock_items where warehouse_id is null;
  if v_bad > 0 then raise exception '% stock_items sin warehouse_id', v_bad; end if;

  select count(*) into v_bad from sales where branch_id is null;
  if v_bad > 0 then raise exception '% sales sin branch_id', v_bad; end if;

  select count(*) into v_bad from cash_registers where branch_id is null;
  if v_bad > 0 then raise exception '% cash_registers sin branch_id', v_bad; end if;

  select count(*) into v_bad from transfers where from_warehouse_id is null or to_warehouse_id is null;
  if v_bad > 0 then raise exception '% transfers sin warehouses', v_bad; end if;
end$$;
