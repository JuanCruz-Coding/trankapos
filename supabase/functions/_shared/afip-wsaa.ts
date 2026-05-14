// =====================================================================
// Shared: cliente WSAA (Web Service de Autenticación AFIP)
// =====================================================================
// Implementa el flujo:
//   1. Lee TA cacheado de afip_ta_cache (si existe y no expiró → lo devuelve).
//   2. Si no hay, genera TRA (XML con timestamps).
//   3. Firma el TRA con CMS/PKCS#7 usando cert+key del comercio (node-forge).
//   4. POST SOAP a LoginCms (homo o prod según env).
//   5. Parsea la respuesta XML, extrae Token+Sign+ExpirationTime.
//   6. Guarda en cache.
//
// El TA dura ~12 horas. Renovamos al expirar (con un margen de seguridad
// para evitar enviar uno que se vence mientras llega a AFIP).
//
// Por qué node-forge: Deno no trae PKCS#7/CMS nativo. node-forge es la
// lib JS de referencia para AFIP (la usan afip.js, AfipSDK por debajo,
// etc). Se importa por `npm:` specifier — Supabase Edge Functions
// (Deno) lo soporta out of the box.
// =====================================================================

// @ts-types="npm:@types/node-forge@1"
import forge from 'npm:node-forge@1.3.1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type AfipEnv = 'homologation' | 'production';

export interface TicketAccess {
  token: string;
  sign: string;
  generationTime: string; // ISO
  expirationTime: string; // ISO
}

const WSAA_ENDPOINTS: Record<AfipEnv, string> = {
  homologation: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  production:   'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

// Margen antes de expiración para considerar el TA "necesita renovarse".
const TA_RENEWAL_MARGIN_MS = 5 * 60 * 1000; // 5 minutos

// ---------------------------------------------------------------------
// 1. Construir TRA XML
// ---------------------------------------------------------------------
function buildTra(service: string): string {
  const now = new Date();
  // AFIP requiere timestamps en UTC con offset. Usamos formato ISO:
  // YYYY-MM-DDTHH:MM:SS-03:00 (zona horaria de AR).
  // generationTime: ahora - 5 min (cubrir drift de clock).
  // expirationTime: ahora + 10 min.
  const gen = new Date(now.getTime() - 5 * 60_000);
  const exp = new Date(now.getTime() + 10 * 60_000);
  const tzOffset = '-03:00';

  function fmt(d: Date): string {
    // YYYY-MM-DDTHH:MM:SS — interpretado como hora local AR.
    // Trabajamos en UTC para evitar issues de TZ del runtime, pero AFIP
    // espera hora "local" con offset. Convertimos a -03:00 manualmente.
    const local = new Date(d.getTime() - 3 * 60 * 60_000); // shift a UTC-3
    return local.toISOString().slice(0, 19) + tzOffset;
  }

  // uniqueId: int único por solicitud, AFIP recomienda timestamp en segundos.
  const uniqueId = Math.floor(now.getTime() / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${fmt(gen)}</generationTime>
    <expirationTime>${fmt(exp)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

// ---------------------------------------------------------------------
// 2. Firmar TRA con CMS/PKCS#7
// ---------------------------------------------------------------------
function signCmsBase64(tra: string, certPem: string, keyPem: string): string {
  let cert;
  let key;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch (err) {
    throw new Error(`Certificado inválido: ${(err as Error).message}`);
  }
  try {
    key = forge.pki.privateKeyFromPem(keyPem);
  } catch (err) {
    throw new Error(`Clave privada inválida: ${(err as Error).message}`);
  }

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });

  // detached=false → el contenido firmado va embebido (AFIP lo requiere así).
  p7.sign({ detached: false });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

// ---------------------------------------------------------------------
// 3. Llamar a LoginCms
// ---------------------------------------------------------------------
async function callLoginCms(cms: string, env: AfipEnv): Promise<string> {
  const endpoint = WSAA_ENDPOINTS[env];
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    body: soapEnvelope,
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`WSAA HTTP ${res.status}: ${extractSoapFault(xml) ?? xml.slice(0, 500)}`);
  }
  // Aún con HTTP 200, AFIP puede responder con un faultstring.
  const fault = extractSoapFault(xml);
  if (fault) throw new Error(`WSAA fault: ${fault}`);
  return xml;
}

// ---------------------------------------------------------------------
// 4. Parsear la respuesta SOAP → extraer TA XML embebido
// ---------------------------------------------------------------------
function extractSoapFault(xml: string): string | null {
  const m = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  return m ? m[1].trim() : null;
}

function extractInnerTa(soapXml: string): string {
  // El response tiene <loginCmsReturn> con XML escapado (entidades) que es
  // el TA real. Hay que des-escapar y luego parsear el TA propiamente.
  const m = soapXml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/i);
  if (!m) throw new Error('Respuesta WSAA sin loginCmsReturn');
  // Des-escapar entidades XML
  return m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseTaXml(taXml: string): TicketAccess {
  function pick(tag: string): string {
    const m = taXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) throw new Error(`TA sin <${tag}>`);
    return m[1].trim();
  }
  return {
    token: pick('token'),
    sign: pick('sign'),
    generationTime: pick('generationTime'),
    expirationTime: pick('expirationTime'),
  };
}

// ---------------------------------------------------------------------
// 5. API pública: getTicketAccess
// ---------------------------------------------------------------------
/**
 * Devuelve un TA válido para `service` y `env` del tenant. Primero
 * intenta usar cache (afip_ta_cache). Si no hay o expiró (con margen),
 * autentica contra WSAA y guarda el nuevo TA.
 */
export async function getTicketAccess(opts: {
  admin: SupabaseClient;
  tenantId: string;
  service: string; // 'wsfe' para facturación electrónica
  env: AfipEnv;
  certPem: string;
  keyPem: string;
}): Promise<TicketAccess> {
  const { admin, tenantId, service, env, certPem, keyPem } = opts;

  // 1) Buscar cache
  const { data: cached } = await admin
    .from('afip_ta_cache')
    .select('token, sign, generation_time, expiration_time')
    .eq('tenant_id', tenantId)
    .eq('service', service)
    .eq('environment', env)
    .maybeSingle();

  if (cached) {
    const expMs = new Date(cached.expiration_time).getTime();
    if (expMs - Date.now() > TA_RENEWAL_MARGIN_MS) {
      return {
        token: cached.token,
        sign: cached.sign,
        generationTime: cached.generation_time,
        expirationTime: cached.expiration_time,
      };
    }
  }

  // 2) Generar TRA, firmar, llamar WSAA
  const tra = buildTra(service);
  const cms = signCmsBase64(tra, certPem, keyPem);
  const soapResp = await callLoginCms(cms, env);
  const taXml = extractInnerTa(soapResp);
  const ta = parseTaXml(taXml);

  // 3) Guardar en cache (upsert)
  const { error: upErr } = await admin
    .from('afip_ta_cache')
    .upsert(
      {
        tenant_id: tenantId,
        service,
        environment: env,
        token: ta.token,
        sign: ta.sign,
        generation_time: ta.generationTime,
        expiration_time: ta.expirationTime,
      },
      { onConflict: 'tenant_id,service,environment' },
    );
  if (upErr) {
    console.warn('No se pudo cachear TA AFIP:', upErr.message);
    // No bloqueamos: el TA vino bien, igual lo devolvemos.
  }

  return ta;
}
