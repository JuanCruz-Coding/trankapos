import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { formatDateTime } from '@/lib/dates';
import { safeParse, transferSchema } from '@/lib/schemas';

export default function Transfers() {
  const { session } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const transfers = useLiveQuery(() => data.listTransfers(), [session?.tenantId, refreshKey]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId]);
  const warehouses = useLiveQuery(() => data.listWarehouses(), [session?.tenantId]);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);

  const [modal, setModal] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ productId: string; qty: number }[]>([]);

  const productMap = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );

  const branchById = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b])),
    [branches],
  );

  const warehouseById = useMemo(
    () => new Map((warehouses ?? []).map((w) => [w.id, w])),
    [warehouses],
  );

  function warehouseLabel(warehouseId: string): string {
    const wh = warehouseById.get(warehouseId);
    if (!wh) return '—';
    const branch = wh.branchId ? branchById.get(wh.branchId) : null;
    return branch ? `${branch.name} · ${wh.name}` : `Central · ${wh.name}`;
  }

  function openNew() {
    setFromId(warehouses?.[0]?.id ?? '');
    setToId(warehouses?.[1]?.id ?? '');
    setNotes('');
    setItems([]);
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(transferSchema, {
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      notes,
      items: items.filter((i) => i.productId && i.qty > 0),
    });
    if (!parsed.ok) return toast.error(parsed.error);
    try {
      await data.createTransfer(parsed.data);
      toast.success('Transferencia registrada');
      setModal(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Transferencias"
        subtitle="Movimientos de stock entre depósitos"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Nueva transferencia
          </Button>
        }
      />

      {(transfers ?? []).length === 0 ? (
        <Empty title="Sin transferencias" />
      ) : (
        <div className="space-y-3">
          {transfers!.map((t) => {
            return (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      {warehouseLabel(t.fromWarehouseId)}{' '}
                      <ArrowRight className="inline h-4 w-4" />{' '}
                      {warehouseLabel(t.toWarehouseId)}
                    </CardTitle>
                    <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
                  </div>
                </CardHeader>
                <CardBody>
                  {t.notes && <p className="mb-2 text-sm text-slate-600">{t.notes}</p>}
                  <ul className="text-sm">
                    {t.items.map((it, i) => (
                      <li key={i} className="flex justify-between py-0.5">
                        <span>{productMap.get(it.productId)?.name ?? '—'}</span>
                        <span className="font-semibold">{it.qty} u.</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva transferencia">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Desde</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                {(warehouses ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {warehouseLabel(w.id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Hacia</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                {(warehouses ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {warehouseLabel(w.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Notas</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">Items</span>
              <button
                type="button"
                className="text-xs text-brand-600 hover:underline"
                onClick={() => setItems([...items, { productId: '', qty: 1 }])}
              >
                + Agregar
              </button>
            </div>
            {items.length === 0 && (
              <p className="text-xs text-slate-400">Aún no agregaste productos</p>
            )}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm"
                    value={it.productId}
                    onChange={(e) =>
                      setItems(items.map((x, idx) => (idx === i ? { ...x, productId: e.target.value } : x)))
                    }
                  >
                    <option value="">Seleccionar…</option>
                    {(products ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="h-9 w-20 rounded-md border border-slate-300 px-2 text-sm"
                    value={it.qty}
                    onChange={(e) =>
                      setItems(
                        items.map((x, idx) =>
                          idx === i ? { ...x, qty: Number(e.target.value) || 0 } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">Registrar</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
