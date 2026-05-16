// =====================================================================
// Edge Function: afip-exchange-sale (Sprint DEV)
// =====================================================================
// Procesa un CAMBIO completo: devolución parcial + nueva venta + cierre
// de diferencia (cobrar resto o devolver excedente).
//
// Flujo:
//   1) Emitir NC parcial sobre los `returnedItems` (vía emitPartialCreditNoteForFactura).
//   2) Reingresar stock de los items devueltos según `return_reasons.stock_destination`.
//   3) Crear la NUEVA venta (sales + sale_items + sale_payments) por INSERT
//      directo (NO se usa create_sale_atomic — payment_method no incluye un
//      método "NC aplicado" y agregarlo requiere migration). El total se calcula
//      acá; las `payments` que se persisten son las que mandó el caller. La
//      "diferencia cubierta por el NC" queda IMPLÍCITA (sin payment registrado).
//      Esto deja una asimetría en la conciliación de caja que se reconoce como
//      limitación del Sprint DEV; se cierra con una migration futura del enum.
//   4) Bajar stock de los `newItems` desde el warehouse default de la branch.
//   5) Emitir la nueva factura AFIP (emitVoucherForSale).
//   6) Marcar el doc de la NC como kind='exchange_nc'.
//   7) Cerrar diferencia:
//      - newSaleTotal == ncAmount  → no hay diferencia.
//      - newSaleTotal >  ncAmount  → el caller debe haber mandado payments por
//                                     >= newSaleTotal - ncAmount.
//      - newSaleTotal <  ncAmount  → delta a favor del cliente:
//          * refundMode='cash'   → cash_movements out (requiere caja abierta).
//          * refundMode='credit' → apply_customer_credit_movement (requiere customer_id).
//
// Body: ExchangeSaleInput. Respuesta: ExchangeSaleResult.
// =====================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  emitPartialCreditNoteForFactura,
  emitVoucherForSale,
} from '../_shared/afip-emit-core.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface ReturnedItem {
  saleItemId: string;
  qty: number;
}
interface NewItem {
  productId: string;
  variantId?: string;
  qty: number;
  price: number;
  discount: number;
}
type PaymentMethod = 'cash' | 'debit' | 'credit' | 'qr' | 'transfer';
interface PaymentInput {
  method: PaymentMethod;
  amount: number;
}
interface Receiver {
  customerId?: string | null;
  docType?: number | null;
  docNumber?: string | null;
  legalName?: string | null;
  ivaCondition?: string | null;
}
interface Body {
  originalSaleId: string;
  returnedItems: ReturnedItem[];
  newItems: NewItem[];
  payments: PaymentInput[];
  refundMode: 'cash' | 'credit';
  reasonId?: string | null;
  reasonText?: string | null;
  receiver?: Receiver | null;
}

interface ExchangeSaleResultLike {
  ok: boolean;
  creditNoteId?: string;
  newSaleId?: string;
  difference?: number;
  newCustomerBalance?: number | null;
  error?: string;
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

