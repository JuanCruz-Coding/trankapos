-- =====================================================================
-- Migration 027: contingencia AFIP (Sprint A5a)
-- =====================================================================
-- Soporta el reintento de comprobantes rechazados y el banner de estado.
--
-- Columnas nuevas en afip_documents:
--   - retry_count:   cuántas veces se reintentó la emisión (0 = primer intento).
--   - last_retry_at: timestamp del último reintento (anti-hammering del
--                    auto-retry: no reintentar un doc tocado hace < 10 min).
--   - environment:   ambiente AFIP al emitir ('homologation'|'production').
--                    Snapshot — al pasar a producción el historial puede
--                    filtrar y el banner no cuenta rechazos de homologación.
--
-- RPC afip_contingency_summary(): el banner consulta esto. Decisión de
-- producto: solo cuenta documentos 'rejected' (lo que SÍ se intentó emitir
-- y AFIP rechazó). NO cuenta "ventas sin comprobante" — sería ruidoso si el
-- comercio no factura el 100% de sus ventas.
-- =====================================================================

alter table public.afip_documents
  add column if not exists retry_count   int not null default 0,
  add column if not exists last_retry_at timestamptz,
  add column if not exists environment   text;

comment on column public.afip_documents.retry_count is
  'Cantidad de reintentos de emisión. 0 = primer intento sin retries.';
comment on column public.afip_documents.last_retry_at is
  'Timestamp del último reintento. Usado para anti-hammering del auto-retry.';
comment on column public.afip_documents.environment is
  'Ambiente AFIP al emitir (homologation/production). Snapshot. NULL = legacy.';

-- Backfill: los docs existentes heredan el environment actual del tenant.
update public.afip_documents d
   set environment = c.environment
  from public.tenant_afip_credentials c
 where c.tenant_id = d.tenant_id
   and d.environment is null;

-- Índice para el summary del banner y el filtro del historial.
create index if not exists afip_documents_tenant_status_idx
  on public.afip_documents (tenant_id, status);


-- ---------------------------------------------------------------------
-- RPC: resumen de contingencia para el banner
-- ---------------------------------------------------------------------
-- security definer: resuelve el tenant del caller via memberships, igual
-- patrón que el resto. Solo cuenta rejected del environment ACTUAL del
-- tenant (los rechazos viejos de homologación no molestan en producción).
create or replace function public.afip_contingency_summary()
returns table (
  rejected_count      int,
  oldest_rejected_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id  uuid := public.tenant_id();
  v_env        text;
begin
  if v_tenant_id is null then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- Ambiente actual del tenant (si no tiene credenciales, no hay contingencia).
  select environment into v_env
    from tenant_afip_credentials
   where tenant_id = v_tenant_id;

  if v_env is null then
    return query select 0, null::timestamptz;
    return;
  end if;

  return query
  select
    count(*)::int,
    min(created_at)
  from afip_documents
  where tenant_id = v_tenant_id
    and status = 'rejected'
    -- contamos los del environment actual + los legacy (environment null)
    and (environment = v_env or environment is null);
end;
$$;

revoke all on function public.afip_contingency_summary() from public;
grant execute on function public.afip_contingency_summary() to authenticated;
