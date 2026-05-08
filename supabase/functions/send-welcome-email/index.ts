// =====================================================================
// Edge Function: send-welcome-email
// =====================================================================
// El frontend la invoca tras un signup exitoso. Lee el profile + tenant
// del caller y le manda email de bienvenida.
//
// Por qué es Edge Function y no se llama Resend directo desde frontend:
//   La RESEND_API_KEY no puede estar en el bundle del cliente.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';
import { welcomeEmail } from '../_shared/email-templates.ts';

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

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);

    const { data: prof } = await userClient
      .from('profiles')
      .select('name, email')
      .eq('id', userRes.user.id)
      .single();
    if (!prof) return jsonResponse({ error: 'Profile no encontrado' }, 404);

    const { data: mem } = await userClient
      .from('memberships')
      .select('tenant_id')
      .eq('user_id', userRes.user.id)
      .eq('active', true)
      .limit(1)
      .single();
    if (!mem) return jsonResponse({ error: 'Membership no encontrada' }, 404);

    const { data: tenant } = await userClient
      .from('tenants')
      .select('name')
      .eq('id', mem.tenant_id)
      .single();
    if (!tenant) return jsonResponse({ error: 'Tenant no encontrado' }, 404);

    const tpl = welcomeEmail(prof.name, tenant.name);
    await sendEmail({ to: prof.email, ...tpl });

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
