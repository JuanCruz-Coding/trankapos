-- =====================================================================
-- Migration 034: tracking de devoluciones en sale_items + afip_documents
-- =====================================================================
-- sale_items.qty_returned: cuántas unidades de la línea ya volvieron. La
-- devolución/cambio sólo permite devolver hasta (qty - qty_returned).
--
-- afip_documents.kind: granularidad fiscal:
--   factura      = comprobante de venta original
--   void_total   = NC por anulación total (todo el ticket)
--   void_partial = NC por devolución parcial (subset de items)
--   exchange_nc  = NC que forma parte de un cambio (lleva una nueva factura asociada)
--   nota_debito  = ND (reservado, no implementado)
--
-- afip_documents.reason_id / reason_text: motivo de la devolución.
-- =====================================================================

alter table public.sale_items
  add column qty_returned numeric not null default 0,
  add constraint sale_items_qty_returned_check
    check (qty_returned >= 0 and qty_returned <= qty);

alter table public.afip_documents
  add column kind text
    check (kind in ('factura','void_total','void_partial','exchange_nc','nota_debito')),
  add column reason_id uuid references public.return_reasons(id) on delete set null,
  add column reason_text text;

-- Backfill conservador
update public.afip_documents set kind = 'factura'      where doc_type = 'factura';
update public.afip_documents set kind = 'void_total'   where doc_type = 'nota_credito';
update public.afip_documents set kind = 'nota_debito'  where doc_type = 'nota_debito';

comment on column public.sale_items.qty_returned is
  'Cantidad de esta línea que ya fue devuelta (acumulado de NCs parciales). Migration 034.';
comment on column public.afip_documents.kind is
  'Sub-tipo del documento: factura / void_total / void_partial / exchange_nc / nota_debito.';
