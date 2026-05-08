-- =====================================================================
-- Migration 003: pending_plan_id en subscriptions
-- =====================================================================
-- Antes, create-subscription asignaba el nuevo plan_id ANTES de que MP
-- confirmara el cobro. Si la redirección al checkout fallaba o el cliente
-- no pagaba, el plan quedaba activo igual (bug grave: acceso sin pagar).
--
-- Ahora: el nuevo plan se guarda en pending_plan_id mientras se procesa
-- el cobro. Solo cuando el webhook recibe `authorized` se promueve a
-- plan_id. El plan vigente real siempre es el de la columna plan_id.
-- =====================================================================

alter table subscriptions
  add column if not exists pending_plan_id uuid references plans(id);

comment on column subscriptions.pending_plan_id is
  'Plan al que el tenant intentó suscribirse pero todavía no fue confirmado por MP. Cuando llega webhook con status=authorized, se copia a plan_id y se nulea acá.';
