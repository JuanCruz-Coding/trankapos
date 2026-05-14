-- =====================================================================
-- Migration 023: cache de Ticket de Acceso (TA) de AFIP WSAA
-- =====================================================================
-- WSAA emite un Token+Sign válido por 12 horas tras autenticar con cert.
-- Sin cache, cada llamada a WSFEv1 obliga a firmar CMS+login → lento e
-- ineficiente. Esta tabla guarda el TA descomponiendo expirationTime.
--
-- Diseño: PK compuesto (tenant_id, service). 1 fila por servicio AFIP.
-- Service típico para facturación electrónica: 'wsfe'.
--
-- TA NO se encripta porque solo es útil hasta su expiration (12 hs) y
-- nuestro modelo de amenaza para AFIP: ya tenemos cert/key encriptados,
-- el TA es un derivado de corta vida.
-- =====================================================================

create table public.afip_ta_cache (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  service          text not null,                  -- 'wsfe', 'ws_sr_padron_a4', etc
  environment      afip_environment not null,
  token            text not null,                  -- TA.credentials.token
  sign             text not null,                  -- TA.credentials.sign
  generation_time  timestamptz not null,
  expiration_time  timestamptz not null,           -- AFIP marca 12 hs típicamente
  created_at       timestamptz not null default now(),
  primary key (tenant_id, service, environment)
);

comment on table public.afip_ta_cache is
  'Cache de Token+Sign del WSAA AFIP. Válido hasta expiration_time. Renovar cuando se vence.';

create index afip_ta_cache_expiration_idx
  on public.afip_ta_cache (expiration_time);

alter table public.afip_ta_cache enable row level security;
-- Sin policies: solo service_role accede (edge functions).
