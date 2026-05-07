// =====================================================================
// Edge Function: mp-webhook
// =====================================================================
// Endpoint público que MP llama cuando hay eventos en suscripciones.
// Configurar el URL en MP Dashboard → Tu app → Webhooks:
//   https://khopeeibdkjlbvisxkzo.supabase.co/functions/v1/mp-webhook
// Tipos a tildar:
//   - Suscripción (subscription_preapproval)
//   - Pago de suscripción (subscription_authorized_payment)
//
// Por qué responde 200 siempre (incluso ante errores):
//   MP reintenta agresivamente si no recibe 2xx. Si nuestro código falla,
//   queremos loggear pero NO reintentar (para no entrar en loops). Por eso
//   los catch devuelven 200 con un body informativo.
//
// TODO producción: validar firma HMAC del header `x-signature` con un
// secret que MP te da en la config del webhook. Por ahora omitido — en
// sandbox no es crítico, en prod es CLAVE para evitar webhooks falsos.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface MpWebhookPayload {
  type?: string;
  action?: string;
  data?: { id?: string };
}

// Mapeo: status de MP → status interno de subscriptions
function mapPreapprovalStatus(mpStatus: string): string {
  switch (mpStatus) {
    case 'authorized': return 'active';
    case 'paused':     return 'past_due';
    case 'cancelled':  return 'canceled';
    case 'pending':    return 'trialing';
    default:           return 'active';
  }
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

Deno.serve(async (req) => {
  // MP solo manda POSTs, pero contestamos OK al GET por si lo prueba el dashboard
  if (req.method === 'GET') return new Response('ok', { status: 200 });

  let payload: MpWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 200 });
  }

  // MP a veces manda type, a veces action. Normalizamos.
  const type = payload.type ?? payload.action ?? '';
  const dataId = payload.data?.id;

  if (!dataId) {
    return new Response(JSON.stringify({ ok: true, ignored: 'sin data.id' }), { status: 200 });
  }

  const mpToken = Deno.env.get('MP_ACCESS_TOKEN');
  if (!mpToken) {
    console.error('MP_ACCESS_TOKEN no configurado');
    return new Response('ok', { status: 200 });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // ============================================================
    // EVENTO: cambio de estado de la suscripción
    // ============================================================
    if (type.includes('preapproval') && !type.includes('authorized_payment')) {
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      });
      if (!mpRes.ok) {
        console.error('Error fetch preapproval:', await mpRes.text());
        return new Response('ok', { status: 200 });
      }
      const pre = await mpRes.json();

      // external_reference es el tenant_id que mandamos en create-subscription
      const tenantId: string | undefined = pre.external_reference;
      if (!tenantId) {
        console.error('preapproval sin external_reference:', pre.id);
        return new Response('ok', { status: 200 });
      }

      const newStatus = mapPreapprovalStatus(pre.status);
      const now = new Date().toISOString();

      await adminClient
        .from('subscriptions')
        .update({
          status: newStatus,
          mp_subscription_id: pre.id,
          current_period_start: pre.status === 'authorized' ? now : null,
          current_period_end: pre.status === 'authorized' ? addMonths(now, 1) : null,
        })
        .eq('tenant_id', tenantId);

      console.log(`Subscription ${tenantId} → ${newStatus} (preapproval ${pre.id})`);
      return new Response(JSON.stringify({ ok: true, status: newStatus }), { status: 200 });
    }

    // ============================================================
    // EVENTO: cobro mensual recurrente
    // ============================================================
    if (type.includes('authorized_payment')) {
      const mpRes = await fetch(
        `https://api.mercadopago.com/authorized_payments/${dataId}`,
        { headers: { Authorization: `Bearer ${mpToken}` } },
      );
      if (!mpRes.ok) {
        console.error('Error fetch authorized_payment:', await mpRes.text());
        return new Response('ok', { status: 200 });
      }
      const payment = await mpRes.json();

      const preapprovalId: string | undefined = payment.preapproval_id;
      if (!preapprovalId) return new Response('ok', { status: 200 });

      // Pago aprobado → renovamos período. Rechazado → past_due.
      const isApproved = payment.status === 'approved' || payment.status === 'authorized';
      const now = new Date().toISOString();

      const update: Record<string, unknown> = isApproved
        ? {
            status: 'active',
            current_period_start: now,
            current_period_end: addMonths(now, 1),
          }
        : {
            status: 'past_due',
          };

      await adminClient
        .from('subscriptions')
        .update(update)
        .eq('mp_subscription_id', preapprovalId);

      console.log(
        `Payment ${dataId} → ${payment.status} → subscription ${isApproved ? 'active' : 'past_due'}`,
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Tipos no manejados (payment one-shot, merchant_order, etc.) — ignorar.
    return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });
  } catch (err) {
    console.error('Error procesando webhook:', err);
    return new Response('ok', { status: 200 });
  }
});
