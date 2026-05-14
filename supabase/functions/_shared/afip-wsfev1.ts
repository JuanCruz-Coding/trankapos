// =====================================================================
// Shared: cliente WSFEv1 (Web Service Facturación Electrónica v1)
// =====================================================================
// Implementa los métodos mínimos que usa Sprint A2 (Factura C):
//   - FEDummy:                 health check
//   - FECompUltimoAutorizado:  último número emitido para (PV, tipo)
//   - FECAESolicitar:          emitir comprobante y obtener CAE
//
// Auth: header con Token+Sign+Cuit obtenidos previamente via WSAA
// (getTicketAccess en afip-wsaa.ts). El servicio AFIP es 'wsfe'.
//
// SOAP/XML: AFIP rechaza JSON. Construimos el envelope a mano y parseamos
// la respuesta con regex (DOMParser de Deno tiene quirks con namespaces).
// =====================================================================

import type { TicketAccess, AfipEnv } from './afip-wsaa.ts';

const WSFEV1_ENDPOINTS: Record<AfipEnv, string> = {
  homologation: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  production:   'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

// Tipos de comprobante AFIP — los más comunes
// (lista completa: WSFEv1 método FEParamGetTiposCbte)
export const CBTE_TIPO = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  NOTA_DEBITO_A: 2,
  NOTA_DEBITO_B: 7,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_A: 3,
  NOTA_CREDITO_B: 8,
  NOTA_CREDITO_C: 13,
} as const;

// Tipos de documento del receptor
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL_ANONIMO: 99, // sin identificar receptor
} as const;

export interface AuthParams {
  ta: TicketAccess;
  cuit: string;
  env: AfipEnv;
}

export interface VoucherRequest {
  cbteTipo: number;          // CBTE_TIPO.*
  ptoVta: number;
  concepto: 1 | 2 | 3;       // 1=Productos, 2=Servicios, 3=Ambos
  docTipo: number;           // DOC_TIPO.*
  docNro: string;            // '0' si consumidor final anónimo
  cbteFch: string;           // YYYYMMDD
  impTotal: number;
  impNeto: number;
  impIVA: number;
  impTotConc: number;        // No gravado
  impOpEx: number;           // Exento
  impTrib: number;           // Tributos (percepciones, etc)
  monId: string;             // 'PES' = pesos AR
  monCotiz: number;          // 1 para pesos
  // Condición IVA del receptor (RG 5616/2024 — obligatorio desde 2024-11).
  // Valores: 1=RI, 4=Exento, 5=Consumidor Final, 6=Monotributista, 7=No Cat,
  // 8=Exterior proveedor, 9=Exterior cliente, 10=Liberado, 13=Mono Social,
  // 15=No Alcanzado, 16=Mono Promovido.
  condicionIVAReceptorId: number;
  // Para servicios (concepto=2/3): fechas de servicio
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
}

/** Códigos AFIP para condición IVA del receptor (RG 5616/2024). */
export const COND_IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTISTA: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
  CLIENTE_EXTERIOR: 9,
  LIBERADO_LEY_19640: 10,
  MONOTRIBUTISTA_SOCIAL: 13,
  NO_ALCANZADO: 15,
  MONOTRIBUTISTA_PROMOVIDO: 16,
} as const;

export interface VoucherResponse {
  resultado: 'A' | 'R' | 'P';
  cae: string;
  caeFchVto: string;         // YYYYMMDD
  cbteDesde: number;
  cbteHasta: number;
  observaciones: { code: string; msg: string }[];
  errores: { code: string; msg: string }[];
  reproceso: boolean;
}

