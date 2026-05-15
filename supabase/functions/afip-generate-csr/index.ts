// =====================================================================
// Edge Function: afip-generate-csr
// =====================================================================
// Sprint A6 — onboarding AFIP via wizard. El backend genera el par RSA
// + CSR con node-forge, guarda la key PRIVADA cifrada con pgcrypto y
// devuelve el CSR en texto plano al frontend para que el comercio lo
// pegue en WSASS. Después, `afip-upload-certificate` cierra el flujo
// recibiendo el .crt firmado por AFIP.
//
// Ventaja vs BYO: el comercio no usa OpenSSL local — UX mucho mejor.
//
// Body esperado:
//   {
//     cuit: string,          // 11 dígitos sin guiones
//     legalName: string,     // razón social, 1-200 chars
//     alias: string,         // CN del CSR, [a-zA-Z0-9_-]{3,50}
//     salesPoint: number,    // punto de venta AFIP (> 0)
//     environment: 'homologation' | 'production',
//   }
//
// Respuesta:
//   { ok: true, csrPem: string, alias: string, environment: '...' }
//   o HTTP 400 { error: string } en validaciones / 401/403/500.
//
// Secrets requeridos:
//   AFIP_VAULT_KEY — clave simétrica >= 16 chars para pgp_sym_encrypt
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-types="npm:@types/node-forge@1"
import forge from 'npm:node-forge@1.3.1';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

type Environment = 'homologation' | 'production';

interface Body {
  cuit: string;
  legalName: string;
  alias: string;
  salesPoint: number;
  environment: Environment;
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
    if (!body.cuit || !/^[0-9]{11}$/.test(body.cuit)) {
      return jsonResponse({ error: 'CUIT inválido. Deben ser 11 dígitos sin guiones.' }, 400);
    }
    if (
      typeof body.legalName !== 'string' ||
      body.legalName.trim().length === 0 ||
      body.legalName.trim().length > 200
    ) {
      return jsonResponse({ error: 'Razón social inválida (1 a 200 caracteres).' }, 400);
    }
    if (typeof body.alias !== 'string' || !/^[a-zA-Z0-9_-]{3,50}$/.test(body.alias)) {
      return jsonResponse(
        { error: 'Alias inválido. Usá letras, números, guiones o guiones bajos (3 a 50).' },
        400,
      );
    }
    if (!Number.isInteger(body.salesPoint) || body.salesPoint <= 0) {
      return jsonResponse({ error: 'Punto de venta inválido (entero > 0).' }, 400);
    }
    if (body.environment !== 'homologation' && body.environment !== 'production') {
      return jsonResponse({ error: 'environment debe ser homologation o production.' }, 400);
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

    // ---------- Generar par RSA + CSR ----------
    // node-forge genera 2048 bits de forma síncrona (~1-3s). Está bien
    // en una edge function (cada request tiene su propio worker).
    let csrPem: string;
    let keyPem: string;
    try {
      const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const csr = forge.pki.createCertificationRequest();
      csr.publicKey = keys.publicKey;
      csr.setSubject([
        { name: 'countryName', value: 'AR' },
        { name: 'organizationName', value: body.legalName.trim() },
        { name: 'commonName', value: body.alias },
        // node-forge no reconoce 'serialNumber' como shortName (el shortName
        // real es 'SN', y forge solo registra los más comunes). Hay que
        // pasarlo por `name`. Subject AFIP requerido: /serialNumber=CUIT NNN.
        { name: 'serialNumber', value: 'CUIT ' + body.cuit },
      ]);
      csr.sign(keys.privateKey, forge.md.sha256.create());
      csrPem = forge.pki.certificationRequestToPem(csr);
      // PKCS#1 (-----BEGIN RSA PRIVATE KEY-----). El cliente WSAA ya
      // acepta este formato (afip-wsaa.ts → privateKeyFromPem).
      keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    } catch (err) {
      console.error('Error generando CSR:', err);
      return jsonResponse(
        { error: `Error generando el par de claves: ${(err as Error).message}` },
        500,
      );
    }

    // ---------- Persistir via RPC ----------
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error: rpcErr } = await adminClient.rpc('afip_save_csr_step', {
      p_tenant_id: tenantId,
      p_cuit: body.cuit,
      p_sales_point: body.salesPoint,
      p_environment: body.environment,
      p_alias: body.alias,
      p_key_pem: keyPem,
      p_csr_pem: csrPem,
      p_encryption_key: encryptionKey,
    });
    if (rpcErr) {
      console.error('Error guardando CSR step:', rpcErr);
      return jsonResponse({ error: `Error guardando el CSR: ${rpcErr.message}` }, 500);
    }

    return jsonResponse(
      { ok: true, csrPem, alias: body.alias, environment: body.environment },
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
