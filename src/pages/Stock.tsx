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
import type { Product, ProductVariant } from '@/types';
import { usePermission } from '@/lib/permissions';

/** Formatea los atributos de una variante: `{talle:"M",color:"Negro"}` → "M Negro". */
function formatVariantAttrs(v: ProductVariant): string {
  const vals = Object.values(v.attributes ?? {});
  return vals.length > 0 ? vals.join(' ') : '—';
}

export default function Stock() {
  const { session } = useAuth();
  const canAdjustStock = usePermission('adjust_stock');
  const [refreshKey, setRefreshKey] = useState(0);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId]);
  const warehouses = useLiveQuery(() => data.listWarehouses(), [session?.tenantId]);
  const stock = useLiveQuery(() => data.listStock(), [session?.tenantId, refreshKey]);
  // Sprint VAR: traemos todas las variantes una vez por sesión + refresh.
  const variants = useLiveQuery(() => data.listVariants(), [session?.tenantId, refreshKey]);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [edit, setEdit] = useState<{
    product: Product;
    variant: ProductVariant | null;
    warehouseId: string;
  } | null>(null);

  const branchById = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b])),
    [branches],
  );

  // Map productId -> variantes ordenadas (default primero).
  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    (variants ?? []).forEach((v) => {
      const arr = map.get(v.productId) ?? [];
      arr.push(v);
      map.set(v.productId, arr);
    });
    // Default primero, después por createdAt.
    map.forEach((arr) => {
      arr.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
    });
    return map;
  }, [variants]);

  /**
   * Filas a renderizar. Cada fila es una combinación (producto × variante × depósito).
   * Si hay stock_items con variantId, los usamos como fuente de verdad.
   * Para el caso transición en el que stock_items todavía no expone variantId,
   * caemos a un join por productId que asume "todo el stock = variante default".
   */
  const rows = useMemo(() => {
    if (!products || !stock || !warehouses) return [];
    const q = search.toLowerCase();
    const wantedWarehouses = warehouses.filter(
      (w) => warehouseFilter === 'all' || w.id === warehouseFilter,
    );

    // Indexamos stock por clave: si tiene variantId usamos esa; sino productId.
    const stockByVariantKey = new Map<string, { qty: number; minQty: number }>();
    const stockByProductFallback = new Map<string, { qty: number; minQty: number }>();
    for (const s of stock) {
      if (s.variantId) {
        stockByVariantKey.set(`${s.variantId}:${s.warehouseId}`, {
          qty: s.qty,
          minQty: s.minQty,
        });
      } else {
        stockByProductFallback.set(`${s.productId}:${s.warehouseId}`, {
          qty: s.qty,
          minQty: s.minQty,
        });
      }
    }

    const out: Array<{
      product: Product;
      variant: ProductVariant | null;
      warehouseId: string;
      qty: number;
      minQty: number;
    }> = [];

    for (const p of products) {
      if (q && !p.name.toLowerCase().includes(q) && !(p.barcode ?? '').includes(q)) {
        continue;
      }
      const pVariants = variantsByProduct.get(p.id) ?? [];
      // Si todavía no hay variantes en cache (driver aún no implementado),
      // dibujamos una fila por (producto, depósito) con variant=null usando
      // el fallback por productId, preservando el comportamiento previo.
      if (pVariants.length === 0) {
        for (const w of wantedWarehouses) {
          const s = stockByProductFallback.get(`${p.id}:${w.id}`) ?? { qty: 0, minQty: 0 };
          out.push({
            product: p,
            variant: null,
            warehouseId: w.id,
            qty: s.qty,
            minQty: s.minQty,
          });
        }
        continue;
      }
      for (const v of pVariants) {
        for (const w of wantedWarehouses) {
          const s =
            stockByVariantKey.get(`${v.id}:${w.id}`) ??
            // Fallback: si la variante es default y stock no trae variantId.
            (v.isDefault
              ? stockByProductFallback.get(`${p.id}:${w.id}`)
              : undefined) ??
            { qty: 0, minQty: 0 };
          out.push({
            product: p,
            variant: v,
            warehouseId: w.id,
            qty: s.qty,
            minQty: s.minQty,
          });
        }
      }
    }
    return out;
  }, [products, stock, warehouses, search, warehouseFilter, variantsByProduct]);

  return (
    <div>
      <PageHeader title="Stock" subtitle="Control de inventario por variante y depósito" />

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
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
        >
          <option value="all">Todos los depósitos</option>
          {(warehouses ?? []).map((w) => {
            const branch = w.branchId ? branchById.get(w.branchId) : null;
            const label = branch ? `${branch.name} → ${w.name}` : `Central · ${w.name}`;
            return (
              <option key={w.id} value={w.id}>
                {label}
              </option>
            );
          })}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Variante</th>
              <th className="px-4 py-3">Depósito</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3 text-right">Mínimo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ product, variant, warehouseId, qty, minQty }) => {
              const warehouse = warehouses?.find((w) => w.id === warehouseId);
              if (!warehouse) return null;
              const branch = warehouse.branchId ? branchById.get(warehouse.branchId) : null;
              const variantLabel = variant
                ? variant.isDefault && Object.keys(variant.attributes).length === 0
                  ? '—'
                  : formatVariantAttrs(variant)
                : '—';
              const rowKey = `${product.id}:${variant?.id ?? 'na'}:${warehouseId}`;
              return (
                <tr key={rowKey} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{product.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span>{variantLabel}</span>
                    {variant?.sku && (
                      <span className="ml-2 text-[10px] text-slate-400">SKU {variant.sku}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {branch ? `${branch.name} · ${warehouse.name}` : `Central · ${warehouse.name}`}
                  </td>
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
                    {canAdjustStock && (
                      <button
                        onClick={() =>
                          setEdit({ product, variant, warehouseId: warehouse.id })
                        }
                        className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <AdjustModal
          product={edit.product}
          variant={edit.variant}
          warehouseId={edit.warehouseId}
          currentQty={
            // Buscamos por variantId si está, sino caemos al matching legacy por productId.
            (edit.variant
              ? stock?.find(
                  (s) =>
                    s.variantId === edit.variant!.id &&
                    s.warehouseId === edit.warehouseId,
                )?.qty
              : undefined) ??
            stock?.find(
              (s) =>
                s.productId === edit.product.id &&
                s.warehouseId === edit.warehouseId &&
                !s.variantId,
            )?.qty ??
            0
          }
          currentMin={
            (edit.variant
              ? stock?.find(
                  (s) =>
                    s.variantId === edit.variant!.id &&
                    s.warehouseId === edit.warehouseId,
                )?.minQty
              : undefined) ??
            stock?.find(
              (s) =>
                s.productId === edit.product.id &&
                s.warehouseId === edit.warehouseId &&
                !s.variantId,
            )?.minQty ??
            0
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
  variant,
  warehouseId,
  currentQty,
  currentMin,
  onClose,
  onSuccess,
}: {
  product: Product;
  variant: ProductVariant | null;
  warehouseId: string;
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
      // TODO Sprint VAR: cuando la Pieza A adapte adjustStock para aceptar
      // variantId (por ahora la firma del driver es por productId y resuelve
      // a la default internamente), pasarle variant?.id acá. Para productos
      // simples (variante única default) este call site sigue funcionando bien.
      await data.adjustStock(product.id, warehouseId, delta, Number(minQty) || 0);
      toast.success('Stock actualizado');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const subtitleVariant =
    variant && !(variant.isDefault && Object.keys(variant.attributes).length === 0)
      ? formatVariantAttrs(variant)
      : null;

  return (
    <Modal open onClose={onClose} title="Ajustar stock" widthClass="max-w-sm">
      <div className="mb-3 text-sm text-slate-600">
        <div className="font-medium text-slate-900">{product.name}</div>
        {subtitleVariant && (
          <div className="text-xs text-slate-500">Variante: {subtitleVariant}</div>
        )}
        <div className="text-xs text-slate-500">Stock actual: {currentQty}</div>
        {variant && !variant.isDefault && (
          <div className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            Aviso: el ajuste por variante específica todavía está siendo cableado.
            Por ahora el ajuste impacta la variante default del producto.
          </div>
        )}
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
