// =====================================================================
// Edge Function: afip-return-items (Sprint DEV)
// =====================================================================
// Procesa una devolución parcial de items SIN cambio:
//   1) Emite Nota de Crédito parcial sobre la factura de la venta.
//   2) Devuelve stock según `return_reasons.stock_destination`:
//        - 'original'           → al warehouse default de la branch
//        - 'specific_warehouse' → al destination_warehouse_id del motivo
//        - 'discard'            → no se reingresa (pérdida)
//   3) Refund según `refundMode`:
//        - 'cash'   → cash_movements (out) en la caja abierta
//        - 'credit' → suma al saldo a favor del cliente (requiere customer_id)
//        - 'none'   → no hace nada (cierre manual)
//
// Body: ReturnSaleItemsInput (ver src/data/driver.ts).
// Respuesta: ReturnSaleItemsResult.
// =====================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { emitPartialCreditNoteForFactura } from '../_shared/afip-emit-core.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface ReturnItem {
  saleItemId: string;
  qty: number;
}
interface Body {
  saleId: string;
  items: ReturnItem[];
  reasonId?: string | null;
  reasonText?: string | null;
  refundMode: 'cash' | 'credit' | 'none';
}

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

    // --- 1. Validación básica del body ------------------------------
    if (!body || !body.saleId) return jsonResponse({ error: 'Falta saleId' }, 400);
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse({ error: 'No hay items para devolver' }, 400);
    }
    if (!['cash', 'credit', 'none'].includes(body.refundMode)) {
      return jsonResponse({ error: "refundMode inválido (cash|credit|none)" }, 400);
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
    const tenantId = mem.tenant_id as string;

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

    // --- 5. Cargar la venta + buscar factura authorized -------------
    const { data: saleData, error: saleErr } = await admin
      .from('sales')
      .select('id, tenant_id, branch_id, customer_id, voided')
      .eq('id', body.saleId)
      .maybeSingle();
    if (saleErr) return jsonResponse({ error: saleErr.message }, 500);
    if (!saleData) return jsonResponse({ error: 'Venta no encontrada' }, 404);
    if (saleData.tenant_id !== tenantId) {
      return jsonResponse({ error: 'La venta no pertenece a tu tenant' }, 403);
    }
    if (saleData.voided) {
      return jsonResponse({ error: 'La venta está anulada' }, 400);
    }

    const { data: facturaData, error: facturaErr } = await admin
      .from('afip_documents')
      .select('id, status')
      .eq('sale_id', body.saleId)
      .eq('doc_type', 'factura')
      .eq('status', 'authorized')
      .maybeSingle();
    if (facturaErr) return jsonResponse({ error: facturaErr.message }, 500);
    if (!facturaData) {
      return jsonResponse(
        { ok: false, error: 'La venta no tiene una factura AFIP autorizada' },
        200,
      );
    }
    const facturaId = facturaData.id as string;

    // --- 6. Emitir la NC parcial ------------------------------------
    const ncResult = await emitPartialCreditNoteForFactura(
      admin,
      tenantId,
      facturaId,
      body.items,
      encryptionKey,
      { reasonId: body.reasonId ?? null, reasonText: body.reasonText ?? null },
    );

    if (!ncResult.ok || !ncResult.documentId) {
      return jsonResponse(
        {
          ok: false,
          creditNoteId: ncResult.documentId,
          error: ncResult.error ?? 'No se pudo emitir la Nota de Crédito',
        } satisfies ReturnSaleItemsResultLike,
        200,
      );
    }

    // --- 7. Resolver el motivo (stock_destination) ------------------
    let stockDestination: 'original' | 'specific_warehouse' | 'discard' = 'original';
    let destinationWarehouseId: string | null = null;
    if (body.reasonId) {
      const { data: reasonRow } = await admin
        .from('return_reasons')
        .select('stock_destination, destination_warehouse_id, tenant_id')
        .eq('id', body.reasonId)
        .maybeSingle();
      if (reasonRow && reasonRow.tenant_id === tenantId) {
        stockDestination = reasonRow.stock_destination as typeof stockDestination;
        destinationWarehouseId = (reasonRow.destination_warehouse_id as string | null) ?? null;
      }
    }

    // --- 8. Devolver stock al destino correcto ----------------------
    if (stockDestination !== 'discard') {
      let targetWarehouseId: string | null = null;
      if (stockDestination === 'specific_warehouse' && destinationWarehouseId) {
        targetWarehouseId = destinationWarehouseId;
      } else {
        // Warehouse default de la branch (mismo patrón que void_sale_atomic).
        const { data: whRow } = await admin
          .from('warehouses')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('branch_id', saleData.branch_id)
          .eq('is_default', true)
          .eq('active', true)
          .maybeSingle();
        targetWarehouseId = (whRow?.id as string | null) ?? null;
      }

      if (targetWarehouseId) {
        await returnStockForItems(admin, tenantId, targetWarehouseId, body.items);
      } else {
        console.warn(
          `[afip-return-items] No se encontró warehouse para devolver stock (sale=${body.saleId})`,
        );
      }
    }

    // --- 9. Refund ---------------------------------------------------
    const ncAmount = ncResult.creditNoteAmount ?? 0;
    let newCustomerBalance: number | null = null;

    if (body.refundMode === 'cash' && ncAmount > 0) {
      // Buscamos la caja abierta de la branch de la sale.
      const { data: regRow } = await admin
        .from('cash_registers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('branch_id', saleData.branch_id)
        .is('closed_at', null)
        .limit(1)
        .maybeSingle();
      if (!regRow) {
        // La NC ya está autorizada y el stock ya volvió: no podemos abortar.
        // Devolvemos OK con un mensaje en error y dejamos el refund manual.
        return jsonResponse(
          {
            ok: true,
            creditNoteId: ncResult.documentId,
            creditNoteAmount: ncAmount,
            error:
              'NC emitida pero no hay caja abierta en la sucursal para registrar la devolución en efectivo. Registrala manualmente cuando abras la caja.',
          } satisfies ReturnSaleItemsResultLike,
          200,
        );
      }
      const { error: movErr } = await admin
        .from('cash_movements')
        .insert({
          tenant_id: tenantId,
          register_id: regRow.id,
          kind: 'out',
          amount: ncAmount,
          reason: `Devolución venta ${body.saleId}`,
          created_by: callerId,
        });
      if (movErr) {
        console.warn(`[afip-return-items] cash_movement falló: ${movErr.message}`);
      }
    } else if (body.refundMode === 'credit' && ncAmount > 0) {
      if (!saleData.customer_id) {
        return jsonResponse(
          {
            ok: true,
            creditNoteId: ncResult.documentId,
            creditNoteAmount: ncAmount,
            error:
              'NC emitida pero la venta no tiene cliente asociado: no se puede acreditar saldo. Resolvelo manualmente.',
          } satisfies ReturnSaleItemsResultLike,
          200,
        );
      }
      const { data: balData, error: balErr } = await admin.rpc('apply_customer_credit_movement', {
        p_tenant_id: tenantId,
        p_customer_id: saleData.customer_id,
        p_amount: ncAmount,
        p_reason: 'return_credit',
        p_related_sale_id: body.saleId,
        p_related_doc_id: ncResult.documentId,
        p_notes: body.reasonText ?? null,
        p_created_by: callerId,
      });
      if (balErr) {
        console.warn(`[afip-return-items] credit RPC falló: ${balErr.message}`);
      } else {
        newCustomerBalance = balData != null ? Number(balData) : null;
      }
    }
    // refundMode === 'none' → no hacemos nada.

    return jsonResponse(
      {
        ok: true,
        creditNoteId: ncResult.documentId,
        creditNoteAmount: ncAmount,
        newCustomerBalance,
      } satisfies ReturnSaleItemsResultLike,
      200,
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      },
    );
  }
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

