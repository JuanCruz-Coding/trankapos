// =====================================================================
// Edge Function: afip-emit-credit-note
// =====================================================================
// Emite una Nota de Crédito AFIP vinculada a una factura original ya
// autorizada.
//
// Body (dos modos):
//   { mode: 'void', saleId: string }
//     → anula la venta facturada (void_sale_atomic) + emite NC del total.
//   { mode: 'manual', afipDocumentId: string, reason?: string }
//     → emite NC manual sobre una factura, SIN anular la venta.
//
// Sprint A5a: la lógica de emisión de la NC se extrajo a
// _shared/afip-emit-core.ts (emitCreditNoteForFactura). Este archivo quedó
// como SHELL que mantiene los dos modos:
//   - CORS + auth + parseo del body.
//   - mode='void': llama void_sale_atomic ANTES de emitir; si falla,
//     responde { ok:false, voided:false, error } sin emitir. Si OK, busca
//     la factura authorized de la sale y delega en emitCreditNoteForFactura,
//     agregando `voided: true` a la respuesta.
//   - mode='manual': delega directamente en emitCreditNoteForFactura con el
//     afipDocumentId recibido (que es el de la factura original).
//
// La respuesta es idéntica al contrato anterior (incluido el campo `voided`
// en mode='void').
//
// Errores de validación → HTTP 400/401/403.
// Resultado de emisión → HTTP 200 con { ok, ... } (EmitResult [+ voided]).
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { emitCreditNoteForFactura } from '../_shared/afip-emit-core.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

type Body =
  | { mode: 'void'; saleId: string }
  | { mode: 'manual'; afipDocumentId: string; reason?: string };

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

    // --- 1. Validación del body -------------------------------------
    if (!body || (body.mode !== 'void' && body.mode !== 'manual')) {
      return jsonResponse({ error: "mode debe ser 'void' o 'manual'" }, 400);
    }
    if (body.mode === 'void' && !body.saleId) {
      return jsonResponse({ error: "Falta saleId para mode='void'" }, 400);
    }
    if (body.mode === 'manual' && !body.afipDocumentId) {
      return jsonResponse({ error: "Falta afipDocumentId para mode='manual'" }, 400);
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

    // --- 5. mode='manual': delega directo ---------------------------
    if (body.mode === 'manual') {
      const result = await emitCreditNoteForFactura(
        admin,
        tenantId,
        body.afipDocumentId,
        encryptionKey,
      );
      return jsonResponse(result, 200);
    }

    // --- 6. mode='void' ---------------------------------------------
    // Buscamos la factura authorized de esa venta ANTES de anular: si la
    // venta no fue facturada, no hay NC que emitir y respondemos 400.
    const { data: facturaData, error: facturaErr } = await admin
      .from('afip_documents')
      .select('id, tenant_id, doc_type, status')
      .eq('sale_id', body.saleId)
      .eq('doc_type', 'factura')
      .eq('status', 'authorized')
      .maybeSingle();
    if (facturaErr) return jsonResponse({ error: facturaErr.message }, 500);
    const factura = facturaData as
      | { id: string; tenant_id: string; doc_type: string; status: string }
      | null;
    if (!factura) {
      return jsonResponse(
        {
          error:
            'Esta venta no tiene una factura autorizada para anular fiscalmente. ' +
            'Anulala con la anulación normal de venta (no requiere Nota de Crédito).',
        },
        400,
      );
    }
    if (factura.tenant_id !== tenantId) {
      return jsonResponse({ error: 'La factura no pertenece a tu tenant' }, 403);
    }

    // void_sale_atomic ANTES de emitir. Si falla, abortamos sin emitir.
    const { error: voidErr } = await admin.rpc('void_sale_atomic', {
      p_tenant_id: tenantId,
      p_sale_id: body.saleId,
    });
    if (voidErr) {
      return jsonResponse(
        {
          ok: false,
          error: `No se pudo anular la venta, no se emite la Nota de Crédito: ${voidErr.message}`,
          voided: false,
        },
        200,
      );
    }

    // Venta anulada OK → emitir la NC. Pase lo que pase con AFIP, la venta
    // ya quedó anulada (voided:true) y la NC queda rejected para reintentar.
    const result = await emitCreditNoteForFactura(
      admin,
      tenantId,
      factura.id,
      encryptionKey,
    );
    return jsonResponse({ ...result, voided: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
