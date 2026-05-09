-- =====================================================================
-- Migration 019: permisos por sucursal + permisos finos en jsonb
-- =====================================================================
-- Hasta acá `memberships(user_id, tenant_id, role, branch_id)` significaba
-- "branch_id es la sucursal por default del switcher". No restringía nada.
-- Cualquier user con rol activo veía todo el tenant porque las RLS solo
-- filtraban por tenant_id.
--
-- Para escalar el POS a retail con múltiples locales (ropa, regional, etc),
-- introducimos:
--
--   1) Tabla `user_branch_access(user_id, tenant_id, branch_id NULL)`.
--      branch_id IS NULL = acceso a TODAS las sucursales del tenant.
--      Sin fila para una branch (y sin fila NULL) = no la ve.
--
--   2) `memberships.permissions jsonb` con overrides por user para 12 keys.
--      Los defaults se aplican en TS según el rol; jsonb solo guarda overrides.
--
-- RLS:
--   - sales, cash_registers, cash_movements, transfers, branches, warehouses,
--     stock_items pasan a respetar `public.user_can_access_branch(branch_id)`.
--   - Owner tiene bypass total (siempre pasa).
--   - sale_items / sale_payments / transfer_items siguen scoped por tenant —
--     son hijos y se accederán siempre vía sus padres con sus policies.
--
-- Backfill: por cada membership existente sembramos user_branch_access.
--   Owner → 1 fila NULL (todas).
--   Manager/cashier → 1 fila con su branch_id.
--   Si membership.branch_id IS NULL → 1 fila NULL (preserva acceso actual).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. memberships.permissions
-- ---------------------------------------------------------------------
alter table public.memberships
  add column if not exists permissions jsonb not null default '{}'::jsonb;

comment on column public.memberships.permissions is
  'Overrides de permisos finos para este user en este tenant. Las keys faltantes se resuelven con el default del rol en TS. Owner tiene bypass total.';


-- ---------------------------------------------------------------------
-- 2. Tabla user_branch_access
-- ---------------------------------------------------------------------
create table if not exists public.user_branch_access (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists user_branch_access_user_idx
  on public.user_branch_access (user_id, tenant_id);
create index if not exists user_branch_access_branch_idx
  on public.user_branch_access (branch_id) where branch_id is not null;

-- Unique: un user no puede tener la misma branch dos veces para el mismo tenant.
-- Usamos dos índices parciales porque NULL no es comparable directamente.
create unique index if not exists user_branch_access_uniq_branch
  on public.user_branch_access (user_id, tenant_id, branch_id)
  where branch_id is not null;
create unique index if not exists user_branch_access_uniq_all
  on public.user_branch_access (user_id, tenant_id)
  where branch_id is null;

comment on table public.user_branch_access is
  'A qué sucursales tiene acceso un user en un tenant. branch_id NULL = TODAS (manager regional / owner). Sin fila para una branch = no la ve.';


-- ---------------------------------------------------------------------
-- 3. Helper SQL: user_can_access_branch
-- ---------------------------------------------------------------------
-- Retorna true si el user actual:
--   - es owner del tenant (bypass total)
--   - tiene una fila NULL en user_branch_access para el tenant
--   - tiene una fila para esa branch específica
-- security definer: lee user_branch_access sin restricciones de RLS.
create or replace function public.user_can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select
      m.tenant_id,
      m.role::text as role
    from public.memberships m
    where m.user_id = auth.uid()
      and m.active = true
    limit 1
  )
  select case
    when (select role from ctx) = 'owner' then true
    when exists (
      select 1 from public.user_branch_access uba
      where uba.user_id = auth.uid()
        and uba.tenant_id = (select tenant_id from ctx)
        and uba.branch_id is null
    ) then true
    when exists (
      select 1 from public.user_branch_access uba
      where uba.user_id = auth.uid()
        and uba.tenant_id = (select tenant_id from ctx)
        and uba.branch_id = p_branch_id
    ) then true
    else false
  end;
$$;

comment on function public.user_can_access_branch is
  'true si el user actual tiene acceso a la branch dada. Owner siempre pasa; fila NULL en user_branch_access también.';


-- ---------------------------------------------------------------------
-- 4. Backfill de user_branch_access
-- ---------------------------------------------------------------------
-- Por cada membership activa: si owner o sin branch_id → fila NULL; sino
-- → fila con su branch_id. ON CONFLICT DO NOTHING por si se corre dos veces.
insert into public.user_branch_access (user_id, tenant_id, branch_id)
select
  m.user_id,
  m.tenant_id,
  case when m.role::text = 'owner' or m.branch_id is null then null
       else m.branch_id end
from public.memberships m
where m.active = true
on conflict do nothing;


-- ---------------------------------------------------------------------
-- 5. RLS en user_branch_access
-- ---------------------------------------------------------------------
alter table public.user_branch_access enable row level security;