    // --- 1. Validación básica --------------------------------------
    if (!body || !body.originalSaleId) {
      return jsonResponse({ error: 'Falta originalSaleId' }, 400);
    }
    if (!Array.isArray(body.returnedItems) || body.returnedItems.length === 0) {
      return jsonResponse({ error: 'returnedItems vacío (usá afip-return-items + nueva venta por separado)' }, 400);
    }
    if (!Array.isArray(body.newItems) || body.newItems.length === 0) {
      return jsonResponse({ error: 'newItems vacío (usá afip-return-items si solo querés devolver)' }, 400);
    }
    if (!Array.isArray(body.payments)) {
      return jsonResponse({ error: 'payments debe ser un array' }, 400);
    }
    if (!['cash', 'credit'].includes(body.refundMode)) {
      return jsonResponse({ error: "refundMode inválido (cash|credit)" }, 400);
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

    // --- 5. Cargar la venta original + factura authorized -----------
    const { data: origSale, error: origSaleErr } = await admin
      .from('sales')
      .select('id, tenant_id, branch_id, register_id, customer_id, voided')
      .eq('id', body.originalSaleId)
      .maybeSingle();
    if (origSaleErr) return jsonResponse({ error: origSaleErr.message }, 500);
    if (!origSale) return jsonResponse({ error: 'Venta original no encontrada' }, 404);
    if (origSale.tenant_id !== tenantId) {
      return jsonResponse({ error: 'La venta no pertenece a tu tenant' }, 403);
    }
    if (origSale.voided) {
      return jsonResponse({ error: 'La venta original está anulada' }, 400);
    }

    // --- 5b. Tenant policy + motivo allows_cash_refund (Sprint DEV.fix) ----
    const { data: tenRow } = await admin
      .from('tenants')
      .select('refund_policy, store_credit_validity_months')
      .eq('id', tenantId)
      .maybeSingle();
    const refundPolicy = ((tenRow?.refund_policy as string | null) ??
      'cash_or_credit') as 'cash_or_credit' | 'credit_only' | 'cash_only';
    const validityMonths = (tenRow?.store_credit_validity_months as number | null) ?? null;

    let reasonAllowsCash = false;
    if (body.reasonId) {
      const { data: rRow } = await admin
        .from('return_reasons')
        .select('allows_cash_refund, tenant_id')
        .eq('id', body.reasonId)
        .maybeSingle();
      if (rRow && rRow.tenant_id === tenantId) {
        reasonAllowsCash = !!rRow.allows_cash_refund;
      }
    }

    // El refundMode acá solo afecta cuando hay diferencia a favor del cliente.
    // Validamos contra la policy del tenant (mismo criterio que return-items).
    if (refundPolicy === 'cash_only' && body.refundMode === 'credit') {
      return jsonResponse(
        {
          ok: false,
          error: 'La política del comercio es solo efectivo: no se pueden generar vales.',
        },
        200,
      );
    }
    if (refundPolicy === 'credit_only' && body.refundMode === 'cash' && !reasonAllowsCash) {
      return jsonResponse(
        {
          ok: false,
          error:
            'La política del comercio es entregar vale. Para devolver en efectivo, elegí un motivo que lo habilite (ej: Defectuoso).',
        },
        200,
      );
    }

    const { data: facturaData, error: facturaErr } = await admin
      .from('afip_documents')
      .select('id')
      .eq('sale_id', body.originalSaleId)
      .eq('doc_type', 'factura')
      .eq('status', 'authorized')
      .maybeSingle();
    if (facturaErr) return jsonResponse({ error: facturaErr.message }, 500);
    if (!facturaData) {
      return jsonResponse(
        { ok: false, error: 'La venta original no tiene factura AFIP autorizada' } satisfies ExchangeSaleResultLike,
        200,
      );
    }
    const facturaId = facturaData.id as string;

    // --- 6. Step 1: emitir NC parcial -------------------------------
    const ncResult = await emitPartialCreditNoteForFactura(
      admin,
      tenantId,
      facturaId,
      body.returnedItems,
      encryptionKey,
      { reasonId: body.reasonId ?? null, reasonText: body.reasonText ?? null },
    );
    if (!ncResult.ok || !ncResult.documentId) {
      return jsonResponse(
        {
          ok: false,
          creditNoteId: ncResult.documentId,
          error: ncResult.error ?? 'No se pudo emitir la Nota de Crédito parcial',
        } satisfies ExchangeSaleResultLike,
        200,
      );
    }
    const ncId = ncResult.documentId;
    const ncAmount = ncResult.creditNoteAmount ?? 0;

    // --- 7. Step 2: devolver stock de los items devueltos -----------
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

    if (stockDestination !== 'discard') {
      let returnWarehouseId: string | null = null;
      if (stockDestination === 'specific_warehouse' && destinationWarehouseId) {
        returnWarehouseId = destinationWarehouseId;
      } else {
        const { data: whRow } = await admin
          .from('warehouses')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('branch_id', origSale.branch_id)
          .eq('is_default', true)
          .eq('active', true)
          .maybeSingle();
        returnWarehouseId = (whRow?.id as string | null) ?? null;
      }
      if (returnWarehouseId) {
        await returnStockForItems(admin, tenantId, returnWarehouseId, body.returnedItems);
      }
    }

    // --- 8. Step 3: crear la nueva venta por INSERT manual ----------
    // Resolver warehouse default de la branch original (la nueva venta es en la
    // misma branch).
    const { data: defWh } = await admin
      .from('warehouses')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', origSale.branch_id)
      .eq('is_default', true)
      .eq('active', true)
      .maybeSingle();
    if (!defWh) {
      return jsonResponse(
        {
          ok: false,
          creditNoteId: ncId,
          error:
            'NC emitida pero la sucursal no tiene depósito default activo. La nueva venta no se creó.',
        } satisfies ExchangeSaleResultLike,
        200,
      );
    }
    const defaultWarehouseId = defWh.id as string;

    // Resolver datos de cada newItem (nombre, barcode, tax_rate, variant_id).
    const enrichedItems: {
      productId: string;
      variantId: string;
      name: string;
      barcode: string | null;
      price: number;
      qty: number;
      discount: number;
      subtotal: number;
    }[] = [];
    let subtotalAccum = 0;
    for (const it of body.newItems) {
      if (it.qty <= 0) return jsonResponse({ error: 'Cantidad inválida en newItems' }, 400);
      if (it.price < 0) return jsonResponse({ error: 'Precio inválido en newItems' }, 400);
      if (it.discount < 0) return jsonResponse({ error: 'Descuento inválido en newItems' }, 400);

      const { data: prodRow } = await admin
        .from('products')
        .select('id, name, barcode, tenant_id')
        .eq('id', it.productId)
        .maybeSingle();
      if (!prodRow || prodRow.tenant_id !== tenantId) {
        return jsonResponse({ error: `Producto ${it.productId} no encontrado` }, 400);
      }

      let variantId = it.variantId ?? null;
      if (!variantId) {
        const { data: defVar } = await admin
          .from('product_variants')
          .select('id')
          .eq('product_id', it.productId)
          .eq('is_default', true)
          .maybeSingle();
        if (!defVar) {
          return jsonResponse({ error: `Producto ${it.productId} sin variante default` }, 400);
        }
        variantId = defVar.id as string;
      } else {
        const { data: varRow } = await admin
          .from('product_variants')
          .select('id, product_id, tenant_id')
          .eq('id', variantId)
          .maybeSingle();
        if (!varRow || varRow.tenant_id !== tenantId || varRow.product_id !== it.productId) {
          return jsonResponse({ error: `Variante ${variantId} inválida` }, 400);
        }
      }

      const lineSubtotal = Math.round((it.price * it.qty - it.discount) * 100) / 100;
      if (lineSubtotal < 0) {
        return jsonResponse({ error: 'El descuento supera el subtotal de línea' }, 400);
      }
      subtotalAccum = Math.round((subtotalAccum + lineSubtotal) * 100) / 100;

      enrichedItems.push({
        productId: it.productId,
        variantId,
        name: prodRow.name as string,
        barcode: (prodRow.barcode as string | null) ?? null,
        price: it.price,
        qty: it.qty,
        discount: it.discount,
        subtotal: lineSubtotal,
      });
    }

    const newSaleTotal = subtotalAccum; // sin descuento global en exchange (simplificación)
    const paidAmount = body.payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);

