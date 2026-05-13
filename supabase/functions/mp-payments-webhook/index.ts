// =====================================================================
// Edge Function: mp-payments-webhook
// =====================================================================
// Recibe notificaciones de MP cuando un cobro QR del comercio se aprueba.
//
// La URL del webhook se configura UNA SOLA VEZ en el panel de la app MP
// (Tus integraciones → app → Webhooks). MP NO permite notification_url
// custom en el body de /v1/orders, así que la URL es fija para toda la
// plataforma.
//
// Identificación del tenant:
//   MP incluye en el body del webhook el campo `user_id` = id del seller.
//   Hacemos lookup en tenant_payment_integrations.mp_user_id para obtener
//   tenant_id + access_token. Eso reemplaza al viejo ?t=tenantId que ya
//   no podemos mandar.
//
// Secrets requeridos:
//   MP_PAYMENTS_WEBHOOK_SECRET — para validar HMAC
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ============================================================
// HMAC helpers (copiados de mp-webhook para mantenerlas independientes)
// ============================================================

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface HmacResult {
  ok: boolean;
  reason: string;
  diag: Record<string, unknown>;
}

async function verifySignature(req: Request, dataId: string): Promise<HmacResult> {
  const secret = Deno.env.get('MP_PAYMENTS_WEBHOOK_SECRET');
  if (!secret) {
    return { ok: false, reason: 'secret_missing', diag: {} };
  }
  const sigHeader = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';

  const parts = sigHeader.split(',').map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('ts='))?.slice(3);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!ts || !v1) {
    return {
      ok: false,
      reason: 'header_parse_failed',
      diag: { sigHeader, requestId, dataId },
    };
  }
  const tsNum = Number(ts);
  const tsSeconds = tsNum > 1e12 ? tsNum / 1000 : tsNum;
  const drift = Math.abs(Date.now() / 1000 - tsSeconds);
  if (!Number.isFinite(tsNum) || drift > 600) {
    return {
      ok: false,
      reason: 'ts_out_of_range',
      diag: { ts, drift, dataId },
    };
  }

  // ¡Detalle no documentado!: MP firma con el data.id EN MINÚSCULAS aunque
  // lo envía en el body en mayúsculas (ej. "ORD01KRH..." en el body firma
  // como "ord01krh..."). Si no se respeta, el HMAC nunca matchea para Orders.
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = await hmacSha256Hex(secret, manifest);
  const match = timingSafeEqual(expected, v1);

  return {
    ok: match,
    reason: match ? 'ok' : 'hmac_mismatch',
    diag: {
      manifest,
      expected_prefix: expected.slice(0, 16),
      got_prefix: v1.slice(0, 16),
      secret_prefix: secret.slice(0, 4) + '…' + secret.slice(-4),
      ts,
      requestId,
      dataId,
    },
  };
}

interface MpWebhookPayload {
  type?: string;
  action?: string;
  topic?: string;
  resource?: string;
  data?: { id?: string };
  id?: string | number;
  // user_id: id del seller (collector) que recibe el pago. Lo usamos para
  // identificar tenant_id en nuestra tabla.
  user_id?: number | string;
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('ok', { status: 200 });

