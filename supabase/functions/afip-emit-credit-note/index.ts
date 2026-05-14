// =====================================================================
// Edge Function: afip-emit-credit-note
// =====================================================================
// Sprint A4: emite una Nota de Crédito AFIP vinculada a una factura
// original ya autorizada.
//
// Body (dos modos):
//   { mode: 'void', saleId: string }
//     → anula la venta facturada (void_sale_atomic) + emite NC del total.
//   { mode: 'manual', afipDocumentId: string, reason?: string }
//     → emite NC manual sobre una factura, SIN anular la venta.
//
// Flow:
//   1. CORS + parseo + validación del body.
//   2. Auth: caller debe ser miembro activo del tenant.
//   3. Leer AFIP_VAULT_KEY.
//   4. Crear admin client (service role).
//   5. Cargar la factura original (afip_documents) según el modo.
//   6. Idempotencia: si ya hay una NC authorized para esa factura, devolverla.
//   7. mode='void': void_sale_atomic ANTES de emitir (si falla, abortar).
//   8. Cargar credenciales AFIP descifradas.
//   9. cbteTipo de la NC = creditNoteCbteTipo(letra de la factura).
//   10. Importes: se COPIAN EXACTOS del raw_request de la factura
//       (recalcular = riesgo error 10063 "no cuadra").
//   11. Insertar afip_document pending (doc_type='nota_credito').
//   12. WSAA: obtener TA.
//   13. WSFEv1: FECompUltimoAutorizado para el cbteTipo de la NC (NO el de
//       la factura — numeración independiente, gotcha error 10016).
//   14. cbteFch de la NC = hoy.
//   15. FECAESolicitar con cbtesAsoc apuntando a la factura original.
//   16. Si rechaza → status='rejected'. Si OK → 'authorized' + QR.
//
// Errores de validación → HTTP 400 { error }.
// Errores de AFIP / fallo de emisión → HTTP 200 { ok:false, error, voided? }.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getTicketAccess, type AfipEnv } from '../_shared/afip-wsaa.ts';
import {
  CBTE_TIPO,
  feCAESolicitar,
  feCompUltimoAutorizado,
  type CbteAsoc,
  type IvaAlicuota,
  type VoucherRequest,
} from '../_shared/afip-wsfev1.ts';
import { creditNoteCbteTipo } from '../_shared/afip-letter.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

