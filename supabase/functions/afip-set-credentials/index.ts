// =====================================================================
// Edge Function: afip-set-credentials
// =====================================================================
// Recibe del frontend las credenciales AFIP del comercio (cert/key PEM
// generados en el portal AFIP) y las guarda encriptadas con pgcrypto
// vía RPC afip_set_credentials. Solo el owner puede setearlas.
//
// Body esperado:
//   {
//     cuit: string,             // 11 dígitos sin guiones
//     salesPoint: number,       // punto de venta AFIP
//     environment: 'homologation' | 'production',
//     certPem: string,          // contenido completo del .crt
//     keyPem: string,           // contenido completo del .key
//   }
//
// Secrets requeridos:
//   AFIP_VAULT_KEY — clave simétrica >= 16 chars para pgp_sym_encrypt
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

type Environment = 'homologation' | 'production';

interface Body {
  cuit: string;
  salesPoint: number;
  environment: Environment;
  certPem: string;
  keyPem: string;
}

function isPem(s: string, marker: 'CERTIFICATE' | 'PRIVATE KEY' | 'RSA PRIVATE KEY'): boolean {
  if (typeof s !== 'string') return false;
  // Aceptamos cualquier label que contenga el marker (RSA PRIVATE KEY, PRIVATE KEY, ENCRYPTED PRIVATE KEY)
  return s.includes(`-----BEGIN ${marker}`) && s.includes(`-----END ${marker}`);
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    // Validaciones básicas
    if (!body.cuit || !/^[0-9]{11}$/.test(body.cuit)) {
      return jsonResponse({ error: 'CUIT inválido. Deben ser 11 dígitos sin guiones.' }, 400);
    }
    if (!Number.isInteger(body.salesPoint) || body.salesPoint <= 0) {
      return jsonResponse({ error: 'Punto de venta inválido (entero > 0).' }, 400);
    }
    if (body.environment !== 'homologation' && body.environment !== 'production') {
      return jsonResponse({ error: 'environment debe ser homologation o production.' }, 400);
    }
    // El certificado puede venir con header CERTIFICATE estándar
    if (!isPem(body.certPem, 'CERTIFICATE')) {
      return jsonResponse(
        { error: 'El certificado no parece un PEM válido. Buscá el archivo .crt que descargaste de AFIP.' },
        400,
      );
    }
    // La clave puede venir como PRIVATE KEY (PKCS#8) o RSA PRIVATE KEY (PKCS#1).
    const keyIsPkcs8 = isPem(body.keyPem, 'PRIVATE KEY');
    const keyIsPkcs1 = isPem(body.keyPem, 'RSA PRIVATE KEY');
    if (!keyIsPkcs8 && !keyIsPkcs1) {
      return jsonResponse(
        { error: 'La clave privada no parece un PEM válido. Debe arrancar con -----BEGIN PRIVATE KEY o RSA PRIVATE KEY-----.' },
        400,
      );
    }

    // Autenticación + autorización
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
    if (mem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede configurar AFIP' }, 403);
    }
    const tenantId = mem.tenant_id;

    // Encryption key del env (Supabase secret)
    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      console.error('AFIP_VAULT_KEY no configurada o muy corta');
      return jsonResponse({ error: 'Servidor sin configuración AFIP. Contactá soporte.' }, 500);
    }

    // Guardar via RPC (service_role, no respeta RLS).
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error: rpcErr } = await adminClient.rpc('afip_set_credentials', {
      p_tenant_id: tenantId,
      p_cuit: body.cuit,
      p_sales_point: body.salesPoint,
      p_environment: body.environment,
      p_cert_pem: body.certPem,
      p_key_pem: body.keyPem,
      p_encryption_key: encryptionKey,
    });
    if (rpcErr) {
      console.error('Error guardando credenciales AFIP:', rpcErr);
      return jsonResponse({ error: `Error guardando credenciales: ${rpcErr.message}` }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
