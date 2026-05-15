// =====================================================================
// Edge Function: afip-consult-padron
// =====================================================================
// Consulta el padrón AFIP (ws_sr_padron_a5) por CUIT y devuelve los
// datos del contribuyente mapeados al formato que usa el frontend para
// autocompletar el formulario de Customer (legalName, ivaCondition,
// address).
//
// Body:
//   { cuit: string }  // 11 dígitos sin guiones
//
// Respuesta (HTTP 200 siempre que la function corra OK, los errores de
// negocio van en ok:false con mensajes claros):
//   { ok: true,  persona: { cuit, legalName, ivaCondition, address } }
//   { ok: false, error: string }
//
// Errores HTTP 400/401/403/500 solo para validación / auth / config.
//
// Auth: cualquier miembro activo del tenant puede consultar el padrón
// (NO requiere role=owner). Mismo patrón que afip-emit-voucher para
// memberships + AFIP_VAULT_KEY + afip_get_credentials.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getTicketAccess } from '../_shared/afip-wsaa.ts';
import { getPersona } from '../_shared/afip-padron.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface Body {
  cuit: string;
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
    // 1) Body + validación de CUIT
    const body = (await req.json()) as Body;
    const cuit = (body.cuit ?? '').trim();
    if (!/^[0-9]{11}$/.test(cuit)) {
      return jsonResponse(
        { error: 'CUIT inválido: debe ser de 11 dígitos sin guiones.' },
        400,
      );
    }

    // 2) Auth del caller
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

    // 3) Membership activa (cualquier rol — consultar padrón no es operación owner-only)
    const { data: mem } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (!mem) return jsonResponse({ error: 'No autorizado' }, 403);
    const tenantId = mem.tenant_id;

    // 4) AFIP_VAULT_KEY
    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      return jsonResponse({ error: 'Servidor sin AFIP_VAULT_KEY' }, 500);
    }

    // 5) Admin client + credenciales AFIP del tenant
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: creds, error: credsErr } = await admin.rpc('afip_get_credentials', {
      p_tenant_id: tenantId,
      p_encryption_key: encryptionKey,
    });
    if (credsErr) {
      return jsonResponse(
        {
          ok: false,
          error: 'No se pudieron leer las credenciales AFIP: ' + credsErr.message,
        },
        200,
      );
    }
    // afip_get_credentials puede devolver un row o un array, lo normalizamos.
    const row = Array.isArray(creds) ? creds[0] : creds;
    if (!row || row.is_active === false) {
      return jsonResponse(
        {
          ok: false,
          error:
            'AFIP no está configurado o está pausado en este comercio. Configuralo en Settings → Facturación.',
        },
        200,
      );
    }
    const issuerCuit: string = row.cuit;
    const certPem: string = row.cert_pem;
    const keyPem: string = row.key_pem;
    const env: 'homologation' | 'production' = row.environment;

    // 6) Obtener TA para ws_sr_padron_a5
    let ta;
    try {
      ta = await getTicketAccess({
        admin,
        tenantId,
        service: 'ws_sr_padron_a5',
        env,
        certPem,
        keyPem,
      });
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error:
            'No se pudo obtener autorización de AFIP para consultar el padrón: ' +
            (err as Error).message,
        },
        200,
      );
    }

    // 7) Consultar padrón
    const result = await getPersona(
      { ta, cuitRepresentada: issuerCuit, env },
      cuit,
    );

    if (result.ok) {
      return jsonResponse({ ok: true, persona: result.persona }, 200);
    }

    // 8) Mapear errores de negocio a mensajes claros para el frontend
    switch (result.error.kind) {
      case 'not_found':
        return jsonResponse(
          {
            ok: false,
            error: 'No se encontró el CUIT en el padrón AFIP. Verificá que sea correcto.',
          },
          200,
        );
      case 'not_authorized':
        return jsonResponse(
          {
            ok: false,
            error:
              'Tu certificado AFIP no está autorizado para consultar el padrón. Entrá a WSASS, "Crear autorización a servicio", seleccioná tu alias y autorizá el servicio ws_sr_padron_a5.',
          },
          200,
        );
      case 'afip_error':
        return jsonResponse(
          { ok: false, error: 'AFIP devolvió un error: ' + result.error.message },
          200,
        );
      case 'parse_error':
        return jsonResponse(
          {
            ok: false,
            error: 'No se pudo procesar la respuesta del padrón: ' + result.error.message,
          },
          200,
        );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin':
            ALLOWED_ORIGINS.includes(req.headers.get('origin') ?? '')
              ? (req.headers.get('origin') as string)
              : 'https://pos.trankasoft.com',
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
