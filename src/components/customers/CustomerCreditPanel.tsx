import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Wallet, DollarSign } from 'lucide-react';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { CustomerCredit, CustomerCreditMovement } from '@/types';
import { RecordCreditPaymentModal } from './RecordCreditPaymentModal';

interface Props {
  customerId: string;
  /** Sprint FIA: para el header del modal de pago de fiado. */
  customerName?: string;
}

const REASON_LABELS_ES: Record<CustomerCreditMovement['reason'], string> = {
  return_credit: 'Devolución de venta',
  sale_payment: 'Pago en compra',
  manual_adjust: 'Ajuste manual',
  fiado: 'Fiado',
  fiado_payment: 'Pago de fiado',
};

/**
 * Panel destacado de saldo a favor del cliente (Sprint DEV).
 *
 * Carga lazy: balance al montar, movimientos al expandir el detalle.
 * Si el balance es 0 / null, muestra un placeholder discreto.
 */
export function CustomerCreditPanel({ customerId, customerName }: Props) {
  const [credit, setCredit] = useState<CustomerCredit | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [movements, setMovements] = useState<CustomerCreditMovement[] | null>(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCredit(null);
    setMovements(null);
    setExpanded(false);
    (async () => {
      try {
        const c = await data.getCustomerCredit(customerId);
        if (!cancelled) setCredit(c);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, refreshKey]);

  async function handleToggleMovements() {
    const next = !expanded;
    setExpanded(next);
    if (next && movements === null) {
      setMovementsLoading(true);
      try {
        const ms = await data.listCustomerCreditMovements(customerId);
        setMovements(ms);
      } catch (err) {
        toast.error((err as Error).message);
        setMovements([]);
      } finally {
        setMovementsLoading(false);
      }
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Cargando saldo…
      </div>
    );
  }

  // El balance ya viene "disponible" (excluye vencidos) — getCustomerCredit
  // usa el RPC get_customer_available_credit. El histórico se calcula con
  // la suma cruda de movements (incluye vencidos).
  const balance = credit?.balance ?? 0;
  const historicTotal = (movements ?? []).reduce((acc, m) => acc + m.amount, 0);
  const hasExpired = balance !== historicTotal && movements !== null;

  if (balance === 0 && (movements === null || movements.length === 0)) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <Wallet className="mr-1 inline-block h-3.5 w-3.5 -mt-0.5" />
        Sin saldo a favor.
      </div>
    );
  }

  const positive = balance > 0;

  return (
    <div
      className={cn(
        'rounded-lg border-2 p-3',
        positive
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-red-300 bg-red-50',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
          )}
        >
          <Wallet className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {balance < 0
              ? 'Adeuda (cuenta corriente)'
              : balance === 0
                ? 'Saldo a favor (vencido)'
                : 'Saldo a favor disponible'}
          </div>
          <div
            className={cn(
              'font-display text-2xl font-bold tabular-nums',
              balance === 0
                ? 'text-slate-400'
                : positive
                  ? 'text-emerald-700'
                  : 'text-red-700',
            )}
          >
            {formatARS(positive || balance === 0 ? balance : -balance)}
          </div>
          {hasExpired && (
            <div className="mt-0.5 text-[11px] text-slate-500">
              Histórico total (incluye vencidos): {formatARS(historicTotal)}
            </div>
          )}
        </div>
        {balance < 0 && (
          <button
            type="button"
            onClick={() => setRecordPaymentOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            <DollarSign className="h-3.5 w-3.5" />
            Registrar pago
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={handleToggleMovements}
        className={cn(
          'mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline',
          positive ? 'text-emerald-800' : 'text-red-800',
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Ver movimientos
      </button>

      <RecordCreditPaymentModal
        open={recordPaymentOpen}
        customerId={customerId}
        customerName={customerName ?? 'Cliente'}
        currentDebt={balance < 0 ? -balance : 0}
        onClose={() => setRecordPaymentOpen(false)}
        onRecorded={() => {
          // Refresca el balance y los movements al cerrar.
          setMovements(null);
          setRefreshKey((k) => k + 1);
        }}
      />

      {expanded && (
        <div className="mt-2 rounded-md border border-white/60 bg-white/60 p-2">
          {movementsLoading ? (
            <div className="text-xs text-slate-500">Cargando movimientos…</div>
          ) : !movements || movements.length === 0 ? (
            <div className="text-xs text-slate-500">Sin movimientos registrados.</div>
          ) : (
            <ul className="divide-y divide-slate-200 text-xs">
              {movements.map((m) => {
                const isCredit = m.amount > 0;
                const expired =
                  m.expiresAt != null && new Date(m.expiresAt).getTime() <= Date.now();
                return (
                  <li key={m.id} className="flex items-start justify-between gap-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'font-medium',
                          expired ? 'text-slate-400 line-through' : 'text-slate-800',
                        )}
                      >
                        {REASON_LABELS_ES[m.reason] ?? m.reason}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {new Date(m.createdAt).toLocaleString('es-AR')}
                      </div>
                      {m.expiresAt && (
                        <div
                          className={cn(
                            'mt-0.5 text-[11px]',
                            expired
                              ? 'font-semibold text-red-600'
                              : 'text-amber-700',
                          )}
                        >
                          {expired
                            ? `Vencido el ${new Date(m.expiresAt).toLocaleDateString('es-AR')}`
                            : `Vence el ${new Date(m.expiresAt).toLocaleDateString('es-AR')}`}
                        </div>
                      )}
                      {m.notes && (
                        <div className="mt-0.5 text-[11px] text-slate-600">{m.notes}</div>
                      )}
                      {m.relatedSaleId && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          Venta: {m.relatedSaleId.slice(0, 8)}…
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        'shrink-0 text-right font-semibold tabular-nums',
                        expired
                          ? 'text-slate-400 line-through'
                          : isCredit
                            ? 'text-emerald-700'
                            : 'text-red-700',
                      )}
                    >
                      {isCredit ? '+' : ''}
                      {formatARS(m.amount)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
