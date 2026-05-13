-- =====================================================================
-- Migration 021: dirección del comercio (ciudad + provincia) para MP
-- =====================================================================
-- MP exige `city_name` y `state_name` válidos del catálogo oficial AR al
-- crear la sucursal en `mp-oauth-callback`. Antes estaban hardcodeados a
-- "Monserrat / Capital Federal", lo que rompía para cualquier comercio
-- fuera de CABA.
--
-- Esta migration agrega dos columnas nullable a tenants:
--   - `city`           : nombre de la ciudad/barrio (input libre)
--   - `state_province` : nombre de la provincia AR (24 valores fijos)
--
-- El callback va a exigirlos al conectar MP (devuelve posError claro si
-- están vacíos). El POS / la app siguen funcionando sin esos campos —
-- solo bloquean la integración MP Connect.
-- =====================================================================

alter table public.tenants
  add column if not exists city text,
  add column if not exists state_province text;

comment on column public.tenants.city is
  'Ciudad/localidad del comercio. Requerido por MP para crear sucursal Connect. Debe coincidir con el catálogo oficial AR (api.mercadolibre.com/states/{state_id}).';

comment on column public.tenants.state_province is
  'Provincia AR del comercio. Una de las 24 provincias oficiales (Capital Federal, Buenos Aires, Córdoba, …). Requerida para integración MP Connect.';
