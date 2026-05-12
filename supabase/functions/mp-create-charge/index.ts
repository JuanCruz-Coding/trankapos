// =====================================================================
// Edge Function: mp-create-charge
// =====================================================================
// El POS pide un cobro QR. Esta función:
//   1. Valida caller + lee la integración MP del tenant.
//   2. Inserta un mp_payment_intent (status pending).
//   3. Llama al endpoint QR dinámico de MP con external_reference = intent.id.
//   4. Devuelve qr_data + intentId al frontend (que renderiza el QR).
//
// La venta NO se crea acá — se crea cuando llega el webhook approved.
//
// Body esperado:
//   { branchId, registerId?, items[], discount, amount, title?, notificationUrl? }
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

const QR_EXPIRATION_MINUTES = 10;

interface ChargeItem {
  productId: string;
  qty: number;
  price: number;
  discount: number;
  name?: string;
}

interface Body {
  branchId: string;
  registerId: string | null;
  items: ChargeItem[];
  discount: number;
  amount: number;
  title?: string;
  notificationUrl?: string;
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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    if (!body.branchId) return jsonResponse({ error: 'Falta branchId' }, 400);
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse({ error: 'El carrito está vacío' }, 400);
    }
    if (!Number.isFinite(body.amount) || body.amount <= 0) {
      return jsonResponse({ error: 'Monto inválido' }, 400);
    }

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

    const { data: mem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !mem) return jsonResponse({ error: 'No autorizado' }, 403);
    const tenantId = mem.tenant_id;

    // 1. Lee integración MP del tenant (con service_role para acceder al token)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: integ, error: integErr } = await adminClient
      .from('tenant_payment_integrations')
      .select('access_token, mp_user_id, mp_pos_external_id, mp_pos_id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'mp')
      .maybeSingle();
    if (integErr) return jsonResponse({ error: integErr.message }, 500);
    if (!integ) {
      return jsonResponse(
        { error: 'Mercado Pago no está conectado. Configuralo en /settings.' },
        400,
      );
    }
    if (!integ.mp_pos_external_id || !integ.mp_user_id) {
      return jsonResponse(
        {
          error:
            'Falta configuración de caja en Mercado Pago. Reconectá MP desde /settings.',
        },
        400,
      );
    }

    // 2. Insertar intent en pending (external_reference = id del intent)
    const { data: intent, error: intentErr } = await adminClient
      .from('mp_payment_intents')
      .insert({
        tenant_id: tenantId,
        branch_id: body.branchId,
        register_id: body.registerId ?? null,
        cashier_id: callerId,
        items: body.items,
        discount: body.discount ?? 0,
        amount: body.amount,
        external_reference: crypto.randomUUID(),
        status: 'pending',
        expires_at: new Date(Date.now() + QR_EXPIRATION_MINUTES * 60_000).toISOString(),
      })
      .select('id, external_reference')
      .single();
    if (intentErr || !intent) {
      return jsonResponse(
        { error: `No se pudo crear intent: ${intentErr?.message ?? 'desconocido'}` },
        500,
      );
    }

    // 3. Llamar a MP para generar QR dinámico
    // notification_url incluye ?t=tenantId para que el webhook sepa qué
    // access_token usar al hacer el GET del merchant_order.
    const baseUrl =
      body.notificationUrl ??
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-payments-webhook`;
    const notificationUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${tenantId}`;
    const expirationDate = new Date(
      Date.now() + QR_EXPIRATION_MINUTES * 60_000,
    ).toISOString();

    // Body del request a MP. La doc no detalla todos los campos del body
    // de QR Pro, así que usamos shape conservador. Si MP rechaza algún
    // field, lo ajustamos sin romper schema.
    const mpBody = {
      external_reference: intent.external_reference,
      title: body.title ?? 'Venta TrankaPos',
      description: `Cobro POS ${intent.external_reference.slice(0, 8)}`,
      total_amount: body.amount,
      items: body.items.map((it) => ({
        title: it.name ?? `Item ${it.productId.slice(0, 6)}`,
        sku_number: it.productId,
        quantity: it.qty,
        unit_price: it.price,
        unit_measure: 'unit',
        total_amount: Math.round((it.price * it.qty - (it.discount ?? 0)) * 100) / 100,
      })),
      notification_url: notificationUrl,
      expiration_date: expirationDate,
    };

    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${integ.mp_user_id}/pos/${integ.mp_pos_external_id}/qrs`;
    const qrRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integ.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mpBody),
    });

    if (!qrRes.ok) {
      const errBody = await qrRes.text().catch(() => '');
      // Marcamos el intent como rechazado para no dejarlo colgando
      await adminClient
        .from('mp_payment_intents')
        .update({ status: 'rejected' })
        .eq('id', intent.id);
      return jsonResponse(
        { error: `MP rechazó la orden: HTTP ${qrRes.status} ${errBody.slice(0, 300)}` },
        500,
      );
    }

    const qrJson = (await qrRes.json()) as {
      in_store_order_id?: string;
      qr_data?: string;
    };

    if (!qrJson.qr_data) {
      return jsonResponse(
        { error: 'MP no devolvió qr_data. Revisá la integración.' },
        500,
      );
    }

    // 4. Actualizar intent con qr_data y mp_payment_id (in_store_order_id)
    await adminClient
      .from('mp_payment_intents')
      .update({
        mp_qr_data: qrJson.qr_data,
        mp_payment_id: qrJson.in_store_order_id ?? null,
      })
      .eq('id', intent.id);

    return jsonResponse(
      {
        ok: true,
        intentId: intent.id,
        externalReference: intent.external_reference,
        qrData: qrJson.qr_data,
        expiresAt: expirationDate,
      },
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
