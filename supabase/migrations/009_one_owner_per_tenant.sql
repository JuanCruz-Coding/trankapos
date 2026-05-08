-- =====================================================================
-- Migration 009: solo 1 owner activo por tenant
-- =====================================================================
-- Hoy nada impide tener 2 owners en el mismo tenant. Riesgo:
-- - Cada owner cancela/cambia la suscripción independientemente.
-- - Cada owner crea/borra users del otro.
-- - Auditoría confusa (¿quién pagó? ¿quién canceló?).
--
-- create_tenant_for_owner ya garantiza 1 owner al crear el tenant, pero
-- nada impide después un INSERT manual o un futuro flow de "transferir
-- ownership" mal hecho. Esto cierra la puerta al nivel base.
--
-- Partial unique index (no constraint clásico) para dejar que owners
-- inactivos (active=false) convivan con un owner activo — útil si más
-- adelante hay flow de transferir ownership: marcás al viejo inactivo
-- e insertás al nuevo activo.
--
-- Pre-flight check antes de aplicar en prod:
--   select tenant_id, count(*) from memberships
--   where role = 'owner' and active = true
--   group by tenant_id having count(*) > 1;
--   -- Si devuelve filas, marcar uno de los owners como inactive antes.
-- =====================================================================

create unique index if not exists memberships_one_active_owner_per_tenant
  on memberships(tenant_id)
  where role = 'owner' and active = true;
