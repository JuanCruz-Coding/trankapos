// =====================================================================
// Edge Function: afip-emit-voucher
// =====================================================================
// Sprint A2: emite Factura C (monotributo) para una sale del POS.
// Otras letras (A/B) llegan en Sprint A3 con soporte de IVA + CRM.
//
// Body:
//   { saleId: string }
//
// Flow:
//   1. Auth: caller debe ser miembro del tenant dueño de la sale.
//   2. Cargar sale + tenant + credenciales AFIP descifradas.
//   3. Validar tenant.taxCondition = 'monotributista' (por ahora).
//   4. Verificar idempotencia: si ya hay afip_document authorized para esta sale, retornar el existente.
//   5. Insertar afip_document pending (locks la idempotencia).
//   6. WSAA: obtener TA.
//   7. WSFEv1: FECompUltimoAutorizado → último N + 1 = N+1.
//   8. WSFEv1: FECAESolicitar con N+1.
//   9. Actualizar afip_document con resultado.
//   10. Devolver { cae, voucherNumber, caeDueDate, qrUrl }.
//
// Errores: si AFIP rechaza, afip_document queda status='rejected' con
// error_message. El cajero ve el error en el frontend pero la sale ya
// existe en TrankaPos (no se rollback — fiscal y operativo son independientes).
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getTicketAccess, type AfipEnv } from '../_shared/afip-wsaa.ts';
import {
  AFIP_ANON_MAX_AMOUNT,
  DOC_TIPO,
  computeIvaBreakdown,
  feCAESolicitar,
  feCompUltimoAutorizado,
} from '../_shared/afip-wsfev1.ts';
import {
  classifyVoucher,
  isClassificationError,
  type EmitterTaxCondition,
  type ReceiverDocType,
  type ReceiverIvaCondition,
} from '../_shared/afip-letter.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface Body {
  saleId: string;
}

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

interface SaleItemForIva {
  subtotal: string | number;
  product_id: string;
}

interface TenantRow {
  id: string;
  tax_condition: string;
}

