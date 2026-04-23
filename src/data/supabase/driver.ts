import type { DataDriver } from '../driver';

// Stub de Supabase — se enchufa cuando tengas un proyecto Supabase listo.
// Esquema Postgres sugerido en supabase/schema.sql (crear cuando deployes).
// Todas las tablas deben tener tenantId y RLS por auth.jwt() ->> 'tenant_id'.
//
// Implementación: replicar LocalDriver usando @supabase/supabase-js:
//   - auth con supabase.auth (email/password)
//   - signup crea fila en tenants + depots + users + attachea tenant_id al JWT
//   - resto es CRUD contra tablas con RLS activo
//
// Cuando arranques producción, llenar esta clase siguiendo la misma interfaz.

export function createSupabaseDriver(): DataDriver {
  throw new Error(
    'Driver Supabase aún no implementado. Configurá el backend y completá src/data/supabase/driver.ts',
  );
}
