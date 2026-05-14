-- =====================================================================
-- Migration 022: credenciales y comprobantes AFIP
-- =====================================================================
-- Sprint A1 — Sprint 5 AFIP, integración via AfipSDK (servicio externo).
--
-- Modelo BYO-cert: el comercio sube su .crt y .key (generados en AFIP
-- con su clave fiscal) a TrankaPos. Los guardamos ENCRIPTADOS con
-- pgcrypto + clave server-side (AFIP_VAULT_KEY, env var de las edge
-- functions). Cuando hay que emitir un comprobante, una edge function
-- descifra y se los pasa a AfipSDK para que firme y emita contra AFIP.
--
-- ¿Por qué BYO-cert y no delegado al SDK?
--   - Más control: si cambiamos de proveedor, no nos atamos a su panel.
--   - Auditoría: vemos qué cert tiene cada tenant, podemos forzar rotación.
--   - Trade-off: somos custodios de información sensible, por eso pgcrypto.
--
-- ¿Por qué pgcrypto y no encriptar en la edge function?
--   - Defense in depth: si alguien logra leer la tabla (RLS rota, dump),
--     ve bytes inservibles. La clave SOLO está en env var de Deno.
--   - El cifrado/descifrado son ops de funciones, no del SELECT directo.
-- =====================================================================

-- Asegurar pgcrypto disponible (Supabase ya lo trae en extensions schema)
create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------
-- 1. tenant_afip_credentials
-- ---------------------------------------------------------------------
create type afip_environment as enum ('homologation', 'production');

create table public.tenant_afip_credentials (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  cuit             text not null,
  sales_point      int  not null,                  -- punto de venta AFIP (1..N)
  environment      afip_environment not null default 'homologation',
  cert_encrypted   bytea not null,                 -- pgp_sym_encrypt(cert_pem, key)
  key_encrypted    bytea not null,                 -- pgp_sym_encrypt(key_pem, key)
  is_active        boolean not null default true,  -- false = pausar emisión sin borrar
  last_test_at     timestamptz,                    -- último intento de "Probar conexión"
  last_test_ok     boolean,                        -- resultado del último test
  last_test_error  text,                           -- detalle si fall ó
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- CUIT argentino: 11 dígitos sin guiones
  constraint cuit_format check (cuit ~ '^[0-9]{11}$'),
  constraint sales_point_positive check (sales_point > 0)
);

comment on table public.tenant_afip_credentials is
  'Credenciales AFIP del tenant. cert/key cifrados con pgcrypto + clave server-side. Una fila por tenant.';

create index tenant_afip_credentials_active_idx
  on public.tenant_afip_credentials (tenant_id)
  where is_active;


-- ---------------------------------------------------------------------
-- 2. afip_documents (placeholder — se usa en Sprint A2)
-- ---------------------------------------------------------------------
create type afip_doc_letter as enum ('A', 'B', 'C');
create type afip_doc_type   as enum ('factura', 'nota_credito', 'nota_debito');
create type afip_doc_status as enum ('pending', 'authorized', 'rejected', 'cancelled');

create table public.afip_documents (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  sale_id         uuid references public.sales(id) on delete set null,
  doc_type        afip_doc_type not null,
  doc_letter      afip_doc_letter not null,
  sales_point     int  not null,
  voucher_number  bigint,                          -- asignado por AFIP al obtener CAE
  cae             text,                            -- código de autorización
  cae_due_date    date,                            -- vencimiento del CAE
  status          afip_doc_status not null default 'pending',
  related_doc_id  uuid references public.afip_documents(id) on delete set null,  -- para NC/ND
  raw_request     jsonb,
  raw_response    jsonb,
  error_message   text,
  emitted_at      timestamptz,                     -- cuando AFIP devolvió CAE
  created_at      timestamptz not null default now()
);

create index afip_documents_tenant_status_idx
  on public.afip_documents (tenant_id, status, created_at desc);

create index afip_documents_sale_idx
  on public.afip_documents (sale_id);

