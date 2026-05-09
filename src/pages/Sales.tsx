import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Eye } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { formatDateTime } from '@/lib/dates';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import type { Sale } from '@/types';

const PAGE_SIZE = 50;

export default function Sales() {
  const { session, activeDepotId } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sales = useLiveQuery(
    () => data.listSales({ depotId: activeDepotId ?? undefined, limit }),
    [session?.tenantId, activeDepotId, refreshKey, limit],
  );
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId]);
  const [view, setView] = useState<Sale | null>(null);

  async function handleVoid(s: Sale) {
    const ok = await confirmDialog(`¿Anular venta por ${formatARS(s.total)}?`, {
      text: 'Se devuelve el stock al depósito de origen.',
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
              {sales!.map((s) => (
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
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        <span className="status-dot status-dot--green" />
                        Ok
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setView(s)}
                        className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {!s.voided && (
                        <button
                          onClick={() => handleVoid(s)}
                          className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
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

      {view && (
        <Modal open onClose={() => setView(null)} title={`Venta ${view.id.slice(0, 8)}`}>
          <div className="mb-3 text-xs text-slate-500">{formatDateTime(view.createdAt)}</div>
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
              {view.items.map((it) => (
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
              <span>{formatARS(view.subtotal)}</span>
            </div>
            {view.discount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Descuento</span>
                <span>-{formatARS(view.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatARS(view.total)}</span>
            </div>
          </div>
          <hr className="my-3" />
          <div className="text-xs text-slate-600">
            {view.payments.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span className="capitalize">{p.method}</span>
                <span>{formatARS(p.amount)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setView(null)}>
              Cerrar
            </Button>
            <Button onClick={() => window.print()}>Imprimir</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
