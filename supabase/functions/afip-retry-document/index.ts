// =====================================================================
// Edge Function: afip-retry-document (Sprint A5a)
// =====================================================================
// Reintenta la emisión de un comprobante AFIP que quedó `rejected` (AFIP
// caído, timeout, error transitorio). Reusa el core de emisión
// (_shared/afip-emit-core.ts) pasando `existingDocId` para que en vez de
// insertar un afip_documents nuevo, ACTUALICE el rechazado (incrementando
// retry_count y last_retry_at).
//
// Body (uno u otro, XOR):
//   { documentId: string }  → reintenta ese afip_documents puntual.
//   { saleId: string }      → reintenta/emite el comprobante de esa venta.
//
// Auth: miembro activo del tenant (mismo patrón que afip-emit-voucher).
//
// Respuesta: EmitResult (HTTP 200 con { ok, ... }).
// Errores de validación / auth → HTTP 400/401/403.
//
// Lógica:
//  - { documentId }:
//      · Carga el afip_documents, valida tenant.
//      · status != 'rejected' → 400.
//      · doc_type='factura'      → emitVoucherForSale(existingDocId).
//      · doc_type='nota_credito' → emitCreditNoteForFactura sobre
//                                  related_doc_id (factura original).
//      · doc_type='nota_debito'  → 400 (ND no soportado para retry).
//  - { saleId }:
//      · Si hay un doc 'authorized' → lo devuelve (idempotente).
//      · Si hay un doc 'rejected' de tipo factura → retry de ese.
//      · Si no hay ninguno → emisión nueva (emitVoucherForSale sin opts).
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  emitCreditNoteForFactura,
  emitVoucherForSale,
  type EmitResult,
} from '../_shared/afip-emit-core.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface Body {
  documentId?: string;
  saleId?: string;
}

interface AfipDocRow {
  id: string;
  tenant_id: string;
  sale_id: string | null;
  doc_type: string;
  doc_letter: 'A' | 'B' | 'C';
  sales_point: number;
  voucher_number: number | null;
  cae: string | null;
  cae_due_date: string | null;
  status: string;
  related_doc_id: string | null;
  qr_url: string | null;
}

const DOC_COLS =
  'id, tenant_id, sale_id, doc_type, doc_letter, sales_point, ' +
  'voucher_number, cae, cae_due_date, status, related_doc_id, qr_url';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'https://pos.trankasoft.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  function jsonResponse(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;

    // --- 1. Validación del body (XOR documentId / saleId) -----------
    const hasDocId = typeof body.documentId === 'string' && body.documentId.length > 0;
    const hasSaleId = typeof body.saleId === 'string' && body.saleId.length > 0;
    if (hasDocId === hasSaleId) {
      return jsonResponse(
        { error: 'Enviá documentId o saleId (uno de los dos, no ambos)' },
        400,
      );
    }

    // --- 2. Auth ----------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);
    const callerId = userRes.user.id;

    const { data: mem } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (!mem) return jsonResponse({ error: 'No autorizado' }, 403);
    const tenantId = mem.tenant_id;

    // --- 3. AFIP_VAULT_KEY ------------------------------------------
    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      return jsonResponse({ error: 'Servidor sin AFIP_VAULT_KEY' }, 500);
    }

    // --- 4. admin client --------------------------------------------
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ================================================================
    // CASO A: { documentId } — retry de un afip_documents puntual
    // ================================================================
    if (hasDocId) {
      const { data: docData, error: docErr } = await admin
        .from('afip_documents')
        .select(DOC_COLS)
        .eq('id', body.documentId!)
        .maybeSingle();
      if (docErr) return jsonResponse({ error: docErr.message }, 500);
      const doc = docData as AfipDocRow | null;
      if (!doc) return jsonResponse({ error: 'Documento no encontrado' }, 404);
      if (doc.tenant_id !== tenantId) {
        return jsonResponse({ error: 'El documento no pertenece a tu tenant' }, 403);
      }
      if (doc.status !== 'rejected') {
        return jsonResponse(
          { error: 'Solo se reintentan documentos rechazados' },
          400,
        );
      }

      let result: EmitResult;
      switch (doc.doc_type) {
        case 'factura': {
          if (!doc.sale_id) {
            return jsonResponse(
              { error: 'La factura no tiene venta asociada, no se puede reintentar' },
              400,
            );
          }
          result = await emitVoucherForSale(
            admin,
            tenantId,
            doc.sale_id,
            encryptionKey,
            { existingDocId: doc.id },
          );
          break;
        }
        case 'nota_credito': {
          if (!doc.related_doc_id) {
            return jsonResponse(
              {
                error:
                  'La Nota de Crédito no tiene factura asociada (related_doc_id), ' +
                  'no se puede reintentar',
              },
              400,
            );
          }
          result = await emitCreditNoteForFactura(
            admin,
            tenantId,
            doc.related_doc_id,
            encryptionKey,
            { existingDocId: doc.id },
          );
          break;
        }
        case 'nota_debito':
          return jsonResponse(
            { error: 'tipo no soportado para retry' },
            400,
          );
        default:
          return jsonResponse(
            { error: `doc_type desconocido: ${doc.doc_type}` },
            400,
          );
      }
      return jsonResponse(result, 200);
    }

    // ================================================================
    // CASO B: { saleId } — retry / emisión del comprobante de la venta
    // ================================================================
    const { data: saleDocs, error: saleDocsErr } = await admin
      .from('afip_documents')
      .select(DOC_COLS)
      .eq('tenant_id', tenantId)
      .eq('sale_id', body.saleId!)
      .eq('doc_type', 'factura');
    if (saleDocsErr) return jsonResponse({ error: saleDocsErr.message }, 500);
    const docs = (saleDocs ?? []) as AfipDocRow[];

    // Si ya hay una factura authorized → devolverla (idempotente).
    const authorized = docs.find((d) => d.status === 'authorized');
    if (authorized) {
      return jsonResponse(
        {
          ok: true,
          already_emitted: true,
          documentId: authorized.id,
          cae: authorized.cae ?? undefined,
          voucherNumber: authorized.voucher_number ?? undefined,
          caeDueDate: authorized.cae_due_date ?? undefined,
          ptoVta: authorized.sales_point,
          cbteTipo: authorized.doc_letter,
          qrUrl: authorized.qr_url ?? undefined,
        } satisfies EmitResult,
        200,
      );
    }

    // Si hay una factura rejected → retry de esa (actualiza el doc existente).
    const rejected = docs.find((d) => d.status === 'rejected');
    if (rejected) {
      const result = await emitVoucherForSale(
        admin,
        tenantId,
        body.saleId!,
        encryptionKey,
        { existingDocId: rejected.id },
      );
      return jsonResponse(result, 200);
    }

    // No hay ningún afip_documents para la venta → emisión nueva.
    const result = await emitVoucherForSale(
      admin,
      tenantId,
      body.saleId!,
      encryptionKey,
    );
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
