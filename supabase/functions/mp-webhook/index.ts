// =====================================================================
// Edge Function: mp-webhook
// =====================================================================
// Endpoint público al que MP postea cuando hay eventos de suscripciones.
//
// Configurado en MP Dashboard → tu app → Webhooks:
//   URL (test y prod): https://khopeeibdkjlbvisxkzo.supabase.co/functions/v1/mp-webhook
//   Eventos: subscription_preapproval, subscription_authorized_payment
//
// Variables de entorno requeridas:
//   MP_ACCESS_TOKEN        — para hacer GET al detalle del evento
//   MP_WEBHOOK_SECRET      — para validar firma HMAC (anti-spoofing)
//
// Por qué responde 200 ante errores internos:
//   MP reintenta agresivamente si no recibe 2xx. Si nuestro código tira
//   error y devolvemos 5xx, MP reintenta en loop. Mejor loggear y devolver
//   200 para errores internos. EXCEPCIÓN: firma inválida → 401, así MP no
//   reintenta y queda registrado el rechazo.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';
import {
  pastDueEmail,
  subscriptionActivatedEmail,
} from '../_shared/email-templates.ts';

// Helper: dado un tenantId, obtiene email + name + nombre del plan del owner.
async function getOwnerInfo(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  tenantId: string,
): Promise<{ email: string; name: string; planName: string; planAmount: number } | null> {
  const { data: mem } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (!mem) return null;

  const { data: prof } = await adminClient
    .from('profiles')
    .select('email, name')
    .eq('id', mem.user_id)
    .maybeSingle();
  if (!prof) return null;

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('plans:plan_id ( name, price_monthly )')
    .eq('tenant_id', tenantId)
    .single();
  // plans puede venir como objeto o array dependiendo del schema cache de PostgREST
  const planRow = Array.isArray(sub?.plans) ? sub.plans[0] : sub?.plans;
  const planName = planRow?.name ?? 'Pro';
  const planAmount = Number(planRow?.price_monthly ?? 0);

  return { email: prof.email, name: prof.name, planName, planAmount };
}

interface MpWebhookPayload {
  type?: string;
  action?: string;
  data?: { id?: string };
}

// ============================================================
// Validación de firma HMAC
// ============================================================
// MP firma cada request con HMAC-SHA256. El header `x-signature` viene como:
//   ts=1234567890,v1=abc123hexhash
// Y el manifest a firmar es:
//   id:DATA_ID;request-id:REQUEST_ID;ts:TIMESTAMP;
// Validamos con timing-safe compare para evitar timing attacks.

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

async function verifySignature(req: Request, dataId: string): Promise<boolean> {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secret) {
    // Fail-closed: sin secret configurado, rechazamos. No hay bypass de dev:
    // para probar en local, setear MP_WEBHOOK_SECRET en el .env de Supabase.
    console.error('MP_WEBHOOK_SECRET no configurado — rechazando webhook');
    return false;
  }

  const sigHeader = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';

  const parts = sigHeader.split(',').map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('ts='))?.slice(3);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);

  if (!ts || !v1) {
    console.error('Header x-signature mal formado:', sigHeader);
    return false;
  }

  // Anti-replay: rechazamos webhooks de más de 5 minutos.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    console.error('Webhook con timestamp fuera de rango:', ts);
    return false;
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = await hmacSha256Hex(secret, manifest);

  return timingSafeEqual(expected, v1);
}

// ============================================================
// Mapeos
// ============================================================

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

