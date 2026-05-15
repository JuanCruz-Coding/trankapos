-- =====================================================================
-- Migration 029: A6 — RPCs auxiliares de onboarding AFIP (wizard CSR)
-- =====================================================================
-- Acompaña a la 028 (alias + csr_pem + cert_encrypted nullable).
--
-- Dos RPCs nuevos para el flujo wizard:
--
--   1. afip_save_csr_step
--      Llamado por la edge function `afip-generate-csr` después de
--      generar el par RSA + CSR con node-forge en Deno. Guarda la key
--      PRIVADA cifrada y el CSR en texto plano. Estado intermedio:
--      cert_encrypted IS NULL, csr_pem IS NOT NULL → "awaiting_certificate".
--      Si ya había un row del tenant (regenerando cert, cambio homo→prod,
--      etc) se SOBREESCRIBE todo, incluyendo cert_encrypted=NULL para
--      limpiar el cert viejo y forzar al comercio a subir el nuevo .crt
--      que matchea con la key nueva.
--
--   2. afip_complete_with_cert
--      Llamado por `afip-upload-certificate` cuando el comercio sube el
--      .crt descargado de WSASS. Hace UPDATE puntual: setea
--      cert_encrypted (cifrado) + is_active=true. NO toca alias ni
--      csr_pem (historial — útil si el comercio quiere ver con qué CSR
--      se emitió este cert).
--
-- El BYO mode (afip_set_credentials, migration 022) sigue funcionando
-- en paralelo: setea cert+key en una sola operación, sin pasar por csr.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. afip_save_csr_step
-- ---------------------------------------------------------------------
create or replace function public.afip_save_csr_step(
  p_tenant_id      uuid,
  p_cuit           text,
  p_sales_point    int,
  p_environment    afip_environment,
  p_alias          text,
  p_key_pem        text,
  p_csr_pem        text,
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
    alias, csr_pem,
    cert_encrypted, key_encrypted,
    is_active, updated_at
  ) values (
    p_tenant_id, p_cuit, p_sales_point, p_environment,
    p_alias, p_csr_pem,
    null,
    extensions.pgp_sym_encrypt(p_key_pem, p_encryption_key),
    false,
    now()
  )
  on conflict (tenant_id) do update set
    cuit           = excluded.cuit,
    sales_point    = excluded.sales_point,
    environment    = excluded.environment,
    alias          = excluded.alias,
    csr_pem        = excluded.csr_pem,
    -- limpiamos el cert viejo: ya no matchea con la key nueva
    cert_encrypted = null,
    key_encrypted  = excluded.key_encrypted,
    is_active      = false,
    updated_at     = now();
end;
$$;

revoke all on function public.afip_save_csr_step(uuid,text,int,afip_environment,text,text,text,text) from public;
grant execute on function public.afip_save_csr_step(uuid,text,int,afip_environment,text,text,text,text)
  to service_role;


-- ---------------------------------------------------------------------
-- 2. afip_complete_with_cert
-- ---------------------------------------------------------------------
create or replace function public.afip_complete_with_cert(
  p_tenant_id      uuid,
  p_environment    afip_environment,
  p_cert_pem       text,
  p_encryption_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current_env afip_environment;
  v_csr_pem     text;
  v_key_enc     bytea;
begin
  if length(coalesce(p_encryption_key, '')) < 16 then
    raise exception 'encryption_key inválida (longitud minima 16 chars)';
  end if;

  select environment, csr_pem, key_encrypted
    into v_current_env, v_csr_pem, v_key_enc
  from public.tenant_afip_credentials
  where tenant_id = p_tenant_id;

  if not found then
    raise exception 'No hay onboarding en curso para este tenant';
  end if;

  if v_current_env <> p_environment then
    raise exception 'El ambiente no coincide con el del CSR generado';
  end if;

  if v_csr_pem is null or v_key_enc is null then
    raise exception 'No hay un CSR generado; primero ejecutá el paso de generar el par de claves';
  end if;

  update public.tenant_afip_credentials
     set cert_encrypted = extensions.pgp_sym_encrypt(p_cert_pem, p_encryption_key),
         is_active      = true,
         updated_at     = now()
   where tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.afip_complete_with_cert(uuid,afip_environment,text,text) from public;
grant execute on function public.afip_complete_with_cert(uuid,afip_environment,text,text)
  to service_role;
