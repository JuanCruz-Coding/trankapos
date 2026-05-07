// =====================================================================
// Edge Function: create-subscription
// =====================================================================
// El owner de un tenant llama a esta función con { planCode, backUrl }.
// La función:
//   1. Valida que el caller sea owner.
//   2. Lee el precio del plan desde Supabase.
//   3. Crea un preapproval en Mercado Pago (cobro recurrente mensual).
//   4. Guarda el id del preapproval en subscriptions.mp_subscription_id.
//   5. Devuelve init_point — el URL donde el frontend debe redirigir
//      al user para que autorice el pago.
//
// Cuando el user autoriza en MP, MP nos avisa via webhook (otra Edge
// Function que viene después) y ahí actualizamos status = 'active'.
//
// Variables de entorno:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto)
//   MP_ACCESS_TOKEN (lo seteaste con `supabase secrets set MP_ACCESS_TOKEN=...`)
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  planCode: 'basic' | 'pro' | 'business';
  backUrl: string;     // a dónde MP redirige al user después de autorizar
  payerEmail: string;  // email de la cuenta MP del que va a pagar
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { planCode, backUrl, payerEmail } = (await req.json()) as Body;
    if (!planCode || !backUrl || !payerEmail) {
      return jsonResponse({ error: 'Faltan planCode, backUrl o payerEmail' }, 400);
    }
    if (!['basic', 'pro', 'business'].includes(planCode)) {
      return jsonResponse({ error: 'planCode inválido' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // 1. Auth
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);

    // 2. Caller debe ser owner
    const { data: mem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', userRes.user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !mem) return jsonResponse({ error: 'No se encontró membership' }, 403);
    if (mem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede cambiar el plan' }, 403);
    }

    // 3. Plan + email del payer
    const { data: plan, error: planErr } = await userClient
      .from('plans')
      .select('id, code, name, price_monthly')
      .eq('code', planCode)
      .single();
    if (planErr || !plan) return jsonResponse({ error: 'Plan no encontrado' }, 404);
    if (Number(plan.price_monthly) <= 0) {
      return jsonResponse({ error: 'Este plan no tiene cobro' }, 400);
    }

    // 4. Preapproval en MP
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!mpToken) return jsonResponse({ error: 'MP_ACCESS_TOKEN no configurado' }, 500);

    // payer_email: el email de la cuenta MP del cliente. En sandbox debe ser
    // el email del TESTUSER comprador. En prod real es el email MP del kiosco.
    const preapprovalBody = {
      reason: `TrankaPos · Plan ${plan.name}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number(plan.price_monthly),
        currency_id: 'ARS',
      },
      payer_email: payerEmail,
      back_url: backUrl,
      external_reference: mem.tenant_id, // así correlacionamos en el webhook
      status: 'pending',
    };

    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preapprovalBody),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      return jsonResponse(
        {
          error: `Error de Mercado Pago: ${mpData.message ?? mpRes.status}`,
          mpDetail: mpData,
        },
        500,
      );
    }

    // 5. Guardar el preapproval id como pendiente. NO tocamos plan_id —
    //    eso lo hace el webhook cuando MP confirma con status=authorized.
    //    Si solo cambiamos plan_id acá, el cliente queda con el plan nuevo
    //    aunque nunca confirme el pago (acceso sin pagar = bug grave).
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await adminClient
      .from('subscriptions')
      .update({
        mp_subscription_id: mpData.id,
        pending_plan_id: plan.id,
      })
      .eq('tenant_id', mem.tenant_id);

    return jsonResponse(
      {
        initPoint: mpData.init_point,
        preapprovalId: mpData.id,
      },
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