// ============================================================
// Handler principal
// ============================================================

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('ok', { status: 200 });

  let payload: MpWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Body inválido', { status: 200 });
  }

  const type = payload.type ?? payload.action ?? '';
  const dataId = payload.data?.id;

  if (!dataId) {
    return new Response(JSON.stringify({ ignored: 'sin data.id' }), { status: 200 });
  }

  // VALIDAR FIRMA HMAC. Si falla, 401 — esto NO viene de MP.
  const valid = await verifySignature(req, dataId);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Firma inválida' }), { status: 401 });
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

  // IDEMPOTENCIA: registramos el request_id antes de procesar. Si ya existe
  // (porque MP reenvió el mismo evento), retornamos 200 sin tocar nada.
  // Sin esto, cada reenvío de authorized_payment extiende current_period_end
  // 1 mes — regalo silencioso de meses pagos.
  const requestId = req.headers.get('x-request-id') ?? '';
  if (requestId) {
    const { error: dupErr } = await adminClient
      .from('processed_webhook_events')
      .insert({
        request_id: requestId,
        event_type: type,
        data_id: dataId,
      });

    if (dupErr) {
      // 23505 = unique_violation → ya procesado, idempotent return.
      if (dupErr.code === '23505') {
        return new Response(
          JSON.stringify({ ok: true, ignored: 'duplicate', request_id: requestId }),
          { status: 200 },
        );
      }
      // Otro error en la tabla (ej. tabla no existe): loggeamos y seguimos
      // sin bloquear el procesamiento. La idempotencia degrada graceful.
      console.error('Error registrando processed_webhook_events:', dupErr);
    }
  } else {
    console.warn('Webhook sin x-request-id — sin protección de idempotencia');
  }

  try {
    if (type.includes('preapproval') && !type.includes('authorized_payment')) {
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      });
      if (!mpRes.ok) {
        console.error('Error fetch preapproval:', await mpRes.text());
        return new Response('ok', { status: 200 });
      }
      const pre = await mpRes.json();

      const tenantId: string | undefined = pre.external_reference;
      if (!tenantId) {
        console.error('preapproval sin external_reference:', pre.id);
        return new Response('ok', { status: 200 });
      }

      const newStatus = mapPreapprovalStatus(pre.status);
      const now = new Date().toISOString();
      const isAuthorized = pre.status === 'authorized';

      // Si MP confirmó (authorized), recién ahora promovemos pending_plan_id
      // a plan_id. Para eso necesitamos leer el sub primero.
      const { data: subRow } = await adminClient
        .from('subscriptions')
        .select('pending_plan_id, plan_id')
        .eq('tenant_id', tenantId)
        .single();

      const update: Record<string, unknown> = {
        status: newStatus,
        mp_subscription_id: pre.id,
        current_period_start: isAuthorized ? now : null,
        current_period_end: isAuthorized ? addMonths(now, 1) : null,
      };
      if (isAuthorized && subRow?.pending_plan_id) {
        update.plan_id = subRow.pending_plan_id;
        update.pending_plan_id = null;
      }
      // Si la suscripción se canceló, también limpiamos pending para no dejar
      // ruido si después hay un nuevo intento.
      if (pre.status === 'cancelled') {
        update.pending_plan_id = null;
      }

      await adminClient.from('subscriptions').update(update).eq('tenant_id', tenantId);

      // Notificar por email cuando hay cambios de estado importantes
      if (isAuthorized) {
        const info = await getOwnerInfo(adminClient, tenantId);
        if (info) {
          const tpl = subscriptionActivatedEmail(info.name, info.planName, info.planAmount);
          await sendEmail({ to: info.email, ...tpl });
        }
      }
      if (pre.status === 'paused') {
        const info = await getOwnerInfo(adminClient, tenantId);
        if (info) {
          const tpl = pastDueEmail(info.name, info.planName, info.planAmount);
          await sendEmail({ to: info.email, ...tpl });
        }
      }

      return new Response(JSON.stringify({ ok: true, status: newStatus }), { status: 200 });
    }

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

      const isApproved = payment.status === 'approved' || payment.status === 'authorized';
      const now = new Date().toISOString();

      const update: Record<string, unknown> = isApproved
        ? {
            status: 'active',
            current_period_start: now,
            current_period_end: addMonths(now, 1),
          }
        : { status: 'past_due' };

      await adminClient
        .from('subscriptions')
        .update(update)
        .eq('mp_subscription_id', preapprovalId);

      // Si el cobro recurrente falló, notificamos al owner
      if (!isApproved) {
        const { data: subRow } = await adminClient
          .from('subscriptions')
          .select('tenant_id')
          .eq('mp_subscription_id', preapprovalId)
          .single();
        if (subRow?.tenant_id) {
          const info = await getOwnerInfo(adminClient, subRow.tenant_id);
          if (info) {
            const tpl = pastDueEmail(info.name, info.planName, info.planAmount);
            await sendEmail({ to: info.email, ...tpl });
          }
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });
  } catch (err) {
    console.error('Error procesando webhook:', err);
    return new Response('ok', { status: 200 });
  }
});
