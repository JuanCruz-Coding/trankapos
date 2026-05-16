import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Package, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Empty } from '@/components/ui/Empty';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { PriceListItem, Product, ProductVariant } from '@/types';

interface Props {
  priceListId: string;
  /** Si true, es la lista default — los items son "informativos" (la cascada cae acá). */
  isDefault: boolean;
}

/** Key compuesta para indexar items por (productId, variantId|null). */
function itemKey(productId: string, variantId: string | null): string {
  return `${productId}::${variantId ?? ''}`;
}

/**
 * Editor de items de una lista de precios.
 *
 * Tabla productos x variantes. Cada fila tiene:
 * - "Precio base" del producto / variante (read-only).
 * - "Precio en esta lista" (input number, autosave on blur).
 * - Si está vacío, cae a la cascada (variant.priceOverride > product.price).
 *
 * Para "vaciar" un precio (volver a cascada): botón X que llama deletePriceListItem.
 */
export function PriceListItemsEditor({ priceListId, isDefault }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Productos expandidos (mostrando sus variantes).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Inputs en edición (productId::variantId -> string).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Rows guardando ahora mismo, para mostrar spinner / disable.
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Carga inicial (paralela).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDrafts({});
    (async () => {
      try {
        const [ps, vs, is] = await Promise.all([
          data.listProducts(),
          data.listVariants(),
          data.listPriceListItems(priceListId),
        ]);
        if (cancelled) return;
        setProducts(ps);
        setVariants(vs);
        setItems(is);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [priceListId]);

  // Index productos x variantes.
  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const list = map.get(v.productId) ?? [];
      list.push(v);
      map.set(v.productId, list);
    }
    return map;
  }, [variants]);

  // Index items por key (productId, variantId|null).
  const itemsByKey = useMemo(() => {
    const map = new Map<string, PriceListItem>();
    for (const it of items) {
      map.set(itemKey(it.productId, it.variantId), it);
    }
    return map;
  }, [items]);

  const filteredProducts = useMemo(() => {
    const active = products.filter((p) => p.active);
    const q = search.trim().toLowerCase();
    if (!q) return active.slice(0, 200);
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode ?? '').includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [products, search]);

  function toggleExpand(productId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  /**
   * Calcula el precio "efectivo" mostrado en gris cuando la lista no tiene
   * override para esta fila. Replica la cascada sin pegar al backend (más
   * rápido para feedback en UI).
   */
  function effectivePriceLocal(product: Product, variant: ProductVariant | null): number {
    if (variant) {
      const variantItem = itemsByKey.get(itemKey(product.id, variant.id));
      if (variantItem) return variantItem.price;
      const productItem = itemsByKey.get(itemKey(product.id, null));
      if (productItem) return productItem.price;
      if (variant.priceOverride != null) return variant.priceOverride;
      return product.price;
    }
    const productItem = itemsByKey.get(itemKey(product.id, null));
    if (productItem) return productItem.price;
    return product.price;
  }

  /**
   * Guarda un precio para (productId, variantId|null).
   * Si el input está vacío y existe un item → lo borra (vuelve a cascada).
   */
  async function saveRow(productId: string, variantId: string | null, raw: string) {
    const key = itemKey(productId, variantId);
    const existing = itemsByKey.get(key);
    const trimmed = raw.trim();
    setSavingKey(key);
    try {
      if (trimmed === '') {
        // Vaciar = borrar item si existía.
        if (existing) {
          await data.deletePriceListItem(existing.id);
          setItems((prev) => prev.filter((i) => i.id !== existing.id));
          toast.success('Precio quitado de la lista');
        }
        // Si no existía, no hay nada que hacer (el draft estaba vacío).
        return;
      }
      const price = Number(trimmed);
      if (!Number.isFinite(price) || price < 0) {
        toast.error('Precio inválido');
        return;
      }
      // No-op si no cambió respecto al item existente.
      if (existing && existing.price === price) return;
      const updated = await data.upsertPriceListItem({
        priceListId,
        productId,
        variantId: variantId ?? null,
        price,
      });
      setItems((prev) => {
        const others = prev.filter((i) => i.id !== updated.id);
        return [...others, updated];
      });
      toast.success('Precio guardado');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingKey(null);
      // Limpiar el draft: que la próxima render lea del item guardado.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  /** Borra el override (botón X). */
  async function clearRow(productId: string, variantId: string | null) {
    const key = itemKey(productId, variantId);
    const existing = itemsByKey.get(key);
    if (!existing) return;
    setSavingKey(key);
    try {
      await data.deletePriceListItem(existing.id);
      setItems((prev) => prev.filter((i) => i.id !== existing.id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success('Precio quitado de la lista');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Cargando productos…</div>;
  }

  if (products.length === 0) {
    return (
      <Empty
        title="Todavía no hay productos"
        description="Cargá productos en la pestaña Productos para poder asignarles precios en listas."
      />
    );
  }

  return (
    <div>
      {isDefault && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Esta es la lista <strong>default</strong>. La cascada de precios cae acá si un cliente no tiene
          otra lista asignada. Dejá vacío para usar el precio del producto.
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto por nombre, barcode o SKU…"
          className="pl-9"
        />
      </div>

      {filteredProducts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Sin resultados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Precio base</th>
                <th className="px-3 py-2 w-44">Precio en esta lista</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((product) => {
                const productVariants = variantsByProduct.get(product.id) ?? [];
                const hasMultipleVariants =
                  productVariants.length > 1 ||
                  (productVariants.length === 1 &&
                    Object.keys(productVariants[0].attributes).length > 0);
                const isExpanded = expanded.has(product.id);

                return (
                  <ProductRows
                    key={product.id}
                    product={product}
                    variants={productVariants}
                    hasMultipleVariants={hasMultipleVariants}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(product.id)}
                    itemsByKey={itemsByKey}
                    drafts={drafts}
                    savingKey={savingKey}
                    effectivePriceLocal={effectivePriceLocal}
                    onChange={(key, val) =>
                      setDrafts((prev) => ({ ...prev, [key]: val }))
                    }
                    onSave={saveRow}
                    onClear={clearRow}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-xs text-slate-500">
        Cada cambio se guarda automáticamente al salir del campo. Dejá vacío para usar el precio base.
      </div>
    </div>
  );
}

interface RowsProps {
  product: Product;
  variants: ProductVariant[];
  hasMultipleVariants: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  itemsByKey: Map<string, PriceListItem>;
  drafts: Record<string, string>;
  savingKey: string | null;
  effectivePriceLocal: (product: Product, variant: ProductVariant | null) => number;
  onChange: (key: string, val: string) => void;
  onSave: (productId: string, variantId: string | null, raw: string) => void;
  onClear: (productId: string, variantId: string | null) => void;
}

/** Fila del producto + filas de variantes si se expanden. */
function ProductRows({
  product,
  variants,
  hasMultipleVariants,
  isExpanded,
  onToggle,
  itemsByKey,
  drafts,
  savingKey,
  effectivePriceLocal,
  onChange,
  onSave,
  onClear,
}: RowsProps) {
  const productKey = itemKey(product.id, null);
  const productItem = itemsByKey.get(productKey);
  const productDraft = drafts[productKey];
  const productInputValue =
    productDraft !== undefined ? productDraft : productItem ? String(productItem.price) : '';
  const productEffective = effectivePriceLocal(product, null);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-2 py-2 align-middle">
          {hasMultipleVariants ? (
            <button
              onClick={onToggle}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-navy"
              title={isExpanded ? 'Colapsar variantes' : 'Mostrar variantes'}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <Package className="h-4 w-4 text-slate-300" />
          )}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-navy">{product.name}</div>
          {product.barcode && (
            <div className="font-mono text-[11px] text-slate-400">{product.barcode}</div>
          )}
        </td>
        <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
          {formatARS(product.price)}
        </td>
        <td className="px-3 py-2">
          <PriceInput
            value={productInputValue}
            placeholder={!productItem ? formatARS(productEffective) : ''}
            saving={savingKey === productKey}
            onChange={(v) => onChange(productKey, v)}
            onBlur={() => onSave(product.id, null, productInputValue)}
          />
        </td>
        <td className="px-2 py-2 text-right">
          {productItem ? (
            <button
              onClick={() => onClear(product.id, null)}
              disabled={savingKey === productKey}
              className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-40"
              title="Quitar override (volver a cascada)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </td>
      </tr>

      {hasMultipleVariants &&
        isExpanded &&
        variants
          .filter((v) => v.active)
          .map((variant) => {
            const key = itemKey(product.id, variant.id);
            const item = itemsByKey.get(key);
            const draft = drafts[key];
            const inputValue = draft !== undefined ? draft : item ? String(item.price) : '';
            const variantBase = variant.priceOverride ?? product.price;
            const variantEffective = effectivePriceLocal(product, variant);
            const attrs = Object.entries(variant.attributes)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ');
            return (
              <tr key={variant.id} className={cn('bg-slate-50/50 hover:bg-slate-50')}>
                <td className="px-2 py-2"></td>
                <td className="px-3 py-2 pl-10">
                  <div className="text-xs text-slate-700">
                    {attrs || (variant.isDefault ? 'Variante default' : 'Variante')}
                  </div>
                  {variant.sku && (
                    <div className="font-mono text-[10px] text-slate-400">{variant.sku}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                  {formatARS(variantBase)}
                </td>
                <td className="px-3 py-2">
                  <PriceInput
                    value={inputValue}
                    placeholder={!item ? formatARS(variantEffective) : ''}
                    saving={savingKey === key}
                    onChange={(v) => onChange(key, v)}
                    onBlur={() => onSave(product.id, variant.id, inputValue)}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  {item ? (
                    <button
                      onClick={() => onClear(product.id, variant.id)}
                      disabled={savingKey === key}
                      className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-40"
                      title="Quitar override (volver a cascada)"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
    </>
  );
}

interface PriceInputProps {
  value: string;
  placeholder: string;
  saving: boolean;
  onChange: (val: string) => void;
  onBlur: () => void;
}

function PriceInput({ value, placeholder, saving, onChange, onBlur }: PriceInputProps) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      disabled={saving}
      placeholder={placeholder}
      className={cn(
        'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100',
        saving && 'opacity-60',
      )}
    />
  );
}
