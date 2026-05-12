// =====================================================================
// Edge Function: mp-disconnect
// =====================================================================
// Desconecta la cuenta de MP del tenant. Borra la fila de
// tenant_payment_integrations. No revoca el token contra MP por ahora —
// la próxima vez que el comercio intente conectar genera un OAuth nuevo
// y los tokens viejos quedan inválidos en MP automáticamente.
//
// Solo el owner puede desconectar.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);

    const { data: callerMem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', userRes.user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !callerMem) {
      return jsonResponse({ error: 'No se encontró membership del caller' }, 403);
    }
    if (callerMem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede desconectar Mercado Pago' }, 403);
    }

    // Borramos con el client del user (RLS allow para owner). No usamos
    // service_role acá para que la operación quede auditable como acción
    // del owner.
    const { error: delErr } = await userClient
      .from('tenant_payment_integrations')
      .delete()
      .eq('tenant_id', callerMem.tenant_id)
      .eq('provider', 'mp');

    if (delErr) {
      return jsonResponse({ error: delErr.message }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
