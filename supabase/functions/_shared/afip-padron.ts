// =====================================================================
// Shared: cliente ws_sr_padron_a5 (Padrón AFIP alcance 5)
// =====================================================================
// Implementa la operación getPersona del Web Service de Padrón AFIP
// (alcance 5, suficiente para razón social + condición IVA + domicilio).
//
// Auth: token+sign del TA obtenido vía WSAA con service='ws_sr_padron_a5'
// (getTicketAccess en afip-wsaa.ts). El TA cachea por (tenant, service, env).
//
// SOAP/XML: armamos el envelope a mano y parseamos con regex (mismo patrón
// que afip-wsfev1.ts — DOMParser de Deno tiene quirks con namespaces).
//
// IMPORTANTE — gotchas no obvios del WS de padrón:
//   1. SOAPAction debe ir VACÍA (header 'SOAPAction: ""'). Si mandás algo,
//      el endpoint a veces rechaza con 500 sin faultstring claro.
//   2. Para que el cert pueda consultar este WS hay que ir a WSASS y crear
//      autorización al servicio 'ws_sr_padron_a5' para el alias. Si no se
//      hizo, AFIP responde con faultstring que contiene 'no autorizado' o
//      'autorización' — lo detectamos abajo para devolver un mensaje claro.
//   3. El sign del TA viene base64 → puede tener '=', '+', '/'. Ninguno es
//      un metacaracter XML, pero igual lo escapamos por las dudas (no tiene
//      '<' ni '>' ni '&' por definición de base64, pero defendemos).
//   4. La respuesta NO trae faultstring cuando el CUIT no existe: trae un
//      <soap:Fault> con string tipo "No existe persona con ese Id" — lo
//      mapeamos a 'not_found'.
// =====================================================================

import type { TicketAccess, AfipEnv } from './afip-wsaa.ts';

const PADRON_ENDPOINTS: Record<AfipEnv, string> = {
  homologation: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  production:   'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
};

export interface PadronAuth {
  ta: TicketAccess;
  /** CUIT del comercio (el emisor que pregunta). */
  cuitRepresentada: string;
  env: AfipEnv;
}

/** Condición IVA mapeada al enum del frontend (CustomerIvaCondition). */
export type IvaConditionMapped =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'exento'
  | 'consumidor_final'
  | 'no_categorizado';

/** Datos parseados del padrón. */
export interface PadronPersona {
  cuit: string;
  /** Razón social (jurídica) o "Nombre Apellido" (física), siempre algo no vacío. */
  legalName: string;
  /** Mapeado al enum CustomerIvaCondition del frontend. */
  ivaCondition: IvaConditionMapped;
  /** Domicilio formateado "Calle 123, Ciudad, Provincia" o null si no figura. */
  address: string | null;
}

export type PadronError =
  | { kind: 'not_found' }                    // CUIT no existe en padrón
  | { kind: 'not_authorized' }               // el cert no está autorizado para ws_sr_padron_a5
  | { kind: 'constancia_blocked'; details: string[] }  // AFIP no entrega datos: el CUIT tiene reparos
  | { kind: 'afip_error'; message: string }  // otro error del WS
  | { kind: 'parse_error'; message: string };

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Busca el primer `<tag>...</tag>` (case insensitive, con o sin namespace
 * prefix, con o sin atributos tipo `xsi:type="..."`). Devuelve el texto
 * INTERNO sin trim de XML hijo — útil para extraer bloques o valores escalares.
 *
 * GOTCHA: el WS de padrón AFIP suele devolver tags con atributos
 * (`<razonSocial xsi:type="xs:string">FOO</razonSocial>`). El regex tolera
 * eso con `(?:\\s[^>]*)?`. Sin esa parte, mapLegalName tira "no se pudo
 * determinar la razón social" aunque el XML la tenga.
 */
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(
    new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'),
  );
  return m ? m[1].trim() : null;
}

/** Todas las ocurrencias de `<tag>...</tag>` (case insensitive, con o sin ns/atributos). */
function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,
    'gi',
  );
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------
// Mapeo del XML del padrón al enum del frontend
// ---------------------------------------------------------------------
function mapIvaCondition(personaReturn: string): IvaConditionMapped {
  // 1) Monotributo "moderno": si viene el bloque datosMonotributo, es mono.
  const datosMono = extractTag(personaReturn, 'datosMonotributo');
  if (datosMono) return 'monotributista';

  // 2) Régimen general: revisar impuestos activos.
  const datosRG = extractTag(personaReturn, 'datosRegimenGeneral');
  if (datosRG) {
    const impuestos = extractAllTags(datosRG, 'impuesto');
    let hasIvaActivo = false;
    let hasMonotributoActivo = false; // legacy: idImpuesto=32
    let hasOtroActivo = false;

    for (const imp of impuestos) {
      const id = extractTag(imp, 'idImpuesto');
      const estado = extractTag(imp, 'estadoImpuesto');
      if (estado?.toUpperCase() !== 'ACTIVO') continue;
      if (id === '30') hasIvaActivo = true;
      else if (id === '32') hasMonotributoActivo = true;
      else hasOtroActivo = true;
    }

    if (hasIvaActivo) return 'responsable_inscripto';
    if (hasMonotributoActivo) return 'monotributista';
    if (hasOtroActivo) return 'exento';
  }

  // 3) Sin monotributo y sin régimen general activo → consumidor final.
  //    (No usamos 'no_categorizado' porque ese estado lo reservamos para
  //    customers ingresados manualmente sin información concreta.)
  return 'consumidor_final';
}

