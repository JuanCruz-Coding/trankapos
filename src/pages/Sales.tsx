import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, CircleDollarSign, Eye, FileMinus, Receipt, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { formatDateTime } from '@/lib/dates';
import { addMoney, subMoney } from '@/lib/money';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { PAYMENT_METHODS, type PaymentMethod, type Sale } from '@/types';
import type { AfipDocumentSummary } from '@/data/driver';
import { usePermission } from '@/lib/permissions';

/** Formatea el número de comprobante AFIP: ptoVta-voucherNumber con padding. */
function formatVoucherNumber(doc: AfipDocumentSummary): string {
  const pv = String(doc.salesPoint).padStart(5, '0');
  const nro = String(doc.voucherNumber ?? 0).padStart(8, '0');
  return `${pv}-${nro}`;
}

const PAGE_SIZE = 50;

export default function Sales() {
  const { session, activeBranchId } = useAuth();
  const canVoidSales = usePermission('void_sales');
  const [refreshKey, setRefreshKey] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sales = useLiveQuery(
    () => data.listSales({ branchId: activeBranchId ?? undefined, limit }),
    [session?.tenantId, activeBranchId, refreshKey, limit],
  );
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId]);
  const tenant = useLiveQuery(() => data.getTenant(), [session?.tenantId]);
  const [view, setView] = useState<Sale | null>(null);
  const [ticketFor, setTicketFor] = useState<Sale | null>(null);
  const [collectFor, setCollectFor] = useState<Sale | null>(null);
  // Documentos AFIP por venta (factura + NC). Se cargan al cambiar la lista
  // de ventas visibles. Vacío para ventas sin facturación o en modo offline.
  const [afipDocs, setAfipDocs] = useState<Map<string, AfipDocumentSummary[]>>(new Map());
  // saleIds en proceso de anulación/emisión de NC (deshabilita botones).
  const [busySaleIds, setBusySaleIds] = useState<Set<string>>(new Set());

  // Carga los afip_documents de todas las ventas visibles en paralelo.
  useEffect(() => {
    if (!sales || sales.length === 0) {
      setAfipDocs(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(
          sales.map(async (s) => {
            const docs = await data.listAfipDocumentsForSale(s.id);
            return [s.id, docs] as const;
          }),
        );
        if (!cancelled) setAfipDocs(new Map(entries));
      } catch {
        // Modo offline o sin AFIP: dejamos el map vacío, no rompe nada.
        if (!cancelled) setAfipDocs(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sales, refreshKey]);

  /** La factura authorized de una venta, si la tiene. */
  function getAuthorizedInvoice(saleId: string): AfipDocumentSummary | null {
    const docs = afipDocs.get(saleId) ?? [];
    return docs.find((d) => d.docType === 'factura' && d.status === 'authorized') ?? null;
  }

  /** True si la venta ya tiene una NC authorized (no se puede emitir otra). */
  function hasAuthorizedCreditNote(saleId: string): boolean {
    const docs = afipDocs.get(saleId) ?? [];
    return docs.some((d) => d.docType === 'nota_credito' && d.status === 'authorized');
  }

  function setBusy(saleId: string, busy: boolean) {
    setBusySaleIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(saleId);
      else next.delete(saleId);
      return next;
    });
  }

  async function handleVoid(s: Sale) {
    const invoice = getAuthorizedInvoice(s.id);

    // Caso 1: venta sin factura → anulación normal.
    if (!invoice) {
      const ok = await confirmDialog(`¿Anular venta por ${formatARS(s.total)}?`, {
        text:
          s.status === 'partial' && s.stockReservedMode
            ? 'Se libera el stock reservado. La seña se anula.'
            : 'Se devuelve el stock al depósito de origen.',
        confirmText: 'Anular venta',
        danger: true,
      });
      if (!ok) return;
      try {
        await data.voidSale(s.id);
        toast.success('Venta anulada');
        setRefreshKey((k) => k + 1);
      } catch (err) {
        toast.error((err as Error).message);
      }
      return;
    }

    // Caso 2: venta facturada → anular + emitir Nota de Crédito en AFIP.
    const ok = await confirmDialog(`¿Anular venta por ${formatARS(s.total)}?`, {
      text: `Esta venta tiene Factura ${invoice.docLetter} N° ${formatVoucherNumber(invoice)}. Se va a anular la venta y emitir una Nota de Crédito en AFIP.`,
      confirmText: 'Anular y emitir NC',
      danger: true,
    });
    if (!ok) return;

    setBusy(s.id, true);
    try {
      const result = await data.emitCreditNote({ mode: 'void', saleId: s.id });
      if (result.ok) {
        toast.success(`Venta anulada — NC ${result.cbteTipo ?? ''} emitida`);
      } else if (result.voided) {
        // La venta SÍ se anuló pero la NC fiscal falló: hay que reintentar.
        toast.error(
          `Venta anulada. La NC fiscal falló: ${result.error ?? 'error desconocido'}. Reintentá desde el ticket.`,
        );
      } else {
        toast.error(result.error ?? 'No se pudo anular la venta');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(s.id, false);
      setRefreshKey((k) => k + 1);
    }
  }

  // NC manual sobre una factura, sin anular la venta entera.
  async function handleEmitCreditNote(s: Sale) {
    const invoice = getAuthorizedInvoice(s.id);
    if (!invoice) return;

    const ok = await confirmDialog(
      `¿Emitir Nota de Crédito sobre la Factura ${invoice.docLetter} N° ${formatVoucherNumber(invoice)}?`,
      {
        text: 'Esto emite solo el comprobante fiscal — si hubo devolución de mercadería, ajustá el stock manualmente.',
        confirmText: 'Emitir NC',
        danger: true,
      },
    );
    if (!ok) return;

    setBusy(s.id, true);
    try {
      const result = await data.emitCreditNote({ mode: 'manual', afipDocumentId: invoice.id });
      if (result.ok) {
        toast.success(`NC ${result.cbteTipo ?? ''} emitida`);
      } else {
        toast.error(result.error ?? 'No se pudo emitir la Nota de Crédito');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(s.id, false);
      setRefreshKey((k) => k + 1);
    }
  }

  return (
    <div>
      <PageHeader title="Ventas" subtitle="Historial de tickets" />

      {(sales ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Aún no hay ventas registradas.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Cajero</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales!.map((s) => {
                const paid = addMoney(...s.payments.map((p) => p.amount));
                const remaining = subMoney(s.total, paid);
                const isBusy = busySaleIds.has(s.id);
                const canEmitCreditNote =
                  !s.voided && getAuthorizedInvoice(s.id) !== null && !hasAuthorizedCreditNote(s.id);
                return (
                  <tr key={s.id} className={s.voided ? 'opacity-50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3">{formatDateTime(s.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {users?.find((u) => u.id === s.cashierId)?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.items.reduce((a, i) => a + i.qty, 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatARS(s.total)}</td>
                    <td className="px-4 py-3">
                      {s.voided ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          Anulada
                        </span>
                      ) : s.status === 'partial' ? (
                        <span className="inline-flex flex-col items-start gap-0.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                            <span className="status-dot status-dot--orange" />
                            Seña
                          </span>
                          <span className="text-[11px] text-amber-700 tabular-nums">
                            saldo {formatARS(remaining)}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          <span className="status-dot status-dot--green" />
                          Ok
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {!s.voided && s.status === 'partial' && (
                          <button
                            onClick={() => setCollectFor(s)}
                            className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50"
                            title="Cobrar saldo"
                          >
                            <CircleDollarSign className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setView(s)}
                          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                          title="Ver detalle"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setTicketFor(s)}
                          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                          title="Ver ticket / factura"
                        >
                          <Receipt className="h-4 w-4" />
                        </button>
                        {canEmitCreditNote && canVoidSales && (
                          <button
                            onClick={() => handleEmitCreditNote(s)}
                            disabled={isBusy}
                            className="rounded-md p-2 text-slate-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40"
                            title="Emitir Nota de Crédito"
                          >
                            <FileMinus className="h-4 w-4" />
                          </button>
                        )}
                        {!s.voided && canVoidSales && (
                          <button
                            onClick={() => handleVoid(s)}
                            disabled={isBusy}
                            className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            title="Anular venta"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sales!.length >= limit && (
            <div className="border-t border-slate-100 bg-slate-50 p-3 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                Cargar más ventas
              </Button>
            </div>
          )}
        </div>
      )}

      {view && <SaleDetailModal sale={view} onClose={() => setView(null)} />}
      {ticketFor && (
        <ReceiptModal
          sale={ticketFor}
          tenant={tenant ?? null}
          mode="view"
          onClose={() => setTicketFor(null)}
        />
      )}
      {collectFor && (
        <CollectBalanceModal
          sale={collectFor}
          onClose={() => setCollectFor(null)}
          onSuccess={() => {
            setCollectFor(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function SaleDetailModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const paid = addMoney(...sale.payments.map((p) => p.amount));
  const remaining = subMoney(sale.total, paid);
  return (
    <Modal open onClose={onClose} title={`Venta ${sale.id.slice(0, 8)}`}>
      <div className="mb-3 text-xs text-slate-500">{formatDateTime(sale.createdAt)}</div>
      {sale.status === 'partial' && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <strong>Seña activa</strong> — saldo pendiente: {formatARS(remaining)}.
          {sale.stockReservedMode
            ? ' Stock reservado; se descuenta al cobrar el saldo.'
            : ' Stock ya descontado al hacer la seña.'}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Producto</th>
            <th className="py-1 text-right">Cant.</th>
            <th className="py-1 text-right">Precio</th>
            <th className="py-1 text-right">Subt.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sale.items.map((it) => (
            <tr key={it.id}>
              <td className="py-1">{it.name}</td>
              <td className="py-1 text-right">{it.qty}</td>
              <td className="py-1 text-right">{formatARS(it.price)}</td>
              <td className="py-1 text-right">{formatARS(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-3" />
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatARS(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Descuento</span>
            <span>-{formatARS(sale.discount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>{formatARS(sale.total)}</span>
        </div>
        {sale.status === 'partial' && (
          <>
            <div className="flex justify-between text-emerald-700">
              <span>Pagado</span>
              <span>{formatARS(paid)}</span>
            </div>
            <div className="flex justify-between font-semibold text-amber-700">
              <span>Saldo</span>
              <span>{formatARS(remaining)}</span>
            </div>
          </>
        )}
      </div>
      <hr className="my-3" />
      <div className="text-xs text-slate-600">
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span className="capitalize">{p.method}</span>
            <span>{formatARS(p.amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>
    </Modal>
  );
}

function CollectBalanceModal({
  sale,
  onClose,
  onSuccess,
}: {
  sale: Sale;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const paidSoFar = useMemo(() => addMoney(...sale.payments.map((p) => p.amount)), [sale]);
  const remaining = useMemo(() => subMoney(sale.total, paidSoFar), [sale, paidSoFar]);
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([
    { method: 'cash', amount: remaining },
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPayments([{ method: 'cash', amount: remaining }]);
  }, [remaining]);

  const newAmount = addMoney(...payments.map((p) => p.amount));
  const exact = Math.abs(newAmount - remaining) <= 0.005;

  function setRow(i: number, field: 'method' | 'amount', value: string) {
    setPayments((ps) =>
      ps.map((p, idx) =>
        idx === i
          ? {
              ...p,
              [field]: field === 'amount' ? Number(value) || 0 : (value as PaymentMethod),
            }
          : p,
      ),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!exact) return toast.error('El pago debe cubrir exactamente el saldo');
    setLoading(true);
    try {
      await data.addPaymentToSale({ saleId: sale.id, payments });
      toast.success('Saldo cobrado');
      onSuccess();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Cobrar saldo" widthClass="max-w-md">
      <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <div className="flex justify-between">
          <span>Total venta</span>
          <span className="font-semibold">{formatARS(sale.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Pagado en seña</span>
          <span>{formatARS(paidSoFar)}</span>
        </div>
        <div className="flex justify-between border-t border-amber-200 pt-1 font-bold">
          <span>Saldo a cobrar</span>
          <span>{formatARS(remaining)}</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        {payments.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={p.method}
              onChange={(e) => setRow(i, 'method', e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              className="h-10 w-32 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm"
              value={p.amount}
              onChange={(e) => setRow(i, 'amount', e.target.value)}
            />
            {payments.length > 1 && (
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() => setPayments((ps) => ps.filter((_, idx) => idx !== i))}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="text-xs text-brand-600 hover:underline"
          onClick={() =>
            setPayments((ps) => [...ps, { method: 'cash', amount: Math.max(remaining - newAmount, 0) }])
          }
        >
          + Agregar pago
        </button>

        <div className="mt-3 flex justify-between rounded-lg bg-slate-50 p-2 text-sm">
          <span>Total pagos</span>
          <span className={exact ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
            {formatARS(newAmount)}
          </span>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" type="button" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" type="submit" disabled={loading || !exact}>
            {loading ? 'Procesando…' : 'Confirmar cobro'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
