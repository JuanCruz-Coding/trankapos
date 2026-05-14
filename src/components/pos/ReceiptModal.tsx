import { useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatARS } from '@/lib/currency';
import { getSupabase } from '@/lib/supabase';
import { buildAfipQrUrl, letterToCbteTipo } from '@/lib/afipQr';
import type { Sale, Tenant } from '@/types';

/**
 * Modos:
 *  - 'emit': post-venta en el POS. Si no hay afip_document para esta sale,
 *           intenta emitir contra AFIP. Es el flujo que dispara al cobrar.
 *  - 'view': reimpresión / consulta en /sales. Solo lee afip_documents.
 *           Nunca emite. Si no hay doc, oculta el bloque AFIP.
 */
export type ReceiptMode = 'emit' | 'view';

interface AfipDocState {
  status: 'idle' | 'emitting' | 'authorized' | 'rejected' | 'skip';
  cae?: string;
  voucherNumber?: number;
  caeDueDate?: string;
  ptoVta?: number;
  cbteTipo?: string; // 'A' | 'B' | 'C'
  qrUrl?: string;
  error?: string;
  receiver?: {
    docType: number;
    docNumber: string;
    legalName: string | null;
    ivaCondition: string | null;
  } | null;
}

function useAfipDocumentFor(
  sale: Sale | null,
  tenant: Tenant | null,
  mode: ReceiptMode,
): AfipDocState {
  const [state, setState] = useState<AfipDocState>({ status: 'idle' });
  useEffect(() => {
    if (!sale) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sb = getSupabase();
        // 1) ¿ya existe afip_document authorized para esta sale?
        const { data: existing } = await sb
          .from('afip_documents')
          .select('cae, voucher_number, cae_due_date, sales_point, doc_letter, status')
          .eq('sale_id', sale.id)
          .eq('status', 'authorized')
          .maybeSingle();
        if (cancelled) return;

        if (existing?.cae) {
          // Reconstruimos el QR client-side para que /sales no dependa del
          // qrUrl que devolvió el backend al emitir.
          const letter = existing.doc_letter as 'A' | 'B' | 'C';
          const qrUrl = tenant?.taxId
            ? buildAfipQrUrl({
                cuit: tenant.taxId,
                ptoVta: existing.sales_point,
                tipoCmp: letterToCbteTipo(letter),
                nroCmp: existing.voucher_number,
                fecha: sale.createdAt.slice(0, 10),
                importe: sale.total,
                cae: existing.cae,
                tipoDocRec: sale.customerDocType ?? 99,
                nroDocRec: sale.customerDocNumber ? Number(sale.customerDocNumber) : 0,
              })
            : undefined;

          setState({
            status: 'authorized',
            cae: existing.cae,
            voucherNumber: existing.voucher_number,
            caeDueDate: existing.cae_due_date,
            ptoVta: existing.sales_point,
            cbteTipo: existing.doc_letter,
            qrUrl,
            receiver: sale.customerDocNumber
              ? {
                  docType: sale.customerDocType ?? 99,
                  docNumber: sale.customerDocNumber,
                  legalName: sale.customerLegalName ?? null,
                  ivaCondition: sale.customerIvaCondition ?? null,
                }
              : null,
          });
          return;
        }

        // Si estamos en modo view, no intentamos emitir nada.
        if (mode === 'view') {
          setState({ status: 'skip' });
          return;
        }

        // 2) ¿tenant tiene AFIP activo? Si no, no intentamos emitir.
        const { data: creds } = await sb
          .from('tenant_afip_credentials')
          .select('is_active, last_test_ok')
          .maybeSingle();
        if (cancelled) return;
        if (!creds?.is_active || creds?.last_test_ok !== true) {
          setState({ status: 'skip' });
          return;
        }

        // 3) Emitir
        setState({ status: 'emitting' });
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('No autenticado');

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-emit-voucher`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify({ saleId: sale.id }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          cae?: string;
          voucherNumber?: number;
          caeDueDate?: string;
          ptoVta?: number;
          cbteTipo?: string;
          qrUrl?: string;
          error?: string;
          receiver?: AfipDocState['receiver'];
        };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setState({ status: 'rejected', error: body.error ?? `Error HTTP ${res.status}` });
          return;
        }
        setState({
          status: 'authorized',
          cae: body.cae,
          voucherNumber: body.voucherNumber,
          caeDueDate: body.caeDueDate,
          ptoVta: body.ptoVta,
          cbteTipo: body.cbteTipo,
          qrUrl: body.qrUrl,
          receiver: body.receiver ?? null,
        });
      } catch (err) {
        if (!cancelled) setState({ status: 'rejected', error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sale, tenant, mode]);
  return state;
}

interface Props {
  sale: Sale | null;
  tenant: Tenant | null;
  onClose: () => void;
  mode?: ReceiptMode;
}

export function ReceiptModal({ sale, tenant, onClose, mode = 'emit' }: Props) {
  const afip = useAfipDocumentFor(sale, tenant, mode);
  if (!sale) return null;

  const businessName = tenant?.legalName || tenant?.name || 'TrankaPOS';
  const ticketTitle =
    afip.status === 'authorized' && afip.cbteTipo
      ? `Factura ${afip.cbteTipo}`
      : tenant?.ticketTitle ?? 'Comprobante no fiscal';
  const ticketFooter = tenant?.ticketFooter ?? '¡Gracias por su compra!';
  const showLogo = tenant?.ticketShowLogo ?? true;
  const showTaxId = (tenant?.ticketShowTaxId ?? true) && !!tenant?.taxId;
  const widthMm = tenant?.ticketWidthMm ?? 80;
  const modalWidth = widthMm === 58 ? 'max-w-[280px]' : 'max-w-sm';

  return (
    <Modal open onClose={onClose} title="Ticket" widthClass={modalWidth}>
      <div id="receipt-print" className="font-mono text-xs text-slate-800">
        <div className="text-center">
          {showLogo && (
            <img
              src={tenant?.logoUrl || '/brand/isotipo.png'}
              alt="logo"
              className="mx-auto mb-1 h-12 w-12 object-contain"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== `${window.location.origin}/brand/isotipo.png`) {
                  img.src = '/brand/isotipo.png';
                }
              }}
            />
          )}
          <div className="font-bold">{businessName}</div>
          {showTaxId && <div className="text-[10px]">CUIT: {tenant!.taxId}</div>}
          <div>{ticketTitle}</div>
          {afip.status === 'authorized' && afip.ptoVta !== undefined && afip.voucherNumber !== undefined && (
            <div className="font-bold">
              Nº {String(afip.ptoVta).padStart(5, '0')}-{String(afip.voucherNumber).padStart(8, '0')}
            </div>
          )}
          <div>{new Date(sale.createdAt).toLocaleString('es-AR')}</div>
          <div>#{sale.id.slice(0, 8)}</div>
        </div>

        {afip.status === 'authorized' && afip.receiver && (
          <>
            <hr className="my-2 border-dashed" />
            <div className="text-[10px]">
              <div><strong>Cliente:</strong> {afip.receiver.legalName ?? 'Sin nombre'}</div>
              <div>
                <strong>{afip.receiver.docType === 80 ? 'CUIT' : afip.receiver.docType === 86 ? 'CUIL' : 'DNI'}:</strong>{' '}
                {afip.receiver.docNumber}
              </div>
              {afip.receiver.ivaCondition && (
                <div className="text-slate-600">{labelIvaCondition(afip.receiver.ivaCondition)}</div>
              )}
            </div>
          </>
        )}

        <hr className="my-2 border-dashed" />
        {sale.items.map((it) => (
          <div key={it.id} className="mb-1">
            <div className="flex justify-between">
              <span className="truncate pr-2">{it.name}</span>
              <span>{formatARS(it.subtotal)}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              {it.qty} × {formatARS(it.price)}
              {it.discount > 0 ? ` (-${formatARS(it.discount)})` : ''}
            </div>
          </div>
        ))}
        <hr className="my-2 border-dashed" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatARS(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>-{formatARS(sale.discount)}</span>
          </div>
        )}
        {afip.status === 'authorized' && afip.cbteTipo === 'A' && (() => {
          const totalConIva = sale.total;
          const baseImp = Math.round((totalConIva / 1.21) * 100) / 100;
          const iva = Math.round((totalConIva - baseImp) * 100) / 100;
          return (
            <>
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>Neto</span>
                <span>{formatARS(baseImp)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>IVA 21%</span>
                <span>{formatARS(iva)}</span>
              </div>
            </>
          );
        })()}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatARS(sale.total)}</span>
        </div>
        <hr className="my-2 border-dashed" />
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span className="capitalize">{p.method}</span>
            <span>{formatARS(p.amount)}</span>
          </div>
        ))}

        {/* Bloque AFIP */}
        {afip.status === 'emitting' && (
          <>
            <hr className="my-2 border-dashed" />
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Solicitando CAE a AFIP…
            </div>
          </>
        )}
        {afip.status === 'authorized' && afip.cae && (
          <>
            <hr className="my-2 border-dashed" />
            <div className="text-center text-[10px]">
              {afip.qrUrl && (
                <div className="mx-auto mb-1 inline-block rounded bg-white p-1">
                  <QRCodeSVG value={afip.qrUrl} size={80} level="M" />
                </div>
              )}
              <div><strong>CAE:</strong> {afip.cae}</div>
              {afip.caeDueDate && (
                <div>
                  <strong>Vto CAE:</strong>{' '}
                  {new Date(afip.caeDueDate + 'T00:00:00').toLocaleDateString('es-AR')}
                </div>
              )}
            </div>
          </>
        )}
        {afip.status === 'rejected' && (
          <>
            <hr className="my-2 border-dashed" />
            <div className="text-center text-[10px] text-red-700">
              <strong>AFIP rechazó:</strong> {afip.error?.slice(0, 120) ?? 'error desconocido'}
            </div>
          </>
        )}

        {ticketFooter && (
          <>
            <hr className="my-2 border-dashed" />
            <div className="whitespace-pre-line text-center">{ticketFooter}</div>
          </>
        )}
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cerrar
        </Button>
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>
    </Modal>
  );
}

function labelIvaCondition(cond: string): string {
  switch (cond) {
    case 'responsable_inscripto': return 'Responsable Inscripto';
    case 'monotributista': return 'Monotributista';
    case 'exento': return 'Exento';
    case 'consumidor_final': return 'Consumidor Final';
    case 'no_categorizado': return 'No Categorizado';
    default: return cond;
  }
}