// AFIP yyyymmdd
function fmtDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// Genera el contenido del QR fiscal AFIP. Formato oficial:
// https://www.afip.gob.ar/fe/qr/?p=<base64>
// donde <base64> es JSON con los datos del comprobante.
function buildQrUrl(args: {
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
    if (!body.saleId) return jsonResponse({ error: 'Falta saleId' }, 400);

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
    const tenantId = mem.tenant_id;

    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      return jsonResponse({ error: 'Servidor sin AFIP_VAULT_KEY' }, 500);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Cargar sale (incluye snapshot del receptor para clasificar la letra)
    const { data: saleData, error: saleErr } = await admin
      .from('sales')
      .select(
        'id, tenant_id, total, discount, status, voided, created_at, ' +
          'customer_doc_type, customer_doc_number, customer_legal_name, customer_iva_condition',
      )
      .eq('id', body.saleId)
      .maybeSingle();
    if (saleErr) return jsonResponse({ error: saleErr.message }, 500);
    const sale = saleData as SaleRow | null;
    if (!sale) return jsonResponse({ error: 'Sale no encontrada' }, 404);
    if (sale.tenant_id !== tenantId) {
      return jsonResponse({ error: 'Sale no pertenece a tu tenant' }, 403);
    }
    if (sale.voided) {
      return jsonResponse({ error: 'No se puede facturar una venta anulada' }, 400);
    }

    // Idempotencia: si ya hay un afip_document authorized, retornarlo.
    const { data: existing } = await admin
      .from('afip_documents')
      .select('id, doc_type, doc_letter, sales_point, voucher_number, cae, cae_due_date, status, error_message')
      .eq('tenant_id', tenantId)
      .eq('sale_id', sale.id)
      .in('status', ['authorized', 'pending'])
      .maybeSingle();
    if (existing?.status === 'authorized') {
      return jsonResponse(
        {
          ok: true,
          already_emitted: true,
          documentId: existing.id,
          cae: existing.cae,
          voucherNumber: existing.voucher_number,
          caeDueDate: existing.cae_due_date,
          ptoVta: existing.sales_point,
          cbteTipo: existing.doc_letter,
        },
        200,
      );
    }

    // Cargar tenant y credenciales
    const { data: tenantData, error: tenErr } = await admin
      .from('tenants')
      .select('id, tax_condition')
      .eq('id', tenantId)
      .single();
    if (tenErr) return jsonResponse({ error: tenErr.message }, 500);
    const tenant = tenantData as TenantRow;

    // Clasificar el voucher según matriz fiscal (emisor + receptor).
    // Devuelve letter A/B/C + cbteTipo + docTipo/docNro + CondIVAReceptor,
    // o un error explicativo si la combinación no es válida.
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
      return jsonResponse(
        { error: classification.message, code: classification.code },
        400,
      );
    }

    // RG 5616/2024: Factura B a consumidor anónimo no puede superar un monto.
    const totalNum = Number(sale.total);
    if (
      classification.letter === 'B' &&
      classification.docTipo === DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO &&
      totalNum > AFIP_ANON_MAX_AMOUNT
    ) {
      return jsonResponse(
        {
          error: `Las facturas B a consumidor anónimo por más de $${AFIP_ANON_MAX_AMOUNT.toLocaleString('es-AR')} requieren identificar al receptor (DNI o CUIT). Volvé al carrito y agregá los datos del cliente.`,
          code: 'RECEPTOR_REQUIRED',
        },
        400,
      );
    }

    const { data: credsRows, error: credsErr } = await admin.rpc('afip_get_credentials', {
      p_tenant_id: tenantId,
      p_encryption_key: encryptionKey,
    });
    if (credsErr) return jsonResponse({ error: `Error credenciales: ${credsErr.message}` }, 500);
    const creds = Array.isArray(credsRows) ? credsRows[0] : credsRows;
    if (!creds) return jsonResponse({ error: 'AFIP no configurado para este tenant' }, 400);
    if (!creds.is_active) return jsonResponse({ error: 'AFIP pausado' }, 400);

    const env = creds.environment as AfipEnv;
    const ptoVta = creds.sales_point as number;
    const cuit = creds.cuit as string;

    // Insertar afip_document pending para reservar el slot.
    const { data: docRow, error: docInsErr } = await admin
      .from('afip_documents')
      .insert({
        tenant_id: tenantId,
        sale_id: sale.id,
        doc_type: 'factura',
        doc_letter: classification.letter,
        sales_point: ptoVta,
        status: 'pending',
      })
      .select('id')
      .single();
    if (docInsErr) return jsonResponse({ error: `Error insertando afip_document: ${docInsErr.message}` }, 500);

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

      const resp = await feCAESolicitar(auth, ptoVta, nextNumber, {
        cbteTipo: classification.cbteTipo,
        ptoVta,
        concepto: 1, // 1 = Productos
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
      });

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
            raw_response: resp,
          })
          .eq('id', docRow.id);
        return jsonResponse(
          { ok: false, error: `AFIP rechazó: ${detail}`, documentId: docRow.id },
          200,
        );
      }

      // OK: autorizar el documento
      const caeFchVtoIso = `${resp.caeFchVto.slice(0, 4)}-${resp.caeFchVto.slice(4, 6)}-${resp.caeFchVto.slice(6, 8)}`;
      await admin
        .from('afip_documents')
        .update({
          status: 'authorized',
          voucher_number: nextNumber,
          cae: resp.cae,
          cae_due_date: caeFchVtoIso,
          raw_response: resp,
          emitted_at: new Date().toISOString(),
        })
        .eq('id', docRow.id);

      // Construir QR fiscal AFIP — con tipo real y datos del receptor reales.
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

      return jsonResponse(
        {
          ok: true,
          documentId: docRow.id,
          cae: resp.cae,
          voucherNumber: nextNumber,
          caeDueDate: caeFchVtoIso,
          ptoVta,
          cbteTipo: classification.letter,
          qrUrl,
          environment: env,
          // Snapshot del receptor (para que el frontend muestre el bloque en A)
          receiver: classification.docNro !== '0' ? {
            docType: classification.docTipo,
            docNumber: classification.docNro,
            legalName: sale.customer_legal_name ?? null,
            ivaCondition: sale.customer_iva_condition ?? null,
          } : null,
        },
        200,
      );
    } catch (err) {
      const msg = (err as Error).message;
      await admin
        .from('afip_documents')
        .update({
          status: 'rejected',
          error_message: msg.slice(0, 500),
        })
        .eq('id', docRow.id);
      return jsonResponse({ ok: false, error: msg, documentId: docRow.id }, 200);
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
