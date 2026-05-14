-- =====================================================================
-- Migration 025: persistir el QR fiscal en afip_documents
-- =====================================================================
-- El QR fiscal AFIP se generaba al emitir y se devolvía en la respuesta
-- del edge function, pero NO se guardaba. Al reimprimir desde /sales había
-- que reconstruirlo client-side desde tenants.tax_id — que muchas veces
-- está vacío (el CUIT real vive en tenant_afip_credentials.cuit, no en
-- tenants.tax_id).
--
-- Guardar la URL del QR tal cual se generó hace que el ticket sea un
-- snapshot completo: cualquier miembro del tenant puede reimprimirlo sin
-- depender de campos que pueden faltar ni de permisos de owner.
-- =====================================================================

alter table public.afip_documents
  add column if not exists qr_url text;

comment on column public.afip_documents.qr_url is
  'URL del QR fiscal AFIP (https://www.afip.gob.ar/fe/qr/?p=...) tal como se generó al emitir. Snapshot — no recalcular.';