interface ReturnSaleItemsResultLike {
  ok: boolean;
  creditNoteId?: string;
  creditNoteAmount?: number;
  newCustomerBalance?: number | null;
  error?: string;
}

/**
 * Devuelve stock para cada item devuelto al warehouse target. Mismo patrón
 * que void_sale_atomic pero por variant_id de cada sale_item.
 */
async function returnStockForItems(
  admin: SupabaseClient,
  tenantId: string,
  warehouseId: string,
  items: ReturnItem[],
): Promise<void> {
  for (const it of items) {
    // Cargar variant_id + product_id del sale_item.
    const { data: siRow } = await admin
      .from('sale_items')
      .select('variant_id, product_id')
      .eq('id', it.saleItemId)
      .maybeSingle();
    if (!siRow) continue;
    const variantId = siRow.variant_id as string | null;
    const productId = siRow.product_id as string;
    if (!variantId) continue; // post-030 todas las filas tienen variant_id

    // ¿Existe stock_items para esta variante en el warehouse target?
    const { data: stockRow } = await admin
      .from('stock_items')
      .select('id, qty')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId)
      .eq('variant_id', variantId)
      .maybeSingle();

    if (stockRow) {
      const newQty = Number(stockRow.qty ?? 0) + it.qty;
      const { error: updErr } = await admin
        .from('stock_items')
        .update({ qty: newQty, updated_at: new Date().toISOString() })
        .eq('id', stockRow.id);
      if (updErr) console.warn(`[afip-return-items] update stock falló: ${updErr.message}`);
    } else {
      const { error: insErr } = await admin
        .from('stock_items')
        .insert({
          tenant_id: tenantId,
          warehouse_id: warehouseId,
          product_id: productId,
          variant_id: variantId,
          qty: it.qty,
          min_qty: 0,
        });
      if (insErr) console.warn(`[afip-return-items] insert stock falló: ${insErr.message}`);
    }
  }
}
