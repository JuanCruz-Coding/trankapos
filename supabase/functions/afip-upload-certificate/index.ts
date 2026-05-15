// =====================================================================
// Edge Function: afip-upload-certificate
// =====================================================================
// Sprint A6 — paso final del wizard onboarding AFIP. El comercio pegó
// el CSR generado por `afip-generate-csr` en WSASS, descargó el .crt y
// lo sube acá. Validamos que el cert matchee con la key que tenemos
// guardada (mismo modulus + exponent RSA) y completamos la integración.
//
// Si el match falla, devolvemos ok:false con un error de negocio (HTTP
// 200) — son situaciones esperables (comercio subió el cert de otro
// alias, regeneró el CSR y subió el cert viejo, etc).
//
// Body esperado:
//   {
//     environment: 'homologation' | 'production',
//     certPem: string,   // contenido completo del .crt
//   }
//
// Respuesta:
//   { ok: true }                              // HTTP 200
//   { ok: false, error: string }              // HTTP 200 (errores de negocio)
//   { error: string }                         // HTTP 400/401/403/500 (otros)
//
// Secrets requeridos:
//   AFIP_VAULT_KEY — clave simétrica >= 16 chars para pgcrypto
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-types="npm:@types/node-forge@1"
import forge from 'npm:node-forge@1.3.1';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

type Environment = 'homologation' | 'production';

interface Body {
  environment: Environment;
  certPem: string;
}

function isPemCertificate(s: string): boolean {
  if (typeof s !== 'string') return false;
  return s.includes('-----BEGIN CERTIFICATE-----') && s.includes('-----END CERTIFICATE-----');
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

    // ---------- Validaciones ----------
    if (body.environment !== 'homologation' && body.environment !== 'production') {
      return jsonResponse({ error: 'environment debe ser homologation o production.' }, 400);
    }
    if (!isPemCertificate(body.certPem)) {
      return jsonResponse(
        { error: 'El certificado no parece un PEM válido. Buscá el archivo .crt que descargaste de AFIP.' },
        400,
      );
    }

    // ---------- Autenticación + autorización ----------
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

    // ---------- Clave de cifrado ----------
    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      console.error('AFIP_VAULT_KEY no configurada o muy corta');
      return jsonResponse({ error: 'Servidor sin configuración AFIP. Contactá soporte.' }, 500);
    }

    // ---------- Recuperar key del CSR previo ----------
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: credRows, error: getErr } = await adminClient.rpc('afip_get_credentials', {
      p_tenant_id: tenantId,
      p_encryption_key: encryptionKey,
    });
    if (getErr) {
      console.error('Error leyendo credenciales AFIP:', getErr);
      return jsonResponse({ error: `Error leyendo credenciales: ${getErr.message}` }, 500);
    }
    // afip_get_credentials retorna table → array. Tomamos primer row.
    const cred = Array.isArray(credRows) && credRows.length > 0 ? credRows[0] : null;
    const keyPem: string | null = cred?.key_pem ?? null;
    if (!cred || !keyPem || keyPem.trim().length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: 'No hay un CSR generado todavía. Primero generá el par de claves desde el wizard.',
        },
        200,
      );
    }

    // ---------- Validar match cert ↔ key ----------
    try {
      const cert = forge.pki.certificateFromPem(body.certPem);
      const privateKey = forge.pki.privateKeyFromPem(keyPem);
      // El cert.publicKey es RSA; comparamos modulus (n) y exponent (e).
      // forge usa BigInteger con compareTo: 0 = iguales.
      // deno-lint-ignore no-explicit-any
      const certPub = cert.publicKey as any;
      // deno-lint-ignore no-explicit-any
      const priv = privateKey as any;
      if (!certPub?.n || !priv?.n || !certPub?.e || !priv?.e) {
        return jsonResponse(
          {
            ok: false,
            error: 'No se pudo validar la correspondencia entre el certificado y la clave. Asegurate de subir el .crt descargado de WSASS.',
          },
          200,
        );
      }
      if (certPub.n.compareTo(priv.n) !== 0 || certPub.e.compareTo(priv.e) !== 0) {
        return jsonResponse(
          {
            ok: false,
            error: 'El certificado no corresponde a la clave generada por este sistema. Verificá que estés subiendo el .crt firmado a partir del CSR que generaste en TrankaPos.',
          },
          200,
        );
      }
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: `No se pudo procesar el certificado: ${(err as Error).message}`,
        },
        200,
      );
    }

    // ---------- Completar con cert via RPC ----------
    const { error: rpcErr } = await adminClient.rpc('afip_complete_with_cert', {
      p_tenant_id: tenantId,
      p_environment: body.environment,
      p_cert_pem: body.certPem,
      p_encryption_key: encryptionKey,
    });
    if (rpcErr) {
      console.error('Error completando integración AFIP:', rpcErr);
      // Errores de negocio (raise exception de la RPC) → ok:false 200.
      return jsonResponse({ ok: false, error: rpcErr.message }, 200);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