-- SELECT: el user ve sus propias filas + todas las del tenant si es owner.
drop policy if exists uba_self_or_owner_select on public.user_branch_access;
create policy uba_self_or_owner_select on public.user_branch_access
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      tenant_id = public.tenant_id()
      and public.role_in_tenant() = 'owner'
    )
  );

-- INSERT/UPDATE/DELETE: solo owner del tenant.
drop policy if exists uba_owner_write on public.user_branch_access;
create policy uba_owner_write on public.user_branch_access
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  )
  with check (
    tenant_id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  );


-- ---------------------------------------------------------------------
-- 6. RLS por branch en tablas operativas
-- ---------------------------------------------------------------------
-- Reemplazo del tenant_isolation por una versión que ADEMÁS chequea acceso
-- a la branch correspondiente.

-- branches: acceso por id de la propia branch
drop policy if exists tenant_isolation on public.branches;
create policy branches_access on public.branches
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(id)
  )
  with check (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(id)
  );

-- warehouses: acceso por su branch_id (warehouses centrales con branch_id IS NULL
-- las ve solo owner — el helper retorna false si branch_id es null y no es owner;
-- para evitar romper UI, agregamos rama para central: true para owner, false para resto).
drop policy if exists tenant_isolation on public.warehouses;
create policy warehouses_access on public.warehouses
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and (
      branch_id is null and public.role_in_tenant() = 'owner'
      or branch_id is not null and public.user_can_access_branch(branch_id)
    )
  )
  with check (
    tenant_id = public.tenant_id()
    and (
      branch_id is null and public.role_in_tenant() = 'owner'
      or branch_id is not null and public.user_can_access_branch(branch_id)
    )
  );

-- sales: acceso por sales.branch_id
drop policy if exists tenant_isolation on public.sales;
create policy sales_access on public.sales
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(branch_id)
  )
  with check (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(branch_id)
  );

-- cash_registers: acceso por cash_registers.branch_id
drop policy if exists tenant_isolation on public.cash_registers;
create policy cash_registers_access on public.cash_registers
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(branch_id)
  )
  with check (
    tenant_id = public.tenant_id()
    and public.user_can_access_branch(branch_id)
  );

-- cash_movements: vía register_id → cash_register.branch_id
drop policy if exists tenant_isolation on public.cash_movements;
create policy cash_movements_access on public.cash_movements
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and exists (
      select 1 from public.cash_registers cr
      where cr.id = cash_movements.register_id
        and public.user_can_access_branch(cr.branch_id)
    )
  )
  with check (
    tenant_id = public.tenant_id()
    and exists (
      select 1 from public.cash_registers cr
      where cr.id = cash_movements.register_id
        and public.user_can_access_branch(cr.branch_id)
    )
  );

-- transfers: ver si origen O destino están autorizados; insertar requiere ambos.
-- (warehouse → branch via warehouses.branch_id; central=NULL solo owner.)
drop policy if exists tenant_isolation on public.transfers;
create policy transfers_select on public.transfers
  for select to authenticated
  using (
    tenant_id = public.tenant_id()
    and (
      exists (
        select 1 from public.warehouses w
        where w.id = transfers.from_warehouse_id
          and (
            w.branch_id is null and public.role_in_tenant() = 'owner'
            or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
          )
      )
      or exists (
        select 1 from public.warehouses w
        where w.id = transfers.to_warehouse_id
          and (
            w.branch_id is null and public.role_in_tenant() = 'owner'
            or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
          )
      )
    )
  );
create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (
    tenant_id = public.tenant_id()
    and exists (
      select 1 from public.warehouses w
      where w.id = transfers.from_warehouse_id
        and (
          w.branch_id is null and public.role_in_tenant() = 'owner'
          or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
        )
    )
    and exists (
      select 1 from public.warehouses w
      where w.id = transfers.to_warehouse_id
        and (
          w.branch_id is null and public.role_in_tenant() = 'owner'
          or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
        )
    )
  );

-- stock_items: vía warehouse_id. NOTA: hoy siempre filtra por branch accesible;
-- el flag fino "view_other_branches_stock" se chequea en TS porque RLS no lee
-- jsonb cómodamente. Owners y users con fila NULL en user_branch_access ven todo.
drop policy if exists tenant_isolation on public.stock_items;
create policy stock_items_access on public.stock_items
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and exists (
      select 1 from public.warehouses w
      where w.id = stock_items.warehouse_id
        and (
          w.branch_id is null and public.role_in_tenant() = 'owner'
          or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
        )
    )
  )
  with check (
    tenant_id = public.tenant_id()
    and exists (
      select 1 from public.warehouses w
      where w.id = stock_items.warehouse_id
        and (
          w.branch_id is null and public.role_in_tenant() = 'owner'
          or w.branch_id is not null and public.user_can_access_branch(w.branch_id)
        )
    )
  );

-- categories y products siguen tenant-scoped (el catálogo es global del tenant).
-- sale_items, sale_payments, transfer_items idem (hijos de tablas con branch policy).
-- Esas tablas quedan con sus policies tenant_isolation existentes.
