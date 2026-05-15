-- =====================================================================
-- Migration 028: A6 — onboarding AFIP via wizard (genera CSR en server)
-- =====================================================================
-- El wizard A6 permite que el backend genere RSA key + CSR; el comercio
-- entra a WSASS solo para pegar el CSR y descargar el .crt. La key
-- queda cifrada en TrankaPos desde el primer momento y el comercio no
-- usa OpenSSL.
--
-- Cambios:
--   - cert_encrypted ahora nullable: existe un estado intermedio donde
--     ya generamos la key + CSR pero todavía no llegó el .crt firmado
--     por AFIP. Estado derivado:
--       cert_encrypted is null and csr_pem is not null
--         → awaiting_certificate
--       cert_encrypted is not null
--         → activo
--   - alias text: el alias que se usa como CN del CSR (lo elige el
--     comercio, ej 'trankapos-prod'). Único en su cuenta AFIP.
--   - csr_pem text: el CSR generado por el wizard, en texto plano (es
--     público por diseño — se le pasa a AFIP). Lo guardamos para que el
--     comercio pueda volver a copiarlo si cierra la pestaña.
--
-- BYO mode (modo experto, subir cert+key directo) sigue funcionando:
--   esos rows tienen alias=null, csr_pem=null, y ambos *_encrypted seteados.
-- =====================================================================

alter table public.tenant_afip_credentials
  alter column cert_encrypted drop not null;

alter table public.tenant_afip_credentials
  add column if not exists alias   text,
  add column if not exists csr_pem text;

comment on column public.tenant_afip_credentials.alias is
  'Alias del certificado AFIP (CN del CSR). Solo lo setea el wizard A6 (gen cert). NULL en onboarding BYO.';

comment on column public.tenant_afip_credentials.csr_pem is
  'CSR PEM generado por el wizard A6. Texto plano (es público). Se muestra al comercio para pegar en WSASS. NULL en onboarding BYO.';