// ---------------------------------------------------------------------
// Helpers SOAP
// ---------------------------------------------------------------------
function buildAuthBlock(auth: AuthParams): string {
  // AFIP exige que el bloque Auth tenga el mismo namespace que el resto
  // del request (ar:). Sin prefijo, devuelve "Campo Auth no fue ingresado".
  return `<ar:Auth>
  <ar:Token>${escapeXml(auth.ta.token)}</ar:Token>
  <ar:Sign>${escapeXml(auth.ta.sign)}</ar:Sign>
  <ar:Cuit>${auth.cuit}</ar:Cuit>
</ar:Auth>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function num(n: number): string {
  // AFIP requiere 2 decimales para importes
  return n.toFixed(2);
}

async function soapCall(
  endpoint: string,
  soapAction: string,
  body: string,
): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': soapAction,
    },
    body: envelope,
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`WSFEv1 HTTP ${res.status}: ${xml.slice(0, 500)}`);
  }
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (fault) throw new Error(`WSFEv1 fault: ${fault[1].trim()}`);
  return xml;
}

function pickText(xml: string, tag: string): string | null {
  // Buscamos tag con o sin namespace prefix
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function pickArrayItems(xml: string, containerTag: string, itemTag: string): string[] {
  const container = pickText(xml, containerTag);
  if (!container) return [];
  return pickAll(container, itemTag);
}

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------

/**
 * Health-check del servicio. Verifica que appserver/dbserver/authserver
 * están OK. No requiere auth.
 */
export async function feDummy(env: AfipEnv): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const body = `<ar:FEDummy/>`;
  const xml = await soapCall(WSFEV1_ENDPOINTS[env], 'http://ar.gov.afip.dif.FEV1/FEDummy', body);
  return {
    appServer: pickText(xml, 'AppServer') ?? '?',
    dbServer: pickText(xml, 'DbServer') ?? '?',
    authServer: pickText(xml, 'AuthServer') ?? '?',
  };
}

/**
 * Devuelve el último número de comprobante autorizado para (ptoVta, cbteTipo).
 * El próximo a emitir es +1.
 */
export async function feCompUltimoAutorizado(
  auth: AuthParams,
  ptoVta: number,
  cbteTipo: number,
): Promise<number> {
  const body = `<ar:FECompUltimoAutorizado>
  ${buildAuthBlock(auth)}
  <ar:PtoVta>${ptoVta}</ar:PtoVta>
  <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
</ar:FECompUltimoAutorizado>`;
  const xml = await soapCall(
    WSFEV1_ENDPOINTS[auth.env],
    'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    body,
  );
  // Errores AFIP en este endpoint vienen como <Errors><Err><Code>X</Code><Msg>Y</Msg></Err></Errors>
  const errs = pickArrayItems(xml, 'Errors', 'Err');
  if (errs.length > 0) {
    const detail = errs.map((e) => `${pickText(e, 'Code') ?? '?'}: ${pickText(e, 'Msg') ?? '?'}`).join(' | ');
    throw new Error(`AFIP rechazó FECompUltimoAutorizado: ${detail}`);
  }
  const cbteNro = pickText(xml, 'CbteNro');
  if (cbteNro === null) throw new Error('Respuesta sin CbteNro');
  return Number(cbteNro);
}

/**
 * Solicita CAE para un comprobante. Devuelve el resultado parseado.
 * Si resultado='A', el comprobante está autorizado. Si 'R', rechazado
 * (mirar observaciones/errores).
 */
export async function feCAESolicitar(
  auth: AuthParams,
  ptoVta: number,
  voucherNumber: number,
  v: VoucherRequest,
): Promise<VoucherResponse> {
  // El bloque opcional de fechas de servicio
  const servBlock =
    v.fchServDesde && v.fchServHasta && v.fchVtoPago
      ? `<ar:FchServDesde>${v.fchServDesde}</ar:FchServDesde>
         <ar:FchServHasta>${v.fchServHasta}</ar:FchServHasta>
         <ar:FchVtoPago>${v.fchVtoPago}</ar:FchVtoPago>`
      : '';

  const body = `<ar:FECAESolicitar>
  ${buildAuthBlock(auth)}
  <ar:FeCAEReq>
    <ar:FeCabReq>
      <ar:CantReg>1</ar:CantReg>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${v.cbteTipo}</ar:CbteTipo>
    </ar:FeCabReq>
    <ar:FeDetReq>
      <ar:FECAEDetRequest>
        <ar:Concepto>${v.concepto}</ar:Concepto>
        <ar:DocTipo>${v.docTipo}</ar:DocTipo>
        <ar:DocNro>${v.docNro}</ar:DocNro>
        <ar:CbteDesde>${voucherNumber}</ar:CbteDesde>
        <ar:CbteHasta>${voucherNumber}</ar:CbteHasta>
        <ar:CbteFch>${v.cbteFch}</ar:CbteFch>
        <ar:ImpTotal>${num(v.impTotal)}</ar:ImpTotal>
        <ar:ImpTotConc>${num(v.impTotConc)}</ar:ImpTotConc>
        <ar:ImpNeto>${num(v.impNeto)}</ar:ImpNeto>
        <ar:ImpOpEx>${num(v.impOpEx)}</ar:ImpOpEx>
        <ar:ImpTrib>${num(v.impTrib)}</ar:ImpTrib>
        <ar:ImpIVA>${num(v.impIVA)}</ar:ImpIVA>
        ${servBlock}
        <ar:MonId>${v.monId}</ar:MonId>
        <ar:MonCotiz>${v.monCotiz}</ar:MonCotiz>
        <ar:CondicionIVAReceptorId>${v.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>
      </ar:FECAEDetRequest>
    </ar:FeDetReq>
  </ar:FeCAEReq>
</ar:FECAESolicitar>`;

  const xml = await soapCall(
    WSFEV1_ENDPOINTS[auth.env],
    'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
    body,
  );

  // Errores top-level (estructura inválida, etc) — distinto a Observaciones del detalle
  const topErrors = pickArrayItems(xml, 'Errors', 'Err').map((e) => ({
    code: pickText(e, 'Code') ?? '?',
    msg: pickText(e, 'Msg') ?? '?',
  }));

  // Resultado a nivel cabecera (A/R/P)
  const resultadoCab = pickText(xml, 'Resultado') as 'A' | 'R' | 'P' | null;
  const reproceso = pickText(xml, 'Reproceso') === 'S';

  // Detalle (un solo comprobante en este request)
  const detail = pickText(xml, 'FECAEDetResponse') ?? xml;
  const cae = pickText(detail, 'CAE') ?? '';
  const caeFchVto = pickText(detail, 'CAEFchVto') ?? '';
  const cbteDesde = Number(pickText(detail, 'CbteDesde') ?? '0');
  const cbteHasta = Number(pickText(detail, 'CbteHasta') ?? '0');
  const resultadoDet = (pickText(detail, 'Resultado') ?? resultadoCab ?? 'R') as 'A' | 'R' | 'P';

  const observaciones = pickArrayItems(detail, 'Observaciones', 'Obs').map((o) => ({
    code: pickText(o, 'Code') ?? '?',
    msg: pickText(o, 'Msg') ?? '?',
  }));

  return {
    resultado: resultadoDet,
    cae,
    caeFchVto,
    cbteDesde,
    cbteHasta,
    observaciones,
    errores: topErrors,
    reproceso,
  };
}
