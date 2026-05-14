// =====================================================================
// Helper: reconstruir el QR fiscal AFIP en el cliente.
// =====================================================================
// Espejo de `buildQrUrl` que vive en `supabase/functions/afip-emit-voucher/`.
// Lo usamos para REIMPRESIÓN: en /sales, al ver un ticket viejo, no llamamos
// al backend — armamos la misma URL del QR con los datos ya persistidos
// (afip_documents.cae + sale + customer + tenant.taxId).
//
// Mantener sincronizado con el backend. Si AFIP cambia el formato del QR,
// se cambia acá y en `afip-emit-voucher/index.ts`.
// =====================================================================

export interface QrUrlArgs {
  /** CUIT del emisor (11 dígitos sin guiones). */
  cuit: string;
  /** Punto de venta. */
  ptoVta: number;
  /** CBTE_TIPO de AFIP (1=A, 6=B, 11=C, etc). */
  tipoCmp: number;
  /** Número del comprobante. */
  nroCmp: number;
  /** Fecha YYYY-MM-DD. */
  fecha: string;
  /** Importe total con IVA. */
  importe: number;
  /** Código de autorización electrónica. */
  cae: string;
  /** Tipo de doc receptor (80=CUIT, 86=CUIL, 96=DNI, 99=anónimo). */
  tipoDocRec?: number;
  /** Número de doc receptor (0 si anónimo). */
  nroDocRec?: number;
}

/**
 * Genera la URL `https://www.afip.gob.ar/fe/qr/?p=<base64>` que se renderiza
 * en el ticket fiscal. Espejo exacto del helper del backend.
 */
export function buildAfipQrUrl(args: QrUrlArgs): string {
  const payload = {
    ver: 1,
    fecha: args.fecha,
    cuit: Number(args.cuit),
    ptoVta: args.ptoVta,
    tipoCmp: args.tipoCmp,
    nroCmp: args.nroCmp,
    importe: args.importe,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: args.tipoDocRec ?? 99,
    nroDocRec: args.nroDocRec ?? 0,
    tipoCodAut: 'E',
    codAut: Number(args.cae),
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(json);
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
}

/**
 * Mapea la letra (A/B/C) al CBTE_TIPO de Factura. Si necesitás NC/ND,
 * sumarlos acá (NC_A=3, NC_B=8, NC_C=13, ND_A=2, ND_B=7, ND_C=12).
 */
export function letterToCbteTipo(letter: 'A' | 'B' | 'C'): number {
  switch (letter) {
    case 'A': return 1;
    case 'B': return 6;
    case 'C': return 11;
  }
}
