// =====================================================================
// Shared: core de emisión AFIP (Sprint A5a)
// =====================================================================
// Extrae la lógica de emisión que vivía embebida en afip-emit-voucher y
// afip-emit-credit-note a funciones reutilizables. Los endpoints quedan
// como shells (CORS + auth + parseo del body) y delegan acá.
//
// Exporta:
//   - EmitResult                 → shape de respuesta común.
//   - emitVoucherForSale()       → emite Factura A/B/C desde una sale.
//   - emitCreditNoteForFactura() → emite NC sobre una factura autorizada.
//
// Ambas funciones soportan `opts.existingDocId`: cuando viene, en vez de
// insertar un afip_documents pending nuevo, ACTUALIZAN ese doc (rejected →
// pending → authorized/rejected) e incrementan retry_count. Esto es lo que
// usa afip-retry-document para reintentar comprobantes rechazados.
//
// IMPORTANTE: estas funciones NO hacen CORS, NI auth, NI parseo de body, NI
// void_sale_atomic. Eso queda en los shells. Acá entra un `tenantId` ya
// validado por el caller.
// =====================================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getTicketAccess, type AfipEnv } from './afip-wsaa.ts';
import {
  AFIP_ANON_MAX_AMOUNT,
  CBTE_TIPO,
  DOC_TIPO,
  computeIvaBreakdown,
  feCAESolicitar,
  feCompUltimoAutorizado,
  type CbteAsoc,
  type IvaAlicuota,
  type VoucherRequest,
} from './afip-wsfev1.ts';
import {
  classifyVoucher,
  creditNoteCbteTipo,
  isClassificationError,
  type EmitterTaxCondition,
  type ReceiverDocType,
  type ReceiverIvaCondition,
} from './afip-letter.ts';

// ---------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------

export interface EmitResult {
  ok: boolean;
  documentId?: string;
  cae?: string;
  voucherNumber?: number;
  caeDueDate?: string;
  ptoVta?: number;
  cbteTipo?: 'A' | 'B' | 'C';
  qrUrl?: string;
  error?: string;
  /** true si ya estaba authorized y se devolvió sin re-emitir (idempotencia). */
  already_emitted?: boolean;
  /** Entorno AFIP con el que se emitió ('homologation' | 'production'). */
  environment?: string;
  /** Snapshot del receptor (para que el frontend muestre el bloque en A). */
  receiver?: {
    docType: number;
    docNumber: string;
    legalName: string | null;
    ivaCondition: string | null;
  } | null;
}

export interface EmitOpts {
  /**
   * Si viene, se ACTUALIZA ese afip_documents en vez de insertar uno nuevo:
   *   UPDATE ... SET status='pending', retry_count = retry_count + 1,
   *                  last_retry_at = now() WHERE id = existingDocId
   * y el UPDATE final de authorized/rejected es sobre ese mismo id.
   */
  existingDocId?: string;
}

// ---------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------

interface SaleRow {
  id: string;
  tenant_id: string;
  total: string | number;
  discount: string | number;
  status: string;
  voided: boolean;
  created_at: string;
  customer_doc_type: number | null;
  customer_doc_number: string | null;
  customer_legal_name: string | null;
  customer_iva_condition: string | null;
}

interface TenantRow {
  id: string;
  tax_condition: string;
}

interface AfipDocRow {
  id: string;
  tenant_id: string;
  sale_id: string | null;
  doc_type: string;
  doc_letter: 'A' | 'B' | 'C';
  sales_point: number;
  voucher_number: number | null;
  cae: string | null;
  cae_due_date: string | null;
  status: string;
  related_doc_id: string | null;
  raw_request: RawRequest | null;
}

// Snapshot del VoucherRequest de la factura original guardado en
// afip_documents.raw_request por emitVoucherForSale. Es la fuente de
// verdad para los importes de la NC — se copian tal cual.
interface RawRequest {
  cbteTipo: number;
  ptoVta: number;
  concepto: 1 | 2 | 3;
  docTipo: number;
  docNro: string;
  cbteFch: string; // YYYYMMDD de la factura original
  impTotal: number;
  impNeto: number;
  impIVA: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
  condicionIVAReceptorId: number;
  iva?: IvaAlicuota[];
}

