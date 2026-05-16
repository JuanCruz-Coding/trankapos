import { useEffect, useMemo, useState } from 'react';
import { Printer, Download, DollarSign, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { CustomerCreditMovement, Sale, Tenant } from '@/types';
import { RecordCreditPaymentModal } from './RecordCreditPaymentModal';
import { ReceiptModal } from '@/components/pos/ReceiptModal';

interface Props {
  open: boolean;
  customerId: string;
  customerName: string;
  onClose: () => void;
}

const REASON_LABELS_ES: Record<CustomerCreditMovement['reason'], string> = {
  return_credit: 'Devolución / Nota de crédito',
  sale_payment: 'Pago aplicado en compra',
  manual_adjust: 'Ajuste manual',
  fiado: 'Venta a cuenta corriente',
  fiado_payment: 'Pago de fiado',
};

interface LedgerRow {
  id: string;
  date: string;
  concept: string;
  reference: string;
  /** Si está, hace clickeable la referencia para abrir el ticket/factura. */
  relatedSaleId: string | null;
  /** Aumenta la deuda del cliente con el comercio. */
  debe: number;
  /** Reduce la deuda o suma a favor del cliente. */
  haber: number;
  /** Saldo acumulado en convención AR: positivo=debe, negativo=a favor. */
  balance: number;
  expired: boolean;
}

/**
 * Estado de cuenta del cliente al estilo contable AR (Debe / Haber / Saldo).
 *
 * Convención:
 *   - amount > 0 (a favor del cliente) → Haber.
 *   - amount < 0 (deuda nueva del cliente) → Debe.
 *   - Saldo AR: positivo = cliente debe. Negativo = cliente tiene a favor.
 *
 * Los movements vienen DESC por fecha del driver. Para construir el saldo
 * acumulado los procesamos en orden ASC y luego invertimos.
 */
export function CustomerAccountStatementModal({
  open,
  customerId,
  customerName,
  onClose,
}: Props) {
  const [movements, setMovements] = useState<CustomerCreditMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await data.listCustomerCreditMovements(customerId);
        if (!cancelled) setMovements(list);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, refreshKey]);

  const ledger = useMemo<LedgerRow[]>(() => {
    // Ordenar ASC por fecha (driver los devuelve DESC).
    const asc = [...movements].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    let running = 0;
    const rows: LedgerRow[] = [];
    for (const m of asc) {
      const debe = m.amount < 0 ? -m.amount : 0;
      const haber = m.amount > 0 ? m.amount : 0;
      // Saldo AR: positivo = cliente debe. m.amount < 0 = deuda → suma al saldo positivo.
      running += -m.amount;
      const expired =
        m.expiresAt != null && new Date(m.expiresAt).getTime() <= Date.now();
      rows.push({
        id: m.id,
        date: new Date(m.createdAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        concept: REASON_LABELS_ES[m.reason] ?? m.reason,
        reference: m.relatedSaleId
          ? `Venta ${m.relatedSaleId.slice(0, 8)}…`
          : m.notes ?? '',
        relatedSaleId: m.relatedSaleId,
        debe,
        haber,
        balance: running,
        expired,
      });
    }
    return rows.reverse(); // mostrar más reciente arriba
  }, [movements]);

  // --- Visor de comprobantes (Sprint REPRINT) ---
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadingSale, setLoadingSale] = useState(false);

  async function handleViewReceipt(saleId: string) {
    setLoadingSale(true);
    try {
      const [sale, t] = await Promise.all([
        data.getSale(saleId),
        tenant ? Promise.resolve(tenant) : data.getTenant(),
      ]);
      if (!sale) {
        toast.error('No se encontró la venta');
        return;
      }
      if (!tenant) setTenant(t);
      setViewingSale(sale);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingSale(false);
    }
  }

  const totals = useMemo(() => {
    return ledger.reduce(
      (acc, r) => ({
        debe: acc.debe + r.debe,
        haber: acc.haber + r.haber,
      }),
      { debe: 0, haber: 0 },
    );
  }, [ledger]);

  const finalBalance = ledger.length > 0 ? ledger[0].balance : 0;
  const hasDebt = finalBalance > 0;

  function exportCSV() {
    const rows: (string | number)[][] = [
      ['Fecha', 'Concepto', 'Referencia', 'Debe', 'Haber', 'Saldo'],
      ...[...ledger].reverse().map((r) => [
        r.date,
        r.concept,
        r.reference,
        r.debe.toFixed(2),
        r.haber.toFixed(2),
        r.balance.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cuenta-${customerName.replace(/\s+/g, '_')}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Cuenta corriente — ${customerName}`}
        widthClass="max-w-4xl"
      >
        <div id="account-statement-print" className="space-y-4">
          {/* Header con balance y acciones (oculto al imprimir) */}
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div
              className={cn(
                'rounded-lg border-2 px-4 py-2',
                finalBalance === 0
                  ? 'border-slate-200 bg-slate-50'
                  : hasDebt
                    ? 'border-red-200 bg-red-50'
                    : 'border-emerald-200 bg-emerald-50',
              )}
            >
              <div className="text-xs uppercase text-slate-500">Saldo actual</div>
              <div
                className={cn(
                  'font-display text-xl font-bold tabular-nums',
                  finalBalance === 0
                    ? 'text-slate-500'
                    : hasDebt
                      ? 'text-red-700'
                      : 'text-emerald-700',
                )}
              >
                {finalBalance === 0
                  ? formatARS(0)
                  : hasDebt
                    ? `Debe ${formatARS(finalBalance)}`
                    : `A favor ${formatARS(-finalBalance)}`}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasDebt && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setRecordPaymentOpen(true)}
                >
                  <DollarSign className="mr-1 h-3.5 w-3.5" />
                  Registrar pago
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                disabled={ledger.length === 0}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Exportar CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={ledger.length === 0}
              >
                <Printer className="mr-1 h-3.5 w-3.5" />
                Imprimir
              </Button>
            </div>
          </div>

          {/* Encabezado visible solo en impresión */}
          <div className="hidden print:block">
            <h2 className="text-xl font-bold">Cuenta corriente</h2>
            <div className="text-sm">Cliente: {customerName}</div>
            <div className="text-sm">
              Saldo:{' '}
              {finalBalance === 0
                ? formatARS(0)
                : hasDebt
                  ? `Debe ${formatARS(finalBalance)}`
                  : `A favor ${formatARS(-finalBalance)}`}
            </div>
            <hr className="my-3" />
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Cargando movimientos…
            </div>
          ) : ledger.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Este cliente no tiene movimientos en su cuenta corriente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b-2 border-slate-300 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Concepto</th>
                    <th className="py-2 pr-3">Referencia</th>
                    <th className="py-2 pr-3 text-right">Debe</th>
                    <th className="py-2 pr-3 text-right">Haber</th>
                    <th className="py-2 pr-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.map((r) => (
                    <tr key={r.id} className={cn(r.expired && 'opacity-50')}>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                        {r.date}
                      </td>
                      <td className="py-2 pr-3">
                        {r.concept}
                        {r.expired && (
                          <span className="ml-1 text-[10px] text-red-600">(vencido)</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-500">
                        {r.relatedSaleId ? (
                          <button
                            type="button"
                            onClick={() => handleViewReceipt(r.relatedSaleId!)}
                            disabled={loadingSale}
                            className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-800 hover:underline disabled:opacity-50"
                            title="Ver comprobante"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {r.reference}
                          </button>
                        ) : (
                          r.reference || '—'
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.debe > 0 ? formatARS(r.debe) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.haber > 0 ? formatARS(r.haber) : '—'}
                      </td>
                      <td
                        className={cn(
                          'py-2 pr-3 text-right tabular-nums font-semibold',
                          r.balance > 0
                            ? 'text-red-700'
                            : r.balance < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500',
                        )}
                      >
                        {r.balance === 0
                          ? formatARS(0)
                          : r.balance > 0
                            ? formatARS(r.balance)
                            : `(${formatARS(-r.balance)})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>
                      Totales
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(totals.debe)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(totals.haber)}
                    </td>
                    <td
                      className={cn(
                        'py-2 pr-3 text-right tabular-nums',
                        finalBalance > 0
                          ? 'text-red-700'
                          : finalBalance < 0
                            ? 'text-emerald-700'
                            : 'text-slate-500',
                      )}
                    >
                      {finalBalance === 0
                        ? formatARS(0)
                        : finalBalance > 0
                          ? formatARS(finalBalance)
                          : `(${formatARS(-finalBalance)})`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Aclaración para clientes */}
          <p className="text-[11px] text-slate-500 print:text-[10px]">
            Saldo positivo = el cliente le debe al comercio. Saldo entre paréntesis o en
            verde = el comercio le debe al cliente (saldo a favor).
          </p>
        </div>
      </Modal>

      <RecordCreditPaymentModal
        open={recordPaymentOpen}
        customerId={customerId}
        customerName={customerName}
        currentDebt={hasDebt ? finalBalance : 0}
        onClose={() => setRecordPaymentOpen(false)}
        onRecorded={() => setRefreshKey((k) => k + 1)}
      />

      {viewingSale && tenant && (
        <ReceiptModal
          sale={viewingSale}
          tenant={tenant}
          mode="view"
          onClose={() => setViewingSale(null)}
        />
      )}
    </>
  );
}