  let payload: MpWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Body inválido', { status: 200 });
  }

  // El topic puede venir como `type` o `topic`. El id como `data.id` o `id`.
  const type = payload.type ?? payload.topic ?? payload.action ?? '';
  const dataId = payload.data?.id ?? (payload.id ? String(payload.id) : null);
  if (!dataId) {
    return new Response(JSON.stringify({ ignored: 'sin data.id' }), { status: 200 });
  }
  const mpUserId = payload.user_id != null ? String(payload.user_id) : null;

  // Validar HMAC con el template correcto para Orders (dataId en minúsculas).
  const hmacRes = await verifySignature(req, String(dataId));
  if (!hmacRes.ok) {
    console.warn('[HMAC] Firma inválida:', hmacRes.reason);
    return new Response(
      JSON.stringify({ error: 'Firma inválida', reason: hmacRes.reason }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Idempotencia: registramos el request_id antes de procesar
  const requestId = req.headers.get('x-request-id') ?? '';
  if (requestId) {
    const { error: dupErr } = await adminClient
      .from('processed_webhook_events')
      .insert({
        request_id: requestId,
        event_type: type,
        data_id: String(dataId),
      });
    if (dupErr && dupErr.code === '23505') {
      return new Response(
        JSON.stringify({ ok: true, ignored: 'duplicate' }),
        { status: 200 },
      );
    }
  }

  try {
    // Resolver tenant + access_token por mp_user_id (seller) del payload.
    if (!mpUserId) {
      console.warn('Webhook sin user_id en payload — type:', type, 'dataId:', dataId);
      return new Response('ok', { status: 200 });
    }

    const { data: integ } = await adminClient
      .from('tenant_payment_integrations')
      .select('access_token, tenant_id')
      .eq('mp_user_id', mpUserId)
      .eq('provider', 'mp')
      .maybeSingle();
    const accessToken = integ?.access_token ?? null;

    if (!accessToken) {
      console.warn(
        `No hay integración MP activa para mp_user_id=${mpUserId} — ignorando webhook`,
      );
      return new Response('ok', { status: 200 });
    }

    // Aceptamos:
    //   - 'order' / 'order.updated' / 'order.action_required' → nueva API de Orders
    //   - 'merchant_order' → API legacy (fallback)
    // El topic 'payment' por sí solo lo ignoramos: confiamos en order/merchant_order
    // para detectar venta completa (un Order puede tener varios payments).
    const isNewOrder = type === 'order' || type.startsWith('order.');
    const isLegacyMerchantOrder = type.includes('merchant_order');
    if (!isNewOrder && !isLegacyMerchantOrder) {
      return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });
    }

    // GET del recurso para ver el estado real. Cada API usa endpoint distinto.
    const orderUrl = isNewOrder
      ? `https://api.mercadopago.com/v1/orders/${dataId}`
      : `https://api.mercadopago.com/merchant_orders/${dataId}`;
    const orderRes = await fetch(orderUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!orderRes.ok) {
      console.error('Error fetch order:', orderRes.status, await orderRes.text());
      return new Response('ok', { status: 200 });
    }
    const order = await orderRes.json() as {
      id: number | string;
      // Nueva API (v1/orders)
      status?: string;
      external_reference?: string;
      total_amount?: number | string;
      type_response?: { qr_data?: string };
      transactions?: { payments?: { status?: string; amount?: number | string }[] };
      // Legacy (merchant_orders)
      paid_amount?: number;
      order_status?: string;
      payments?: { status?: string; transaction_amount?: number }[];
    };

    const externalRef = order.external_reference;
    if (!externalRef) {
      console.warn('order sin external_reference');
      return new Response('ok', { status: 200 });
    }

    // Buscamos el intent
    const { data: intent } = await adminClient
      .from('mp_payment_intents')
      .select('id, status, sale_id, amount')
      .eq('external_reference', externalRef)
      .maybeSingle();
    if (!intent) {
      console.warn('Intent no encontrado para external_reference:', externalRef);
      return new Response('ok', { status: 200 });
    }

    if (intent.status === 'approved' && intent.sale_id) {
      return new Response(
        JSON.stringify({ ok: true, ignored: 'already_processed' }),
        { status: 200 },
      );
    }

    // ¿El order está saldado? Aceptamos varios indicadores según API:
    //   - Nueva: status 'processed' / 'paid' / 'closed'
    //   - Legacy: order_status 'paid' o paid_amount >= total_amount
    //   - Cualquiera: si todos los payments del array están approved y cubren total
    const newApiPaid =
      isNewOrder &&
      (order.status === 'processed' ||
        order.status === 'paid' ||
        order.status === 'closed' ||
        (order.transactions?.payments?.some((p) => p.status === 'approved') ?? false));
    const legacyPaid =
      isLegacyMerchantOrder &&
      (order.order_status === 'paid' ||
        order.status === 'closed' ||
        (typeof order.paid_amount === 'number' &&
          typeof order.total_amount === 'number' &&
          order.paid_amount >= order.total_amount));
    const isPaid = newApiPaid || legacyPaid;

    if (!isPaid) {
      // Posiblemente todavía está pendiente — devolver ok y esperar próxima notificación
      return new Response(
        JSON.stringify({ ok: true, pending: true, status: order.status ?? order.order_status }),
        { status: 200 },
      );
    }

    // Crear sale desde intent (idempotente desde el lado de la RPC)
    const { data: saleId, error: rpcErr } = await adminClient.rpc(
      'create_sale_from_intent_atomic',
      { p_intent_id: intent.id },
    );
    if (rpcErr) {
      console.error('Error create_sale_from_intent_atomic:', rpcErr);
      return new Response('ok', { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, saleId }), { status: 200 });
  } catch (err) {
    console.error('Error procesando mp-payments-webhook:', err);
    return new Response('ok', { status: 200 });
  }
});