// ---------------------------------------------------------------------
// Helpers (antes duplicados en los dos endpoints)
// ---------------------------------------------------------------------

/** AFIP yyyymmdd */
export function fmtDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Genera el contenido del QR fiscal AFIP. Formato oficial:
 * https://www.afip.gob.ar/fe/qr/?p=<base64>
 * donde <base64> es JSON con los datos del comprobante.
 */
export function buildQrUrl(args: {
  cuit: string;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  fecha: string; // YYYY-MM-DD
  importe: number;
  cae: string;
  /** Tipo de documento del receptor (99 si anónimo). */
  tipoDocRec?: number;
  /** Número de documento del receptor (0 si anónimo). */
  nroDocRec?: number;
}): string {
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

// CBTE_TIPO de la factura original. Preferimos el guardado en raw_request;
// si por algún motivo no está, lo derivamos de la letra.
function facturaCbteTipo(doc: AfipDocRow): number {
  if (doc.raw_request?.cbteTipo) return doc.raw_request.cbteTipo;
  switch (doc.doc_letter) {
    case 'A': return CBTE_TIPO.FACTURA_A;
    case 'B': return CBTE_TIPO.FACTURA_B;
    case 'C': return CBTE_TIPO.FACTURA_C;
  }
}

// ---------------------------------------------------------------------
// emitVoucherForSale
// ---------------------------------------------------------------------

/**
 * Emite una Factura A/B/C desde una sale. Toda la lógica que antes vivía en
 * afip-emit-voucher EXCEPTO CORS/auth/parseo del body.
 *
 * - Si `opts.existingDocId` NO viene: inserta un afip_documents pending nuevo
 *   (comportamiento original del endpoint).
 * - Si `opts.existingDocId` viene: actualiza ese doc (status='pending',
 *   retry_count += 1, last_retry_at = now()) y el resultado final se escribe
 *   sobre ese mismo id. Lo usa afip-retry-document.
 *
 * Idempotencia: si ya hay un afip_documents authorized para esta sale, lo
 * devuelve sin re-emitir.
 *
 * @param tenantId Tenant YA validado por el caller (dueño de la sale).
 */
export async function emitVoucherForSale(
  admin: SupabaseClient,
  tenantId: string,
  saleId: string,
  encryptionKey: string,
  opts?: EmitOpts,
): Promise<EmitResult> {
  const existingDocId = opts?.existingDocId;

  // Cargar sale (incluye snapshot del receptor para clasificar la letra)
  const { data: saleData, error: saleErr } = await admin
    .from('sales')
    .select(
      'id, tenant_id, total, discount, status, voided, created_at, ' +
        'customer_doc_type, customer_doc_number, customer_legal_name, customer_iva_condition',
    )
    .eq('id', saleId)
    .maybeSingle();
  if (saleErr) return { ok: false, error: saleErr.message };
  const sale = saleData as SaleRow | null;
  if (!sale) return { ok: false, error: 'Sale no encontrada' };
  if (sale.tenant_id !== tenantId) {
    return { ok: false, error: 'Sale no pertenece a tu tenant' };
  }
  if (sale.voided) {
    return { ok: false, error: 'No se puede facturar una venta anulada' };
  }

  // Idempotencia: si ya hay un afip_document authorized, retornarlo.
  const { data: existing } = await admin
    .from('afip_documents')
    .select('id, doc_type, doc_letter, sales_point, voucher_number, cae, cae_due_date, status, qr_url, error_message')
    .eq('tenant_id', tenantId)
    .eq('sale_id', sale.id)
    .in('status', ['authorized', 'pending'])
    .maybeSingle();
  if (existing?.status === 'authorized') {
    return {
      ok: true,
      already_emitted: true,
      documentId: existing.id,
      cae: existing.cae ?? undefined,
      voucherNumber: existing.voucher_number ?? undefined,
      caeDueDate: existing.cae_due_date ?? undefined,
      ptoVta: existing.sales_point,
      cbteTipo: existing.doc_letter,
      qrUrl: existing.qr_url ?? undefined,
    };
  }

  // Cargar tenant y credenciales
  const { data: tenantData, error: tenErr } = await admin
    .from('tenants')
    .select('id, tax_condition')
    .eq('id', tenantId)
    .single();
  if (tenErr) return { ok: false, error: tenErr.message };
  const tenant = tenantData as TenantRow;

  // Clasificar el voucher según matriz fiscal (emisor + receptor).
  const classification = classifyVoucher(
    tenant.tax_condition as EmitterTaxCondition,
    {
      docType: (sale.customer_doc_type as ReceiverDocType | null) ?? null,
      docNumber: sale.customer_doc_number,
      legalName: sale.customer_legal_name,
      ivaCondition: sale.customer_iva_condition as ReceiverIvaCondition | null,
    },
  );
  if (isClassificationError(classification)) {
    return { ok: false, error: classification.message };
  }

  // RG 5616/2024: Factura B a consumidor anónimo no puede superar un monto.
  const totalNum = Number(sale.total);
  if (
    classification.letter === 'B' &&
    classification.docTipo === DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO &&
    totalNum > AFIP_ANON_MAX_AMOUNT
  ) {
    return {
      ok: false,
      error: `Las facturas B a consumidor anónimo por más de $${AFIP_ANON_MAX_AMOUNT.toLocaleString('es-AR')} requieren identificar al receptor (DNI o CUIT). Volvé al carrito y agregá los datos del cliente.`,
    };
  }

  const { data: credsRows, error: credsErr } = await admin.rpc('afip_get_credentials', {
    p_tenant_id: tenantId,
    p_encryption_key: encryptionKey,
  });
  if (credsErr) return { ok: false, error: `Error credenciales: ${credsErr.message}` };
  const creds = Array.isArray(credsRows) ? credsRows[0] : credsRows;
  if (!creds) return { ok: false, error: 'AFIP no configurado para este tenant' };
  if (!creds.is_active) return { ok: false, error: 'AFIP pausado' };

  const env = creds.environment as AfipEnv;
  const ptoVta = creds.sales_point as number;
  const cuit = creds.cuit as string;

  // Reservar el slot: insertar afip_document pending nuevo, o actualizar el
  // existente (path de retry). En retry incrementamos retry_count y seteamos
  // last_retry_at; el número rechazado del intento previo quedó libre, así
  // que volvemos a pedir feCompUltimoAutorizado + 1.
  // TODO A5b: feCompConsultar para detectar timeout que AFIP sí autorizó
  // (cuando existingDocId trae un voucher_number de un intento que falló
  // DESPUÉS de pedir número). feCompConsultar todavía no existe en
  // afip-wsfev1.ts — por ahora re-emitimos pidiendo número nuevo.
  let docId: string;
  if (existingDocId) {
    // supabase-js no soporta `retry_count = retry_count + 1` en un .update(),
    // así que incrementamos con un read+write previo. Los retries de un mismo
    // documento son secuenciales (un cajero a la vez) → sin race en la práctica.
    await incrementRetryCount(admin, existingDocId);
    const { data: updRow, error: updErr } = await admin
      .from('afip_documents')
      .update({
        status: 'pending',
        doc_letter: classification.letter,
        sales_point: ptoVta,
        environment: env,
        last_retry_at: new Date().toISOString(),
      })
      .eq('id', existingDocId)
      .select('id')
      .single();
    if (updErr) return { ok: false, error: `Error actualizando afip_document: ${updErr.message}` };
    docId = updRow.id;
  } else {
    const { data: docRow, error: docInsErr } = await admin
      .from('afip_documents')
      .insert({
        tenant_id: tenantId,
        sale_id: sale.id,
        doc_type: 'factura',
        doc_letter: classification.letter,
        sales_point: ptoVta,
        status: 'pending',
        environment: env,
      })
      .select('id')
      .single();
    if (docInsErr) return { ok: false, error: `Error insertando afip_document: ${docInsErr.message}` };
    docId = docRow.id;
  }

  try {
    // WSAA: obtener TA
    const ta = await getTicketAccess({
      admin,
      tenantId,
      service: 'wsfe',
      env,
      certPem: creds.cert_pem,
      keyPem: creds.key_pem,
    });
    const auth = { ta, cuit, env };

    // WSFEv1: obtener último número autorizado para este tipo+PV
    const last = await feCompUltimoAutorizado(auth, ptoVta, classification.cbteTipo);
    const nextNumber = last + 1;

    const total = Number(sale.total);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`Sale.total inválido: ${sale.total}`);
    }
    const saleDiscount = Number(sale.discount ?? 0);

    // Cargar items con tax_rate para calcular bloque IVA (A/B) o validar (C).
    const { data: itemRows } = await admin
      .from('sale_items')
      .select('subtotal, product_id, products(tax_rate)')
      .eq('sale_id', sale.id);
    const itemsForIva = ((itemRows ?? []) as Array<{
      subtotal: string | number;
      product_id: string;
      products?: { tax_rate: string | number } | { tax_rate: string | number }[] | null;
    }>).map((it) => {
      const productRel = Array.isArray(it.products) ? it.products[0] : it.products;
      const rate = productRel?.tax_rate != null ? Number(productRel.tax_rate) : 21;
      return { subtotal: Number(it.subtotal), taxRate: rate };
    });

    // Para A/B: discriminamos IVA con el helper. Para C: no se manda bloque
    // y ImpNeto = total, ImpIVA = 0.
    let impNeto: number;
    let impIVA: number;
    let impTotal: number;
    let ivaForRequest: { id: number; baseImp: number; importe: number }[] | undefined;

    if (classification.letter === 'C') {
      impNeto = total;
      impIVA = 0;
      impTotal = total;
      ivaForRequest = undefined;
    } else {
      // A o B: calculamos breakdown
      const breakdown = computeIvaBreakdown(itemsForIva, saleDiscount, total);
      impNeto = breakdown.impNeto;
      impIVA = breakdown.impIVA;
      impTotal = breakdown.impTotal;
      ivaForRequest = breakdown.alicuotas;
      console.log(
        `[A3.4] Factura ${classification.letter}: neto=${impNeto} iva=${impIVA} total=${impTotal} alic=${JSON.stringify(breakdown.alicuotas)}`,
      );
    }

    // Fecha del comprobante: hoy (AFIP acepta ±5 días)
    const today = new Date();
    const cbteFch = fmtDate(today);
    const cbteFchIso = `${cbteFch.slice(0, 4)}-${cbteFch.slice(4, 6)}-${cbteFch.slice(6, 8)}`;

    // VoucherRequest completo — lo guardamos en afip_documents.raw_request
    // porque las Notas de Crédito necesitan copiar estos importes EXACTOS
    // de la factura original (recalcular = riesgo de error 10063 de AFIP).
    const voucherRequest = {
      cbteTipo: classification.cbteTipo,
      ptoVta,
      concepto: 1 as const, // 1 = Productos
      docTipo: classification.docTipo,
      docNro: classification.docNro,
      cbteFch,
      impTotal,
      impNeto,
      impIVA,
      impTotConc: 0,
      impOpEx: 0,
      impTrib: 0,
      monId: 'PES',
      monCotiz: 1,
      condicionIVAReceptorId: classification.condicionIVAReceptorId,
      iva: ivaForRequest,
    };

    const resp = await feCAESolicitar(auth, ptoVta, nextNumber, voucherRequest);

    if (resp.resultado !== 'A') {
      const obsTxt = resp.observaciones.map((o) => `${o.code}:${o.msg}`).join(' | ');
      const errTxt = resp.errores.map((e) => `${e.code}:${e.msg}`).join(' | ');
      const detail = [obsTxt, errTxt].filter(Boolean).join(' || ') || `Resultado ${resp.resultado}`;
      await admin
        .from('afip_documents')
        .update({
          status: 'rejected',
          voucher_number: nextNumber,
          error_message: detail.slice(0, 500),
          raw_request: voucherRequest,
          raw_response: resp,
        })
        .eq('id', docId);
      return { ok: false, error: `AFIP rechazó: ${detail}`, documentId: docId };
    }

    // Construir QR fiscal AFIP — con tipo real y datos del receptor reales.
    const caeFchVtoIso = `${resp.caeFchVto.slice(0, 4)}-${resp.caeFchVto.slice(4, 6)}-${resp.caeFchVto.slice(6, 8)}`;
    const qrUrl = buildQrUrl({
      cuit,
      ptoVta,
      tipoCmp: classification.cbteTipo,
      nroCmp: nextNumber,
      fecha: cbteFchIso,
      importe: impTotal,
      cae: resp.cae,
      tipoDocRec: classification.docTipo,
      nroDocRec: classification.docNro === '0' ? 0 : Number(classification.docNro),
    });

    // OK: autorizar el documento. Guardamos qr_url + raw_request como
    // snapshot (raw_request es la fuente de verdad para emitir la NC).
    await admin
      .from('afip_documents')
      .update({
        status: 'authorized',
        voucher_number: nextNumber,
        cae: resp.cae,
        cae_due_date: caeFchVtoIso,
        qr_url: qrUrl,
        raw_request: voucherRequest,
        raw_response: resp,
        emitted_at: new Date().toISOString(),
      })
      .eq('id', docId);

    return {
      ok: true,
      documentId: docId,
      cae: resp.cae,
      voucherNumber: nextNumber,
      caeDueDate: caeFchVtoIso,
      ptoVta,
      cbteTipo: classification.letter,
      qrUrl,
      environment: env,
      receiver: classification.docNro !== '0' ? {
        docType: classification.docTipo,
        docNumber: classification.docNro,
        legalName: sale.customer_legal_name ?? null,
        ivaCondition: sale.customer_iva_condition ?? null,
      } : null,
    };
  } catch (err) {
    const msg = (err as Error).message;
    await admin
      .from('afip_documents')
      .update({
        status: 'rejected',
        error_message: msg.slice(0, 500),
      })
      .eq('id', docId);
    return { ok: false, error: msg, documentId: docId };
  }
}

