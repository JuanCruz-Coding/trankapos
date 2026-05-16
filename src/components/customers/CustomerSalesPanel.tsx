import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Package,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatARS } from '@/lib/currency';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CustomerSalesStats } from '@/data/driver';
import type { BusinessMode, Sale } from '@/types';

interface Props {
  customerId: string;
  /** Modo del negocio. En retail el panel arranca expandido. */
  businessMode: BusinessMode;
}

/**
 * Panel de historial y stats de compras del cliente (Sprint CRM-RETAIL).
 *
 * - Stats (total gastado, cantidad de ventas, última compra, cliente desde) se
 *   cargan al montar para mostrar el resumen siempre visible.
 * - El detalle de las últimas 20 ventas se carga lazy al expandir, para no
 *   pegar dos endpoints si el comercio no necesita el historial.
 * - En retail arranca expandido (el comercio suele revisar historial al
 *   abrir la ficha). En kiosco arranca cerrado.
 */
export function CustomerSalesPanel({ customerId, businessMode }: Props) {
  const startExpanded = businessMode === 'retail';

  const [stats, setStats] = useState<CustomerSalesStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [expanded, setExpanded] = useState(startExpanded);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    setStats(null);
    setSales(null);
    setExpanded(startExpanded);
    (async () => {
      try {
        const s = await data.getCustomerSalesStats(customerId);
        if (!cancelled) setStats(s);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, startExpanded]);

  const loadSales = useCallback(async () => {
    setSalesLoading(true);
    try {
      const list = await data.listSalesForCustomer(customerId, { limit: 20 });
      setSales(list);
    } catch (err) {
      toast.error((err as Error).message);
      setSales([]);
    } finally {
      setSalesLoading(false);
    }
  }, [customerId]);

  // Si arranca expandido, disparar la carga del detalle automáticamente.
  useEffect(() => {
    if (expanded && sales === null && !salesLoading) {
      void loadSales();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && sales === null && !salesLoading) {
      await loadSales();
    }
  }

  if (statsLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Cargando historial…
      </div>
    );
  }

  const salesCount = stats?.salesCount ?? 0;

  // Sin compras: placeholder discreto.
  if (salesCount === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <ShoppingBag className="mr-1 inline-block h-3.5 w-3.5 -mt-0.5" />
        Aún no compró nada.
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-brand-200 bg-brand-50/40">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-brand-50"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-navy">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-brand-700" />
          ) : (
            <ChevronRight className="h-4 w-4 text-brand-700" />
          )}
          Historial de compras
        </div>
        <div className="text-xs text-slate-500">
          {salesCount} {salesCount === 1 ? 'venta' : 'ventas'} ·{' '}
          <span className="font-semibold text-brand-700">
            {formatARS(stats?.totalSpent ?? 0)}
          </span>
        </div>
      </button>

      {/* Grilla de stats — siempre visible si hay ventas, no depende del expand. */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-4">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total gastado"
          value={formatARS(stats?.totalSpent ?? 0)}
          accent="emerald"
        />
        <StatCard
          icon={<ShoppingBag className="h-4 w-4" />}
          label="Ventas"
          value={String(salesCount)}
        />
        <StatCard
          icon={<Package className="h-4 w-4" />}
          label="Última compra"
          value={relativeDate(stats?.lastSaleAt)}
          title={stats?.lastSaleAt ?? undefined}
        />
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Cliente desde"
          value={shortDate(stats?.firstSaleAt)}
          title={stats?.firstSaleAt ?? undefined}
        />
      </div>

      {expanded && (
        <div className="border-t border-brand-200/60 bg-white/80 px-3 py-3">
          {salesLoading ? (
            <div className="text-xs text-slate-500">Cargando últimas ventas…</div>
          ) : !sales || sales.length === 0 ? (
            <div className="text-xs text-slate-500">Sin ventas registradas.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Fecha</th>
                    <th className="py-1 pr-2 font-medium">Items</th>
                    <th className="py-1 pr-2 text-right font-medium">Total</th>
                    <th className="py-1 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map((s) => {
                    const itemsCount = s.items.reduce((acc, it) => acc + it.qty, 0);
                    return (
                      <tr key={s.id} className={cn(s.voided && 'opacity-50')}>
                        <td className="py-1.5 pr-2 text-slate-700">
                          {formatDateTime(s.createdAt)}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600">
                          {itemsCount}{' '}
                          <span className="text-[10px] text-slate-400">
                            ({s.items.length} {s.items.length === 1 ? 'línea' : 'líneas'})
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-slate-800">
                          {formatARS(s.total)}
                        </td>
                        <td className="py-1.5">
                          {s.voided ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                              Anulada
                            </span>
                          ) : s.status === 'partial' ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              Seña
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              Pagada
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-slate-400">
                Mostrando las últimas {sales.length}{' '}
                {sales.length === 1 ? 'venta' : 'ventas'}. Para el detalle completo,
                filtrá en Ventas.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: 'emerald';
  title?: string;
}) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-white px-2.5 py-2"
      title={title}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        <span className={cn(accent === 'emerald' ? 'text-emerald-600' : 'text-brand-600')}>
          {icon}
        </span>
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-display text-sm font-bold tabular-nums',
          accent === 'emerald' ? 'text-emerald-700' : 'text-navy',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return '—';
  }
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}
