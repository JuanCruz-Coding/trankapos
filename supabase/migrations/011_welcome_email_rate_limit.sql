-- =====================================================================
-- Migration 011: rate limit del welcome email
-- =====================================================================
-- send-welcome-email no chequeaba si ya había mandado un email a este
-- profile. Si el frontend la invoca dos veces (refresh, doble click,
-- retry de network), el cliente recibe 2 emails de bienvenida.
--
-- Solución: columna welcome_email_sent_at en profiles. La edge function
-- la chequea antes de enviar y la setea al confirmar el envío exitoso.
-- =====================================================================

alter table profiles
  add column if not exists welcome_email_sent_at timestamptz;

comment on column profiles.welcome_email_sent_at is
  'Timestamp del envío del email de bienvenida. Si está seteado, send-welcome-email no reenvía.';