type Body =
  | { mode: 'void'; saleId: string }
  | { mode: 'manual'; afipDocumentId: string; reason?: string };

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
// afip_documents.raw_request por afip-emit-voucher. Es la fuente de
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
  tipoDocRec?: number;
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

    // --- 1. Validación del body -------------------------------------
    if (!body || (body.mode !== 'void' && body.mode !== 'manual')) {
      return jsonResponse({ error: "mode debe ser 'void' o 'manual'" }, 400);
    }
    if (body.mode === 'void' && !body.saleId) {
      return jsonResponse({ error: "Falta saleId para mode='void'" }, 400);
    }
    if (body.mode === 'manual' && !body.afipDocumentId) {
      return jsonResponse({ error: "Falta afipDocumentId para mode='manual'" }, 400);
    }

    // --- 2. Auth ----------------------------------------------------
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

    // --- 3. AFIP_VAULT_KEY ------------------------------------------
    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      return jsonResponse({ error: 'Servidor sin AFIP_VAULT_KEY' }, 500);
    }

    // --- 4. admin client --------------------------------------------
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // --- 5. Cargar la factura original ------------------------------
    const docCols =
      'id, tenant_id, sale_id, doc_type, doc_letter, sales_point, ' +
      'voucher_number, cae, cae_due_date, status, related_doc_id, raw_request';

    let factura: AfipDocRow | null = null;
    if (body.mode === 'manual') {
      const { data, error } = await admin
        .from('afip_documents')
        .select(docCols)
        .eq('id', body.afipDocumentId)
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      factura = data as AfipDocRow | null;
      if (!factura) return jsonResponse({ error: 'Factura no encontrada' }, 404);
    } else {
      // mode='void': buscamos la factura authorized de esa venta.
      const { data, error } = await admin
        .from('afip_documents')
        .select(docCols)
        .eq('sale_id', body.saleId)
        .eq('doc_type', 'factura')
        .eq('status', 'authorized')
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      factura = data as AfipDocRow | null;
      if (!factura) {
        return jsonResponse(
          {
            error:
              'Esta venta no tiene una factura autorizada para anular fiscalmente. ' +
              'Anulala con la anulación normal de venta (no requiere Nota de Crédito).',
          },
          400,
        );
      }
    }

    // Validaciones de la factura
    if (factura.tenant_id !== tenantId) {
      return jsonResponse({ error: 'La factura no pertenece a tu tenant' }, 403);
    }
    if (factura.doc_type !== 'factura') {
      return jsonResponse(
        { error: 'El documento indicado no es una factura' },
        400,
      );
    }
    if (factura.status !== 'authorized') {
      return jsonResponse(
        { error: 'Solo se puede emitir una Nota de Crédito sobre una factura autorizada' },
        400,
      );
    }
    if (factura.voucher_number == null) {
      return jsonResponse(
        { error: 'La factura no tiene número de comprobante asignado' },
        400,
      );
    }

    // --- 6. Idempotencia: NC ya emitida sobre esta factura ----------
    const { data: existingNc, error: existErr } = await admin
      .from('afip_documents')
      .select(docCols + ', qr_url')
      .eq('related_doc_id', factura.id)
      .eq('doc_type', 'nota_credito')
      .in('status', ['authorized', 'pending'])
      .maybeSingle();
    if (existErr) return jsonResponse({ error: existErr.message }, 500);
    if (existingNc && existingNc.status === 'authorized') {
      return jsonResponse(
        {
          ok: true,
          already_emitted: true,
          documentId: existingNc.id,
          cae: existingNc.cae,
          voucherNumber: existingNc.voucher_number,
          caeDueDate: existingNc.cae_due_date,
          ptoVta: existingNc.sales_point,
          cbteTipo: existingNc.doc_letter,
          qrUrl: existingNc.qr_url,
        },
        200,
      );
    }

    // --- 7. mode='void': anular la venta ANTES de emitir ------------
    let voided = false;
    if (body.mode === 'void') {
      const { error: voidErr } = await admin.rpc('void_sale_atomic', {
        p_tenant_id: tenantId,
        p_sale_id: body.saleId,
      });
      if (voidErr) {
        return jsonResponse(
          {
            ok: false,
            error: `No se pudo anular la venta, no se emite la Nota de Crédito: ${voidErr.message}`,
            voided: false,
          },
          200,
        );
      }
      voided = true;
    }

    // --- 8. Credenciales AFIP ---------------------------------------
    const { data: credsRows, error: credsErr } = await admin.rpc('afip_get_credentials', {
      p_tenant_id: tenantId,
      p_encryption_key: encryptionKey,
    });
    if (credsErr) {
      return jsonResponse(
        { ok: false, error: `Error credenciales: ${credsErr.message}`, voided },
        200,
      );
    }
    const creds = Array.isArray(credsRows) ? credsRows[0] : credsRows;
    if (!creds) {
      return jsonResponse(
        { ok: false, error: 'AFIP no configurado para este tenant', voided },
        200,
      );
    }
    if (!creds.is_active) {
      return jsonResponse({ ok: false, error: 'AFIP pausado', voided }, 200);
    }

    const env = creds.environment as AfipEnv;
    const ptoVta = creds.sales_point as number;
    const cuit = creds.cuit as string;

    // --- 9. cbteTipo de la NC (numeración independiente) ------------
    const cbteTipoNC = creditNoteCbteTipo(factura.doc_letter);

    // --- 10. Importes: se copian EXACTOS del raw_request ------------
    const raw = factura.raw_request;
    if (!raw) {
      return jsonResponse(
        {
          ok: false,
          error:
            'La factura original no tiene los importes guardados (factura antigua). ' +
            'No se puede acreditar automáticamente — generá la Nota de Crédito de forma manual.',
          voided,
        },
        200,
      );
    }

    // --- 11. Insertar afip_document pending para la NC --------------
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
      })
      .select('id')
      .single();
    if (ncInsErr) {
      return jsonResponse(
        {
          ok: false,
          error: `Error insertando afip_document de la NC: ${ncInsErr.message}`,
          voided,
        },
        200,
      );
    }

    try {
      // --- 12. WSAA: obtener TA -------------------------------------
      const ta = await getTicketAccess({
        admin,
        tenantId,
        service: 'wsfe',
        env,
        certPem: creds.cert_pem,
        keyPem: creds.key_pem,
      });
      const auth = { ta, cuit, env };

      // --- 13. WSFEv1: último número para el cbteTipo de la NC ------
      // OJO: pedimos el último de cbteTipoNC (3/8/13), NO del tipo de la
      // factura. La numeración de NC es independiente (gotcha error 10016).
      const last = await feCompUltimoAutorizado(auth, ptoVta, cbteTipoNC);
      const nextNumber = last + 1;

      // --- 14. Fecha del comprobante: hoy --------------------------
      const today = new Date();
      const cbteFch = fmtDate(today);
      const cbteFchIso = `${cbteFch.slice(0, 4)}-${cbteFch.slice(4, 6)}-${cbteFch.slice(6, 8)}`;

      // --- 15. VoucherRequest de la NC -----------------------------
      // Comprobante asociado: la factura original. El Cuit es el del
      // EMISOR (el tenant), no el del receptor. cbteFch acá es la fecha
      // de la factura original (la de la NC es HOY).
      const cbtesAsoc: CbteAsoc[] = [
        {
          tipo: facturaCbteTipo(factura),
          ptoVta: factura.sales_point,
          nro: factura.voucher_number,
          cuit,
          cbteFch: raw.cbteFch,
        },
      ];

      // Todos los importes y datos del receptor se copian del raw_request
      // de la factura. NO se recalcula nada (riesgo error 10063).
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

      // --- 16. Rechazo AFIP ----------------------------------------
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
          .eq('id', ncRow.id);
        return jsonResponse(
          {
            ok: false,
            error: `AFIP rechazó la Nota de Crédito: ${detail}`,
            documentId: ncRow.id,
            voided,
          },
          200,
        );
      }

      // --- 17. OK: autorizar + QR ----------------------------------
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
        .eq('id', ncRow.id);

      return jsonResponse(
        {
          ok: true,
          documentId: ncRow.id,
          cae: resp.cae,
          voucherNumber: nextNumber,
          caeDueDate: caeFchVtoIso,
          ptoVta,
          cbteTipo: factura.doc_letter,
          qrUrl,
          voided,
          environment: env,
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
        .eq('id', ncRow.id);
      return jsonResponse(
        { ok: false, error: msg, documentId: ncRow.id, voided },
        200,
      );
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
