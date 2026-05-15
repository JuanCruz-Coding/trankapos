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
import type { ProductVariant } from '@/types';

/** Formatea atributos: `{talle:"M",color:"Negro"}` → "M Negro". */
function variantAttrsLabel(v: ProductVariant): string {
  const vals = Object.values(v.attributes ?? {});
  return vals.length > 0 ? vals.join(' ') : '';
}

export default function Transfers() {
  const { session } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const transfers = useLiveQuery(() => data.listTransfers(), [session?.tenantId, refreshKey]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId]);
  const warehouses = useLiveQuery(() => data.listWarehouses(), [session?.tenantId]);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  // Sprint VAR: variantes para el selector de cada item.
  const variants = useLiveQuery(() => data.listVariants(), [session?.tenantId]);

  const [modal, setModal] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [notes, setNotes] = useState('');
  // Cada item lleva productId + variantId. Por defecto, al elegir un producto,
  // si tiene 1 sola variante (la default) se autoselecciona.
  const [items, setItems] = useState<
    { productId: string; variantId: string; qty: number }[]
  >([]);

  // Map productId -> variantes activas.
  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    (variants ?? []).forEach((v) => {
      if (!v.active) return;
      const arr = map.get(v.productId) ?? [];
      arr.push(v);
      map.set(v.productId, arr);
    });
    map.forEach((arr) => {
      arr.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
    });
    return map;
  }, [variants]);

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
    const cleanItems = items.filter((i) => i.productId && i.qty > 0);
    const parsed = safeParse(transferSchema, {
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      notes,
      items: cleanItems.map(({ productId, qty }) => ({ productId, qty })),
    });
    if (!parsed.ok) return toast.error(parsed.error);
    try {
      // Sprint VAR: enriquecemos los items con variantId. Si el usuario no
      // tocó el selector, ya viene la default por defecto.
      const variantByProductId = new Map(
        cleanItems.map((i) => [i.productId, i.variantId]),
      );
      await data.createTransfer({
        ...parsed.data,
        items: parsed.data.items.map((it) => ({
          ...it,
          variantId: variantByProductId.get(it.productId) || undefined,
        })),
      });
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
                onClick={() =>
                  setItems([...items, { productId: '', variantId: '', qty: 1 }])
                }
              >
                + Agregar
              </button>
            </div>
            {items.length === 0 && (
              <p className="text-xs text-slate-400">Aún no agregaste productos</p>
            )}
            <div className="space-y-2">
              {items.map((it, i) => {
                const pVariants = it.productId
                  ? variantsByProduct.get(it.productId) ?? []
                  : [];
                // Si el producto tiene 1 sola variante (default), no mostramos el selector.
                const showVariantSelector =
                  pVariants.length > 1 ||
                  (pVariants.length === 1 &&
                    Object.keys(pVariants[0].attributes).length > 0);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 min-w-[160px] flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm"
                      value={it.productId}
                      onChange={(e) => {
                        const newProductId = e.target.value;
                        // Auto-seleccionamos la variante default del producto recién elegido.
                        const vs = newProductId
                          ? variantsByProduct.get(newProductId) ?? []
                          : [];
                        const defaultVariantId =
                          vs.find((v) => v.isDefault)?.id ?? vs[0]?.id ?? '';
                        setItems(
                          items.map((x, idx) =>
                            idx === i
                              ? { ...x, productId: newProductId, variantId: defaultVariantId }
                              : x,
                          ),
                        );
                      }}
                    >
                      <option value="">Seleccionar…</option>
                      {(products ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {showVariantSelector && (
                      <select
                        className="h-9 min-w-[120px] flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm"
                        value={it.variantId}
                        onChange={(e) =>
                          setItems(
                            items.map((x, idx) =>
                              idx === i ? { ...x, variantId: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        {pVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {variantAttrsLabel(v) ||
                              (v.isDefault ? 'Default' : v.sku || 'Variante')}
                          </option>
                        ))}
                      </select>
                    )}
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
                );
              })}
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