-- Un voucher_number único por (tenant, sales_point, doc_type, doc_letter)
-- cuando ya está autorizado — AFIP exige secuencia sin huecos.
create unique index afip_documents_voucher_unique
  on public.afip_documents (tenant_id, sales_point, doc_type, doc_letter, voucher_number)
  where voucher_number is not null and status = 'authorized';


-- ---------------------------------------------------------------------
-- 3. RPCs: encriptar/desencriptar usando clave externa
-- ---------------------------------------------------------------------
-- Diseño: la clave de cifrado NUNCA vive en SQL. Las edge functions la
-- leen de Deno.env (AFIP_VAULT_KEY) y la pasan como parámetro.
-- security definer para que la edge function (con service_role) pueda
-- llamarla sin lidiar con RLS.

create or replace function public.afip_set_credentials(
  p_tenant_id     uuid,
  p_cuit          text,
  p_sales_point   int,
  p_environment   afip_environment,
  p_cert_pem      text,
  p_key_pem       text,
  p_encryption_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_encryption_key, '')) < 16 then
    raise exception 'encryption_key inválida (longitud minima 16 chars)';
  end if;

  insert into public.tenant_afip_credentials (
    tenant_id, cuit, sales_point, environment,
    cert_encrypted, key_encrypted, updated_at
  ) values (
    p_tenant_id, p_cuit, p_sales_point, p_environment,
    extensions.pgp_sym_encrypt(p_cert_pem, p_encryption_key),
    extensions.pgp_sym_encrypt(p_key_pem,  p_encryption_key),
    now()
  )
  on conflict (tenant_id) do update set
    cuit           = excluded.cuit,
    sales_point    = excluded.sales_point,
    environment    = excluded.environment,
    cert_encrypted = excluded.cert_encrypted,
    key_encrypted  = excluded.key_encrypted,
    is_active      = true,
    updated_at     = now();
end;
$$;

revoke all on function public.afip_set_credentials(uuid,text,int,afip_environment,text,text,text) from public;
grant execute on function public.afip_set_credentials(uuid,text,int,afip_environment,text,text,text)
  to service_role;


create or replace function public.afip_get_credentials(
  p_tenant_id      uuid,
  p_encryption_key text
)
returns table (
  cuit         text,
  sales_point  int,
  environment  afip_environment,
  cert_pem     text,
  key_pem      text,
  is_active    boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    c.cuit,
    c.sales_point,
    c.environment,
    extensions.pgp_sym_decrypt(c.cert_encrypted, p_encryption_key)::text,
    extensions.pgp_sym_decrypt(c.key_encrypted,  p_encryption_key)::text,
    c.is_active
  from public.tenant_afip_credentials c
  where c.tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.afip_get_credentials(uuid,text) from public;
grant execute on function public.afip_get_credentials(uuid,text)
  to service_role;


-- ---------------------------------------------------------------------
-- 4. RLS — el cliente NUNCA accede a estas tablas directo
-- ---------------------------------------------------------------------
-- Todo el flujo va via edge functions con service_role. Para no romper
-- RLS de Supabase por defecto, activamos RLS y NO creamos policies
-- (deniega todo a roles autenticados; service_role lo ignora).
alter table public.tenant_afip_credentials enable row level security;
alter table public.afip_documents          enable row level security;

-- Policy de SOLO LECTURA para owners — para que en el frontend podamos
-- mostrar el "estado de la integración" (cuit/sales_point/environment/
-- last_test_ok) sin exponer los cert/key encriptados.
-- Nota: cert_encrypted y key_encrypted siguen siendo bytea ilegibles
-- aunque se filtren — la clave nunca está en la DB.
create policy "afip_creds_owner_read"
on public.tenant_afip_credentials
for select to authenticated
using (
  tenant_id = public.tenant_id()
  and public.role_in_tenant() = 'owner'
);

create policy "afip_docs_tenant_read"
on public.afip_documents
for select to authenticated
using (tenant_id = public.tenant_id());


-- ---------------------------------------------------------------------
-- 5. Trigger updated_at
-- ---------------------------------------------------------------------
create or replace function public.afip_creds_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_afip_creds_updated_at on public.tenant_afip_credentials;
create trigger tr_afip_creds_updated_at
before update on public.tenant_afip_credentials
for each row execute function public.afip_creds_touch_updated_at();
