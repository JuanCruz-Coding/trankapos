-- =====================================================================
-- Migration 026: índice para Notas de Crédito (Sprint A4)
-- =====================================================================
-- Las NC se vinculan a su factura original vía afip_documents.related_doc_id
-- (columna que ya existe desde la migration 022). El frontend y la edge
-- function afip-emit-credit-note consultan frecuentemente:
--   - "¿esta factura ya tiene una NC?" (idempotencia)
--   - "¿qué documentos fiscales tiene esta venta?" (listado en /sales)
--
-- No hace falta ninguna columna nueva: related_doc_id ya existe, raw_request
-- ya existe (migration 022). Solo agregamos el índice de related_doc_id.
-- =====================================================================

create index if not exists afip_documents_related_doc_idx
  on public.afip_documents (related_doc_id)
  where related_doc_id is not null;