// ---------------------------------------------------------------------
// emitCreditNoteForFactura
// ---------------------------------------------------------------------

/**
 * Emite una Nota de Crédito sobre una factura ya autorizada. Toda la lógica
 * que antes vivía en afip-emit-credit-note EXCEPTO CORS/auth/parseo del body
 * Y EXCEPTO el void_sale_atomic (eso queda en el shell del modo 'void').
 *
 * Recibe directamente el id del afip_documents de la factura original.
 *
 * - Si `opts.existingDocId` NO viene: inserta un afip_documents pending nuevo
 *   para la NC (comportamiento original del endpoint).
 * - Si `opts.existingDocId` viene: actualiza ese doc NC existente (path de
 *   retry). Lo usa afip-retry-document.
 *
 * Idempotencia: si ya hay una NC authorized para esa factura, la devuelve.
 *
 * @param tenantId Tenant YA validado por el caller.
 * @param facturaDocId id del afip_documents de la factura original.
 */
export async function emitCreditNoteForFactura(
  admin: SupabaseClient,
  tenantId: string,
  facturaDocId: string,
  encryptionKey: string,
  opts?: EmitOpts,
): Promise<EmitResult> {
  const existingDocId = opts?.existingDocId;

  const docCols =
    'id, tenant_id, sale_id, doc_type, doc_letter, sales_point, ' +
    'voucher_number, cae, cae_due_date, status, related_doc_id, raw_request';

  // Cargar la factura original.
  const { data: facturaData, error: facturaErr } = await admin
    .from('afip_documents')
    .select(docCols)
    .eq('id', facturaDocId)
    .maybeSingle();
  if (facturaErr) return { ok: false, error: facturaErr.message };
  const factura = facturaData as AfipDocRow | null;
  if (!factura) return { ok: false, error: 'Factura no encontrada' };

  // Validaciones de la factura
  if (factura.tenant_id !== tenantId) {
    return { ok: false, error: 'La factura no pertenece a tu tenant' };
  }
  if (factura.doc_type !== 'factura') {
    return { ok: false, error: 'El documento indicado no es una factura' };
  }
  if (factura.status !== 'authorized') {
    return { ok: false, error: 'Solo se puede emitir una Nota de Crédito sobre una factura autorizada' };
  }
  if (factura.voucher_number == null) {
    return { ok: false, error: 'La factura no tiene número de comprobante asignado' };
  }

  // Idempotencia: NC ya emitida sobre esta factura.
  const { data: existingNc, error: existErr } = await admin
    .from('afip_documents')
    .select(docCols + ', qr_url')
    .eq('related_doc_id', factura.id)
    .eq('doc_type', 'nota_credito')
    .in('status', ['authorized', 'pending'])
    .maybeSingle();
  if (existErr) return { ok: false, error: existErr.message };
  if (existingNc && existingNc.status === 'authorized') {
    return {
      ok: true,
      already_emitted: true,
      documentId: existingNc.id,
      cae: existingNc.cae ?? undefined,
      voucherNumber: existingNc.voucher_number ?? undefined,
      caeDueDate: existingNc.cae_due_date ?? undefined,
      ptoVta: existingNc.sales_point,
      cbteTipo: existingNc.doc_letter,
      qrUrl: existingNc.qr_url ?? undefined,
    };
  }

  // Credenciales AFIP.
  const { data: credsRows, error: credsErr } = await admin.rpc('afip_get_credentials', {
    p_tenant_id: tenantId,
    p_encryption_key: encryptionKey,
  });
  if (credsErr) return { ok: false, error: `Error credenciales: ${credsErr.message}` };
  const creds = Array.isArray(credsRows) ? credsRows[0] : credsRows;
  if (!creds) return { ok: false, error: 'AFIP no configurado para este tenant' };
  if (!creds.is_active) return { ok: false, error: 'AFIP pausado' };

  const env = creds.environment as AfipEnv;
  const ptoVta = creds.sales_point as number;
  const cuit = creds.cuit as string;

  // cbteTipo de la NC (numeración independiente — gotcha error 10016).
  const cbteTipoNC = creditNoteCbteTipo(factura.doc_letter);

  // Importes: se copian EXACTOS del raw_request de la factura original.
  const raw = factura.raw_request;
  if (!raw) {
    return {
      ok: false,
      error:
        'La factura original no tiene los importes guardados (factura antigua). ' +
        'No se puede acreditar automáticamente — generá la Nota de Crédito de forma manual.',
    };
  }

  // Reservar el slot: insertar afip_document pending nuevo para la NC, o
  // actualizar el doc NC existente (path de retry).
  // TODO A5b: feCompConsultar para detectar timeout que AFIP sí autorizó.
  let ncId: string;
  if (existingDocId) {
    await incrementRetryCount(admin, existingDocId);
    const { data: updRow, error: updErr } = await admin
      .from('afip_documents')
      .update({
        status: 'pending',
        sales_point: ptoVta,
        related_doc_id: factura.id,
        environment: env,
        last_retry_at: new Date().toISOString(),
      })
      .eq('id', existingDocId)
      .select('id')
      .single();
    if (updErr) return { ok: false, error: `Error actualizando afip_document de la NC: ${updErr.message}` };
    ncId = updRow.id;
  } else {
    const { data: ncRow, error: ncInsErr } = await admin
      .from('afip_documents')
      .insert({
        tenant_id: tenantId,
        sale_id: factura.sale_id,
        doc_type: 'nota_credito',
        doc_letter: factura.doc_letter,
        sales_point: ptoVta,
        related_doc_id: factura.id,
        status: 'pending',
        environment: env,
      })
      .select('id')
      .single();
    if (ncInsErr) return { ok: false, error: `Error insertando afip_document de la NC: ${ncInsErr.message}` };
    ncId = ncRow.id;
  }

  try {
    // WSAA: obtener TA
    const ta = await getTicketAccess({
      admin,
      tenantId,
      service: 'wsfe',
      env,
      certPem: creds.cert_pem,
      keyPem: creds.key_pem,
    });
    const auth = { ta, cuit, env };

    // WSFEv1: último número para el cbteTipo de la NC (numeración independiente).
    const last = await feCompUltimoAutorizado(auth, ptoVta, cbteTipoNC);
    const nextNumber = last + 1;

    // Fecha del comprobante: hoy.
    const today = new Date();
    const cbteFch = fmtDate(today);
    const cbteFchIso = `${cbteFch.slice(0, 4)}-${cbteFch.slice(4, 6)}-${cbteFch.slice(6, 8)}`;

    // Comprobante asociado: la factura original. El Cuit es el del EMISOR
    // (el tenant). cbteFch acá es la fecha de la factura original.
    const cbtesAsoc: CbteAsoc[] = [
      {
        tipo: facturaCbteTipo(factura),
        ptoVta: factura.sales_point,
        nro: factura.voucher_number,
        cuit,
        cbteFch: raw.cbteFch,
      },
    ];

    // Todos los importes y datos del receptor se copian del raw_request de
    // la factura. NO se recalcula nada (riesgo error 10063).
    const voucherRequest: VoucherRequest = {
      cbteTipo: cbteTipoNC,
      ptoVta,
      concepto: raw.concepto,
      docTipo: raw.docTipo,
      docNro: raw.docNro,
      cbteFch,
      impTotal: raw.impTotal,
      impNeto: raw.impNeto,
      impIVA: raw.impIVA,
      impTotConc: raw.impTotConc,
      impOpEx: raw.impOpEx,
      impTrib: raw.impTrib,
      monId: raw.monId,
      monCotiz: raw.monCotiz,
      condicionIVAReceptorId: raw.condicionIVAReceptorId,
      iva: raw.iva,
      cbtesAsoc,
    };

    const resp = await feCAESolicitar(auth, ptoVta, nextNumber, voucherRequest);

    if (resp.resultado !== 'A') {
      const obsTxt = resp.observaciones.map((o) => `${o.code}:${o.msg}`).join(' | ');
      const errTxt = resp.errores.map((e) => `${e.code}:${e.msg}`).join(' | ');
      const detail =
        [obsTxt, errTxt].filter(Boolean).join(' || ') || `Resultado ${resp.resultado}`;
      await admin
        .from('afip_documents')
        .update({
          status: 'rejected',
          voucher_number: nextNumber,
          error_message: detail.slice(0, 500),
          raw_request: voucherRequest,
          raw_response: resp,
        })
        .eq('id', ncId);
      return {
        ok: false,
        error: `AFIP rechazó la Nota de Crédito: ${detail}`,
        documentId: ncId,
      };
    }

    // OK: autorizar + QR.
    const caeFchVtoIso = `${resp.caeFchVto.slice(0, 4)}-${resp.caeFchVto.slice(4, 6)}-${resp.caeFchVto.slice(6, 8)}`;
    const qrUrl = buildQrUrl({
      cuit,
      ptoVta,
      tipoCmp: cbteTipoNC,
      nroCmp: nextNumber,
      fecha: cbteFchIso,
      importe: raw.impTotal,
      cae: resp.cae,
      tipoDocRec: raw.docTipo,
      nroDocRec: raw.docNro === '0' ? 0 : Number(raw.docNro),
    });

    await admin
      .from('afip_documents')
      .update({
        status: 'authorized',
        voucher_number: nextNumber,
        cae: resp.cae,
        cae_due_date: caeFchVtoIso,
        qr_url: qrUrl,
        raw_request: voucherRequest,
        raw_response: resp,
        emitted_at: new Date().toISOString(),
      })
      .eq('id', ncId);

    return {
      ok: true,
      documentId: ncId,
      cae: resp.cae,
      voucherNumber: nextNumber,
      caeDueDate: caeFchVtoIso,
      ptoVta,
      cbteTipo: factura.doc_letter,
      qrUrl,
      environment: env,
    };
  } catch (err) {
    const msg = (err as Error).message;
    await admin
      .from('afip_documents')
      .update({
        status: 'rejected',
        error_message: msg.slice(0, 500),
      })
      .eq('id', ncId);
    return { ok: false, error: msg, documentId: ncId };
  }
}

// ---------------------------------------------------------------------
// Helpers internos de retry
// ---------------------------------------------------------------------

/**
 * Incrementa retry_count en 1 sobre un afip_documents. supabase-js no permite
 * `col = col + 1` desde el query builder, así que leemos el valor actual y lo
 * escribimos +1. No es atómico, pero los retries de un mismo documento son
 * secuenciales (un cajero a la vez), así que el riesgo de race es nulo en la
 * práctica.
 */
async function incrementRetryCount(admin: SupabaseClient, docId: string): Promise<void> {
  const { data } = await admin
    .from('afip_documents')
    .select('retry_count')
    .eq('id', docId)
    .maybeSingle();
  const current = Number(data?.retry_count ?? 0);
  await admin
    .from('afip_documents')
    .update({ retry_count: current + 1 })
    .eq('id', docId);
}
