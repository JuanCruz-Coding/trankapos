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
      .select('name, email, welcome_email_sent_at')
      .eq('id', userRes.user.id)
      .single();
    if (!prof) return jsonResponse({ error: 'Profile no encontrado' }, 404);

    // Rate limit: si ya le mandamos el welcome, no reenviar (evita doble email
    // por refresh, retry de network o doble invoke desde el frontend).
    if (prof.welcome_email_sent_at) {
      return jsonResponse({ ok: true, alreadySent: true }, 200);
    }

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

    // Marcar el envío con service_role para evitar que RLS lo bloquee si
    // el usuario aún no tiene membership activa al momento del welcome.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await adminClient
      .from('profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', userRes.user.id);

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