    // --- 9. Validar balance NC vs total nuevo vs pagos --------------
    // delta positivo  → cliente recibe diferencia
    // delta negativo  → cliente paga diferencia
    const delta = Math.round((ncAmount - newSaleTotal) * 100) / 100;

    if (delta < 0) {
      // Cliente debe poner la diferencia.
      const owed = Math.abs(delta);
      if (paidAmount + 0.005 < owed) {
        return jsonResponse(
          {
            ok: false,
            creditNoteId: ncId,
            error: `El cliente debe poner $${owed.toFixed(2)} de diferencia (mandó $${paidAmount.toFixed(2)})`,
          } satisfies ExchangeSaleResultLike,
          200,
        );
      }
      if (paidAmount > owed + 0.005) {
        return jsonResponse(
          {
            ok: false,
            creditNoteId: ncId,
            error: `El cliente pagó de más ($${paidAmount.toFixed(2)} vs $${owed.toFixed(2)} requeridos)`,
          } satisfies ExchangeSaleResultLike,
          200,
        );
      }
    } else {
      // delta >= 0 → no hace falta que el cliente pague. payments debería ser vacío.
      if (paidAmount > 0.005) {
        return jsonResponse(
          {
            ok: false,
            creditNoteId: ncId,
            error: 'El nuevo total es menor o igual al NC: no se esperan pagos del cliente',
          } satisfies ExchangeSaleResultLike,
          200,
        );
      }
    }

