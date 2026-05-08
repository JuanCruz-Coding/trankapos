-- =====================================================================
-- Migration 004: Idempotencia de webhooks MP
-- =====================================================================
-- MP reintenta agresivamente sus webhooks: si no recibe 200, reenvía
-- el mismo evento; y a veces reenvía aunque haya recibido 200 (timeouts,
-- replay interno, etc.). Sin idempotencia, cada reenvío de
-- subscription_authorized_payment extiende current_period_end 1 mes —
-- regalo silencioso de meses pagos.
--
-- Esta tabla guarda los request_id ya procesados. El handler hace insert
-- con `on conflict do nothing` antes de procesar; si la fila ya existía,
-- retorna 200 sin tocar nada.
--
-- Por qué request_id y no data.id: el data.id (preapproval_id, payment_id)
-- NO es único entre eventos del mismo recurso — un mismo preapproval
-- recibe varias notifs según cambia de estado. El header x-request-id
-- de MP sí es único por delivery.

create table if not exists public.processed_webhook_events (
  request_id   text primary key,
  event_type   text not null,
  data_id      text,
  tenant_id    uuid references public.tenants(id) on delete set null,
  processed_at timestamptz not null default now()
);

-- Índice para auditoría / debugging por tenant
create index if not exists processed_webhook_events_tenant_idx
  on public.processed_webhook_events (tenant_id, processed_at desc);

-- RLS: nadie puede ver esta tabla excepto service_role (que bypassea RLS).
-- No tiene policies, por lo tanto está locked down para clientes anon/authenticated.
alter table public.processed_webhook_events enable row level security;