function mapLegalName(personaReturn: string): string {
  const datosGen = extractTag(personaReturn, 'datosGenerales') ?? personaReturn;
  const razonSocial = extractTag(datosGen, 'razonSocial');
  if (razonSocial && razonSocial.length > 0) return razonSocial;
  const nombre = extractTag(datosGen, 'nombre');
  const apellido = extractTag(datosGen, 'apellido');
  if (nombre && apellido) return `${nombre} ${apellido}`;
  if (nombre) return nombre;
  if (apellido) return apellido;
  throw { kind: 'parse_error', message: 'No se pudo determinar la razón social' } as PadronError;
}

function mapAddress(personaReturn: string): string | null {
  const datosGen = extractTag(personaReturn, 'datosGenerales') ?? personaReturn;
  const dom = extractTag(datosGen, 'domicilioFiscal');
  if (!dom) return null;
  const direccion = extractTag(dom, 'direccion');
  const localidad = extractTag(dom, 'localidad');
  const provincia = extractTag(dom, 'descripcionProvincia');
  const partes = [direccion, localidad, provincia].filter((p) => p && p.length > 0);
  if (partes.length === 0) return null;
  return partes.join(', ');
}

// ---------------------------------------------------------------------
// API pública: getPersona
// ---------------------------------------------------------------------

/**
 * Consulta el padrón AFIP por CUIT y devuelve los datos mapeados al
 * formato que usa el frontend (legalName + ivaCondition + address).
 *
 * Nunca tira: todos los errores se devuelven como `{ ok: false, error }`.
 */
export async function getPersona(
  auth: PadronAuth,
  cuit: string,
): Promise<{ ok: true; persona: PadronPersona } | { ok: false; error: PadronError }> {
  const endpoint = PADRON_ENDPOINTS[auth.env];

  // Armar envelope. Namespace de padrón A5: http://a5.soap.ws.server.puc.sr/
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a5:getPersona>
      <token>${escapeXml(auth.ta.token)}</token>
      <sign>${escapeXml(auth.ta.sign)}</sign>
      <cuitRepresentada>${escapeXml(auth.cuitRepresentada)}</cuitRepresentada>
      <idPersona>${escapeXml(cuit)}</idPersona>
    </a5:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;

  let xml: string;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        // GOTCHA: SOAPAction VACÍA. Si se manda algo, el WS a veces rechaza.
        'SOAPAction': '',
      },
      body: envelope,
    });
    xml = await res.text();
    if (!res.ok) {
      // Aun con HTTP error, AFIP suele meter un faultstring en el body.
      const fault = extractTag(xml, 'faultstring');
      return {
        ok: false,
        error: classifyFault(fault ?? `HTTP ${res.status}`),
      };
    }
  } catch (err) {
    return { ok: false, error: { kind: 'afip_error', message: (err as Error).message } };
  }

  // Detectar soap:Fault (HTTP 200 con error de negocio).
  const fault = extractTag(xml, 'faultstring');
  if (fault) {
    return { ok: false, error: classifyFault(fault) };
  }

  // Parsear el bloque personaReturn.
  const personaReturn = extractTag(xml, 'personaReturn');
  if (!personaReturn) {
    return {
      ok: false,
      error: { kind: 'parse_error', message: 'Respuesta inesperada del padrón' },
    };
  }

  // GOTCHA: si la CUIT tiene reparos (domicilio fiscal electrónico no
  // constituido, actividades fuera del nomenclador, etc), AFIP devuelve
  // `<errorConstancia>` en vez de los datos. Pasa típicamente en
  // homologación con CUITs reales. Lo manejamos como un caso aparte.
  const errorConstancia = extractTag(personaReturn, 'errorConstancia');
  if (errorConstancia) {
    const details = extractAllTags(errorConstancia, 'error').map((s) => s.trim()).filter(Boolean);
    return { ok: false, error: { kind: 'constancia_blocked', details } };
  }

  try {
    const ivaCondition = mapIvaCondition(personaReturn);
    const legalName = mapLegalName(personaReturn);
    const address = mapAddress(personaReturn);
    return {
      ok: true,
      persona: {
        cuit,
        legalName,
        ivaCondition,
        address,
      },
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'kind' in (err as Record<string, unknown>)) {
      return { ok: false, error: err as PadronError };
    }
    return { ok: false, error: { kind: 'parse_error', message: (err as Error).message } };
  }
}

/**
 * Clasifica un faultstring de AFIP en uno de los kinds de error que
 * sabemos manejar. Lo hacemos en lowercase para tolerar variaciones.
 *
 * 'no_authorized' es el caso clásico que se da cuando el alias del cert
 * no autorizó el servicio ws_sr_padron_a5 en WSASS — devolvemos un kind
 * dedicado para que la edge function dé instrucciones claras al usuario.
 */
function classifyFault(faultstring: string): PadronError {
  const f = faultstring.toLowerCase();
  if (f.includes('no autorizado') || f.includes('autorización') || f.includes('autorizacion')) {
    return { kind: 'not_authorized' };
  }
  if (f.includes('no existe') || f.includes('sin datos') || f.includes('no se encontr')) {
    return { kind: 'not_found' };
  }
  return { kind: 'afip_error', message: faultstring };
}