    // --- 10. INSERT manual de la nueva venta ------------------------
    // Mismo snapshot del receptor que SaleInput.receiver. Si no viene, queda
    // anónima (heredando el customer_id de la venta original si querés acreditar
    // saldo después, lo dejamos null acá para no contaminar).
    const receiver = body.receiver ?? null;

    // Determinar register_id: usamos el de la venta original si todavía está
    // abierto; si no, buscamos la caja abierta de la branch.
    let registerId: string | null = origSale.register_id as string | null;
    if (registerId) {
      const { data: regCheck } = await admin
        .from('cash_registers')
        .select('id, closed_at')
        .eq('id', registerId)
        .maybeSingle();
      if (!regCheck || regCheck.closed_at) registerId = null;
    }
    if (!registerId) {
      const { data: openReg } = await admin
        .from('cash_registers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('branch_id', origSale.branch_id)
        .is('closed_at', null)
        .limit(1)
        .maybeSingle();
      registerId = (openReg?.id as string | null) ?? null;
    }

    const { data: newSaleRow, error: newSaleErr } = await admin
      .from('sales')
      .insert({
        tenant_id: tenantId,
        branch_id: origSale.branch_id,
        register_id: registerId,
        cashier_id: callerId,
        subtotal: subtotalAccum,
        discount: 0,
        total: newSaleTotal,
        voided: false,
        status: 'paid',
        stock_reserved_mode: false,
        customer_id: receiver?.customerId ?? null,
        customer_doc_type: receiver?.docType ?? null,
        customer_doc_number: receiver?.docNumber ?? null,
        customer_legal_name: receiver?.legalName ?? null,
        customer_iva_condition: receiver?.ivaCondition ?? null,
      })
      .select('id')
      .single();
    if (newSaleErr) {
      return jsonResponse(
        {
          ok: false,
          creditNoteId: ncId,
          error: `No se pudo crear la nueva venta: ${newSaleErr.message}`,
        } satisfies ExchangeSaleResultLike,
        200,
      );
    }
    const newSaleId = newSaleRow.id as string;

    // sale_items
    const itemsPayload = enrichedItems.map((it) => ({
      sale_id: newSaleId,
      tenant_id: tenantId,
      product_id: it.productId,
      variant_id: it.variantId,
      name: it.name,
      barcode: it.barcode,
      price: it.price,
      qty: it.qty,
      discount: it.discount,
      subtotal: it.subtotal,
    }));
    const { error: itemsErr } = await admin.from('sale_items').insert(itemsPayload);
    if (itemsErr) {
      return jsonResponse(
        {
          ok: false,
          creditNoteId: ncId,
          newSaleId,
          error: `No se pudieron insertar los items de la nueva venta: ${itemsErr.message}`,
        } satisfies ExchangeSaleResultLike,
        200,
      );
    }

    // sale_payments — solo los que mandó el caller. La parte cubierta por la NC
    // queda implícita (limitación documentada arriba).
    if (body.payments.length > 0) {
      const paymentsPayload = body.payments.map((p) => ({
        sale_id: newSaleId,
        tenant_id: tenantId,
        method: p.method,
        amount: p.amount,
      }));
      const { error: payErr } = await admin.from('sale_payments').insert(paymentsPayload);
      if (payErr) {
        console.warn(`[afip-exchange-sale] sale_payments falló: ${payErr.message}`);
      }
    }

    // --- 11. Bajar stock de los newItems ----------------------------
    for (const it of enrichedItems) {
      const { data: stockRow } = await admin
        .from('stock_items')
        .select('id, qty')
        .eq('tenant_id', tenantId)
        .eq('warehouse_id', defaultWarehouseId)
        .eq('variant_id', it.variantId)
        .maybeSingle();
      if (stockRow) {
        const newQty = Number(stockRow.qty ?? 0) - it.qty;
        await admin
          .from('stock_items')
          .update({ qty: newQty, updated_at: new Date().toISOString() })
          .eq('id', stockRow.id);
      } else {
        await admin.from('stock_items').insert({
          tenant_id: tenantId,
          warehouse_id: defaultWarehouseId,
          product_id: it.productId,
          variant_id: it.variantId,
          qty: -it.qty,
          min_qty: 0,
        });
      }
    }

    // --- 12. Step 5: emitir factura de la nueva venta ---------------
    const newFacResult = await emitVoucherForSale(admin, tenantId, newSaleId, encryptionKey);
    if (!newFacResult.ok) {
      // La nueva venta existe pero la factura quedó pending/rejected: el caller
      // puede reintentar luego (afip-retry-document). No abortamos el flujo.
      console.warn(`[afip-exchange-sale] nueva factura falló: ${newFacResult.error}`);
    }

    // --- 13. Step 8: marcar NC como exchange_nc ---------------------
    await admin
      .from('afip_documents')
      .update({ kind: 'exchange_nc' })
      .eq('id', ncId);

    // --- 14. Step 4 final: cerrar diferencia a favor del cliente ----
    let newCustomerBalance: number | null = null;
    if (delta > 0.005) {
      // ncAmount > newSaleTotal → devolver `delta` al cliente
      if (body.refundMode === 'cash') {
        // Necesita caja abierta.
        if (!registerId) {
          return jsonResponse(
            {
              ok: true,
              creditNoteId: ncId,
              newSaleId,
              difference: delta,
              error:
                'Cambio procesado pero no hay caja abierta para devolver el efectivo. Registralo manualmente.',
            } satisfies ExchangeSaleResultLike,
            200,
          );
        }
        const { error: movErr } = await admin
          .from('cash_movements')
          .insert({
            tenant_id: tenantId,
            register_id: registerId,
            kind: 'out',
            amount: delta,
            reason: `Cambio venta ${body.originalSaleId} (diferencia a favor)`,
            created_by: callerId,
          });
        if (movErr) console.warn(`[afip-exchange-sale] cash_movement falló: ${movErr.message}`);
      } else {
        // credit
        const targetCustomerId = receiver?.customerId ?? origSale.customer_id ?? null;
        if (!targetCustomerId) {
          return jsonResponse(
            {
              ok: true,
              creditNoteId: ncId,
              newSaleId,
              difference: delta,
              error: 'Cambio procesado pero no hay cliente para acreditar el saldo. Resolvelo manualmente.',
            } satisfies ExchangeSaleResultLike,
            200,
          );
        }
        // Sprint DEV.fix: vencimiento del vale.
        const expiresAt =
          validityMonths && validityMonths > 0
            ? new Date(Date.now() + validityMonths * 30 * 24 * 60 * 60 * 1000).toISOString()
            : null;
        const { data: balData, error: balErr } = await admin.rpc('apply_customer_credit_movement', {
          p_tenant_id: tenantId,
          p_customer_id: targetCustomerId,
          p_amount: delta,
          p_reason: 'return_credit',
          p_related_sale_id: body.originalSaleId,
          p_related_doc_id: ncId,
          p_notes: body.reasonText ?? null,
          p_created_by: callerId,
          p_expires_at: expiresAt,
        });
        if (balErr) {
          console.warn(`[afip-exchange-sale] credit RPC falló: ${balErr.message}`);
        } else {
          newCustomerBalance = balData != null ? Number(balData) : null;
        }
      }
    }

    return jsonResponse(
      {
        ok: true,
        creditNoteId: ncId,
        newSaleId,
        difference: delta,
        newCustomerBalance,
      } satisfies ExchangeSaleResultLike,
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

async function returnStockForItems(
  admin: SupabaseClient,
  tenantId: string,
  warehouseId: string,
  items: ReturnedItem[],
): Promise<void> {
  for (const it of items) {
    const { data: siRow } = await admin
      .from('sale_items')
      .select('variant_id, product_id')
      .eq('id', it.saleItemId)
      .maybeSingle();
    if (!siRow) continue;
    const variantId = siRow.variant_id as string | null;
    const productId = siRow.product_id as string;
    if (!variantId) continue;

    const { data: stockRow } = await admin
      .from('stock_items')
      .select('id, qty')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId)
      .eq('variant_id', variantId)
      .maybeSingle();

    if (stockRow) {
      const newQty = Number(stockRow.qty ?? 0) + it.qty;
      await admin
        .from('stock_items')
        .update({ qty: newQty, updated_at: new Date().toISOString() })
        .eq('id', stockRow.id);
    } else {
      await admin.from('stock_items').insert({
        tenant_id: tenantId,
        warehouse_id: warehouseId,
        product_id: productId,
        variant_id: variantId,
        qty: it.qty,
        min_qty: 0,
      });
    }
  }
}
