-- =====================================================================
-- Migration 002: precios reales + columna para Mercado Pago
-- =====================================================================
-- 1. Actualiza price_monthly de los planes (mayo 2026)
-- 2. Agrega columna mp_preapproval_plan_id en plans (id del preapproval_plan
--    que se va a crear en Mercado Pago en la Fase 1)
-- =====================================================================

-- 1. Precios
update plans set price_monthly =      0 where code = 'free';
update plans set price_monthly = 40000  where code = 'basic';
update plans set price_monthly = 100000 where code = 'pro';
update plans set price_monthly = 240000 where code = 'business';

-- 2. Columna para vincular cada plan local con su preapproval_plan en MP
alter table plans
  add column if not exists mp_preapproval_plan_id text;

comment on column plans.mp_preapproval_plan_id is
  'ID del preapproval_plan en Mercado Pago. NULL = el plan no tiene cobro recurrente automático (free) o todavía no fue creado en MP.';
