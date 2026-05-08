import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import type { Product } from '@/types';

export default function Stock() {
  const { session, activeDepotId } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  const depots = useLiveQuery(() => data.listDepots(), [session?.tenantId]);
  const stock = useLiveQuery(() => data.listStock(), [session?.tenantId, refreshKey]);
  const [search, setSearch] = useState('');
  const [depotFilter, setDepotFilter] = useState<string>('all');
  const [edit, setEdit] = useState<{ product: Product; depotId: string } | null>(null);

  const rows = useMemo(() => {
    if (!products || !stock || !depots) return [];
    const byKey = new Map<string, number>();
    const minByKey = new Map<string, number>();
    for (const s of stock) {
      byKey.set(`${s.productId}:${s.depotId}`, s.qty);
      minByKey.set(`${s.productId}:${s.depotId}`, s.minQty);
    }
    const q = search.toLowerCase();
    return products
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q) : true))
      .map((p) => ({
        product: p,
        rows: depots
          .filter((d) => depotFilter === 'all' || d.id === depotFilter)
          .map((d) => ({
            depot: d,
            qty: byKey.get(`${p.id}:${d.id}`) ?? 0,
            minQty: minByKey.get(`${p.id}:${d.id}`) ?? 0,
          })),
      }));
  }, [products, stock, depots, search, depotFilter]);

  return (
    <div>
      <PageHeader title="Stock" subtitle="Control de inventario por depósito" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={depotFilter}
          onChange={(e) => setDepotFilter(e.target.value)}
        >
          <option value="all">Todos los depósitos</option>
          {(depots ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Depósito</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3 text-right">Mínimo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.flatMap(({ product, rows: r }) =>
              r.map(({ depot, qty, minQty }) => (
                <tr key={`${product.id}:${depot.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{product.name}</td>
                  <td className="px-4 py-3 text-slate-600">{depot.name}</td>
                  <td
                    className={
                      'px-4 py-3 text-right font-semibold ' +
                      (qty <= 0 ? 'text-red-600' : qty <= minQty ? 'text-amber-600' : '')
                    }
                  >
                    {qty}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{minQty}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEdit({ product, depotId: depot.id })}
                      className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <AdjustModal
          product={edit.product}
          depotId={edit.depotId}
          currentQty={
            stock?.find((s) => s.productId === edit.product.id && s.depotId === edit.depotId)
              ?.qty ?? 0
          }
          currentMin={
            stock?.find((s) => s.productId === edit.product.id && s.depotId === edit.depotId)
              ?.minQty ?? 0
          }
          onClose={() => setEdit(null)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

function AdjustModal({
  product,
  depotId,
  currentQty,
  currentMin,
  onClose,
  onSuccess,
}: {
  product: Product;
  depotId: string;
  currentQty: number;
  currentMin: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [qty, setQty] = useState('');
  const [minQty, setMinQty] = useState(String(currentMin));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const val = Number(qty) || 0;
      const delta = mode === 'delta' ? val : val - currentQty;
      await data.adjustStock(product.id, depotId, delta, Number(minQty) || 0);
      toast.success('Stock actualizado');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal open onClose={onClose} title="Ajustar stock" widthClass="max-w-sm">
      <div className="mb-3 text-sm text-slate-600">
        <div className="font-medium text-slate-900">{product.name}</div>
        <div className="text-xs text-slate-500">Stock actual: {currentQty}</div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={
              'flex-1 rounded-lg border px-3 py-1.5 text-xs ' +
              (mode === 'delta'
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-slate-300 bg-white')
            }
            onClick={() => setMode('delta')}
          >
            Sumar/restar
          </button>
          <button
            type="button"
            className={
              'flex-1 rounded-lg border px-3 py-1.5 text-xs ' +
              (mode === 'set'
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-slate-300 bg-white')
            }
            onClick={() => setMode('set')}
          >
            Fijar valor
          </button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            {mode === 'delta' ? 'Cantidad (puede ser negativa)' : 'Nuevo stock total'}
          </label>
          <Input
            type="number"
            step="1"
            required
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Stock mínimo</label>
          <Input
            type="number"
            min="0"
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full">
          Aplicar
        </Button>
      </form>
    </Modal>
  );
}
