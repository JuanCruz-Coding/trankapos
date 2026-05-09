-- =====================================================================
-- Migration 015: policy de UPDATE en tenants (Sprint Settings fix)
-- =====================================================================
-- La migration 014 agregó 16 columnas configurables a `tenants` pero
-- las RLS policies originales (schema.sql) solo permiten SELECT:
--
--   create policy tenants_self on tenants
--     for select to authenticated using (id = public.tenant_id());
--
-- Resultado: la página /settings tira error de RLS al guardar
-- (el cliente intenta UPDATE y la policy lo rechaza).
--
-- Esta migration suma una policy de UPDATE restringida a owners:
-- el caller solo puede actualizar el tenant donde tiene rol 'owner'.
-- managers y cashiers no pueden tocar configuración del comercio.
--
-- Idempotente: drop + create.
-- =====================================================================

drop policy if exists tenants_owner_update on public.tenants;

create policy tenants_owner_update on public.tenants
  for update to authenticated
  using (
    id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  )
  with check (
    id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  );

comment on policy tenants_owner_update on public.tenants is
  'Solo el owner puede actualizar settings del tenant (página /settings).';
