// =====================================================================
// Edge Function: afip-test-connection
// =====================================================================
// Verifica que el certificado del comercio funciona contra AFIP haciendo
// un login real al WSAA. No emite ningún comprobante — solo prueba que
// el TRA firmado es aceptado.
//
// Actualiza tenant_afip_credentials.{last_test_at, last_test_ok, last_test_error}
// para que el frontend muestre estado en /settings.
//
// Body: ninguno (la función toma el tenant del caller).
//
// Secrets requeridos:
//   AFIP_VAULT_KEY — para descifrar las credenciales
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getTicketAccess, type AfipEnv } from '../_shared/afip-wsaa.ts';

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
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);
    const callerId = userRes.user.id;

    const { data: mem } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (!mem) return jsonResponse({ error: 'No autorizado' }, 403);
    if (mem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede probar AFIP' }, 403);
    }
    const tenantId = mem.tenant_id;

    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      console.error('AFIP_VAULT_KEY no configurada');
      return jsonResponse({ error: 'Servidor sin configuración AFIP. Contactá soporte.' }, 500);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Cargar credenciales descifradas
    const { data: credsRows, error: credsErr } = await admin.rpc('afip_get_credentials', {
      p_tenant_id: tenantId,
      p_encryption_key: encryptionKey,
    });
    if (credsErr) {
      return jsonResponse({ error: `Error leyendo credenciales: ${credsErr.message}` }, 500);
    }
    const creds = Array.isArray(credsRows) ? credsRows[0] : credsRows;
    if (!creds) {
      return jsonResponse(
        { error: 'No hay credenciales AFIP cargadas. Subí el .crt y .key primero.' },
        400,
      );
    }
    if (!creds.is_active) {
      return jsonResponse({ error: 'La integración AFIP está pausada.' }, 400);
    }

    // Intentar login WSAA contra el servicio 'wsfe' (factura electrónica).
    const env = creds.environment as AfipEnv;
    let testOk = false;
    let testError: string | null = null;
    let ta: { token: string; sign: string; expirationTime: string } | null = null;
    try {
      ta = await getTicketAccess({
        admin,
        tenantId,
        service: 'wsfe',
        env,
        certPem: creds.cert_pem,
        keyPem: creds.key_pem,
      });
      testOk = true;
    } catch (err) {
      testError = (err as Error).message.slice(0, 500);
    }

    // Actualizar timestamp del test
    await admin
      .from('tenant_afip_credentials')
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: testOk,
        last_test_error: testError,
      })
      .eq('tenant_id', tenantId);

    if (testOk && ta) {
      return jsonResponse(
        {
          ok: true,
          environment: env,
          cuit: creds.cuit,
          salesPoint: creds.sales_point,
          tokenExpiresAt: ta.expirationTime,
        },
        200,
      );
    }

    return jsonResponse(
      {
        ok: false,
        environment: env,
        error: testError ?? 'Error desconocido al probar AFIP',
      },
      200, // 200 con ok:false — no es error HTTP, es info de diagnóstico
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
