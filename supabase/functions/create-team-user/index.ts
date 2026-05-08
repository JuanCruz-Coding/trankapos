// =====================================================================
// Edge Function: create-team-user
// =====================================================================
// Crea un nuevo usuario (manager o cashier) dentro del tenant del caller.
// La invoca el frontend con:
//   supabase.functions.invoke('create-team-user', {
//     body: { email, password, name, role, depotId, active }
//   });
//
// Por qué esto vive en una Edge Function y no en el frontend:
//   Crear filas en `auth.users` requiere SUPABASE_SERVICE_ROLE_KEY, que
//   tiene permisos absolutos sobre la base. Esa key NUNCA debe estar en el
//   bundle del cliente. Acá vive solo en Deno (servidor de Supabase).
//
// Variables de entorno (las inyecta Supabase automáticamente, no las setees vos):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  email: string;
  password: string;
  name: string;
  role: 'owner' | 'manager' | 'cashier';
  depotId: string | null;
  active?: boolean;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, name, role, depotId, active = true } =
      (await req.json()) as Body;

    if (!email || !password || !name || !role) {
      return jsonResponse(
        { error: 'Faltan campos requeridos (email, password, name, role)' },
        400,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization header' }, 401);

    // Cliente "como el caller": respeta RLS y se identifica con el JWT del user
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // 1. ¿Quién está llamando?
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);
    const callerId = userRes.user.id;

    // 2. ¿Es owner del tenant?
    const { data: callerMem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !callerMem) {
      return jsonResponse({ error: 'No se encontró membership del caller' }, 403);
    }
    if (callerMem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede crear usuarios' }, 403);
    }
    const tenantId = callerMem.tenant_id;

    // 3. Límite del plan
    const { count: usersCount, error: countErr } = await userClient
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);
    if (countErr) return jsonResponse({ error: countErr.message }, 500);

    const { data: subRow, error: subErr } = await userClient
      .from('subscriptions')
      .select('plans(max_users, name)')
      .single();
    if (subErr) return jsonResponse({ error: subErr.message }, 500);

    const plan = (subRow as { plans: { max_users: number | null; name: string } }).plans;
    const maxUsers = plan?.max_users;

    if (maxUsers !== null && maxUsers !== undefined && (usersCount ?? 0) >= maxUsers) {
      return jsonResponse(
        {
          error: `Llegaste al límite de usuarios del plan ${plan.name} (${maxUsers}). Actualizá tu plan para agregar más.`,
        },
        403,
      );
    }

    // 4. Cliente admin (service_role) para crear el auth user
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // sin paso de confirmación de mail para usuarios invitados
      });
    if (createErr) return jsonResponse({ error: createErr.message }, 400);
    const newUserId = created.user!.id;

    // 5. Profile (con rollback manual si falla)
    const { error: profErr } = await adminClient.from('profiles').insert({
      id: newUserId,
      name,
      email,
    });
    if (profErr) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: `Error creando profile: ${profErr.message}` }, 500);
    }

    // 6. Membership en el tenant del caller
    const { error: memInsErr } = await adminClient.from('memberships').insert({
      user_id: newUserId,
      tenant_id: tenantId,
      role,
      depot_id: depotId,
      active,
    });
    if (memInsErr) {
      await adminClient.from('profiles').delete().eq('id', newUserId);
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: `Error creando membership: ${memInsErr.message}` }, 500);
    }

    return jsonResponse(
      {
        user: { id: newUserId, email, name, role, depotId, active },
      },
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
