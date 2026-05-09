-- =====================================================================
-- Migration 016: logo del comercio (Storage + columna en tenants)
-- =====================================================================
-- Permite que cada tenant suba su logo y lo use en el ticket impreso
-- (y eventualmente en facturas, header de la app, etc).
--
-- Componentes:
--   1) Columna `tenants.logo_url` (text nullable) — la URL pública del logo.
--   2) Bucket `tenant-logos` (público) con file_size_limit y allowed_mime_types
--      (defensa en profundidad — el cliente también valida).
--   3) Policies en storage.objects:
--        - SELECT público (el logo se ve en tickets/facturas).
--        - INSERT/UPDATE/DELETE solo owner del tenant cuyo id matchea el path.
--
-- Convención de path: `{tenantId}/logo.{ext}` — un solo logo por tenant.
-- Subir uno nuevo sobreescribe (upsert) o se elimina antes el viejo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Columna logo_url en tenants
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists logo_url text;

comment on column public.tenants.logo_url is
  'URL pública del logo del comercio en Supabase Storage (bucket tenant-logos). NULL = sin logo, usar fallback del POS.';


-- ---------------------------------------------------------------------
-- 2. Bucket tenant-logos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos',
  'tenant-logos',
  true,
  1048576,                                      -- 1 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------
-- 3. Policies en storage.objects para el bucket
-- ---------------------------------------------------------------------
-- Lectura pública: cualquiera con la URL ve el logo (necesario para que
-- el ticket impreso lo cargue, y para futuras integraciones).
drop policy if exists "tenant_logos_public_read" on storage.objects;
create policy "tenant_logos_public_read"
on storage.objects
for select to public
using (bucket_id = 'tenant-logos');


-- INSERT: solo owner subiendo a su carpeta.
-- storage.foldername(name) parsea por '/' y devuelve un array; el path
-- '{tenantId}/logo.png' tiene foldername[1] = '{tenantId}'.
drop policy if exists "tenant_logos_owner_insert" on storage.objects;
create policy "tenant_logos_owner_insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tenant-logos'
  and (storage.foldername(name))[1] = public.tenant_id()::text
  and public.role_in_tenant() = 'owner'
);


-- UPDATE (sobreescribir el logo existente)
drop policy if exists "tenant_logos_owner_update" on storage.objects;
create policy "tenant_logos_owner_update"
on storage.objects
for update to authenticated
using (
  bucket_id = 'tenant-logos'
  and (storage.foldername(name))[1] = public.tenant_id()::text
  and public.role_in_tenant() = 'owner'
)
with check (
  bucket_id = 'tenant-logos'
  and (storage.foldername(name))[1] = public.tenant_id()::text
);


-- DELETE
drop policy if exists "tenant_logos_owner_delete" on storage.objects;
create policy "tenant_logos_owner_delete"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'tenant-logos'
  and (storage.foldername(name))[1] = public.tenant_id()::text
  and public.role_in_tenant() = 'owner'
);
