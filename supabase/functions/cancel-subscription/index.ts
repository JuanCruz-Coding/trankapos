// =====================================================================
// Edge Function: cancel-subscription
// =====================================================================
// El owner cancela la suscripción del tenant. Hace:
//   1. Verifica caller es owner
//   2. Lee mp_subscription_id de subscriptions
//   3. PUT /preapproval/{id} con status=cancelled en MP
//   4. Update subscriptions.status = 'canceled' (sincrónico para UX —
//      el webhook lo va a confirmar después igual)
//
// Variables de entorno:
//   MP_ACCESS_TOKEN, SUPABASE_*
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // 1. Auth + verificar owner
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);

    const { data: mem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', userRes.user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !mem) return jsonResponse({ error: 'No se encontró membership' }, 403);
    if (mem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede cancelar' }, 403);
    }

    // 2. Leer mp_subscription_id
    const { data: sub, error: subErr } = await userClient
      .from('subscriptions')
      .select('mp_subscription_id, status')
      .eq('tenant_id', mem.tenant_id)
      .single();
    if (subErr || !sub) return jsonResponse({ error: 'Suscripción no encontrada' }, 404);
    if (!sub.mp_subscription_id) {
      return jsonResponse({ error: 'No hay suscripción activa para cancelar' }, 400);
    }
    if (sub.status === 'canceled') {
      return jsonResponse({ ok: true, alreadyCanceled: true }, 200);
    }

    // 3. Cancelar en MP
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!mpToken) return jsonResponse({ error: 'MP_ACCESS_TOKEN no configurado' }, 500);

    const mpRes = await fetch(
      `https://api.mercadopago.com/preapproval/${sub.mp_subscription_id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${mpToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      },
    );

    if (!mpRes.ok) {
      const detail = await mpRes.text();
      console.error('Error cancelando en MP:', detail);
      return jsonResponse(
        { error: `Error al cancelar en Mercado Pago: ${mpRes.status}` },
        500,
      );
    }

    // 4. Update local — marcamos como canceled. El webhook lo va a confirmar
    //    después con el status real, pero queremos UX inmediata.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await adminClient
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('tenant_id', mem.tenant_id);

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
