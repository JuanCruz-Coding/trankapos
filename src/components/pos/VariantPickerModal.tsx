import { useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { Product, ProductVariant } from '@/types';

interface Props {
  open: boolean;
  /** Producto al que pertenecen las variantes. `null` cierra el modal. */
  product: Product | null;
  /** Todas las variantes del producto (el modal filtra las inactivas). */
  variants: ProductVariant[];
  onClose: () => void;
  onPick: (variant: ProductVariant) => void;
  /** Stock por `variantId` para mostrar disponibilidad. Opcional. */
  stockByVariant?: Map<string, number>;
}

/**
 * Modal de selección de variante al agregar un producto al carrito.
 *
 * UX:
 * - 1 sola key de atributo (ej. solo talle) → lista de chips.
 * - 2 keys homogéneas (ej. talle × color) → grilla matricial.
 * - 3+ keys o keys heterogéneas → lista plana con atributos listados.
 */
export function VariantPickerModal({
  open,
  product,
  variants,
  onClose,
  onPick,
  stockByVariant,
}: Props) {
  // Solo variantes activas.
  const active = useMemo(() => variants.filter((v) => v.active), [variants]);

  // ¿Todas las variantes comparten las mismas keys de atributos?
  const sharedKeys = useMemo<string[] | null>(() => {
    if (active.length === 0) return null;
    const first = Object.keys(active[0].attributes).sort();
    for (const v of active) {
      const keys = Object.keys(v.attributes).sort();
      if (keys.length !== first.length) return null;
      if (keys.some((k, i) => k !== first[i])) return null;
    }
    return first;
  }, [active]);

  const priceOf = (v: ProductVariant) =>
    v.priceOverride ?? product?.price ?? 0;

  const stockOf = (v: ProductVariant): string => {
    if (!stockByVariant) return '?';
    const q = stockByVariant.get(v.id);
    return q === undefined ? '?' : String(q);
  };

  function renderBody() {
    if (!product) return null;
    if (active.length === 0) {
      return (
        <p className="py-4 text-center text-sm text-slate-500">
          Este producto no tiene variantes activas.
        </p>
      );
    }

    // Caso 1: 1 sola key → lista de chips.
    if (sharedKeys && sharedKeys.length === 1 && active.length <= 20) {
      const key = sharedKeys[0];
      return (
        <div>
          <div className="mb-2 text-xs uppercase text-slate-500">{key}</div>
          <div className="flex flex-wrap gap-2">
            {active.map((v) => (
              <button
                key={v.id}
                onClick={() => onPick(v)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-brand-400 hover:bg-brand-50"
              >
                <div className="font-medium text-navy">{v.attributes[key]}</div>
                <div className="text-[11px] text-slate-500">
                  {formatARS(priceOf(v))} · stock {stockOf(v)}
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Caso 2: 2 keys homogéneas → grilla matricial.
    if (sharedKeys && sharedKeys.length === 2 && active.length <= 20) {
      const [keyX, keyY] = sharedKeys;
      // Recolectar valores únicos de cada dimensión.
      const xValues = Array.from(new Set(active.map((v) => v.attributes[keyX])));
      const yValues = Array.from(new Set(active.map((v) => v.attributes[keyY])));
      // Lookup variant por (x,y).
      const byCell = new Map<string, ProductVariant>();
      active.forEach((v) => {
        byCell.set(`${v.attributes[keyX]}::${v.attributes[keyY]}`, v);
      });

      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs uppercase text-slate-500">
                  {keyY} \ {keyX}
                </th>
                {xValues.map((xv) => (
                  <th
                    key={xv}
                    className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-navy"
                  >
                    {xv}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yValues.map((yv) => (
                <tr key={yv}>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left text-xs font-semibold text-navy">
                    {yv}
                  </th>
                  {xValues.map((xv) => {
                    const v = byCell.get(`${xv}::${yv}`);
                    if (!v) {
                      return (
                        <td
                          key={xv}
                          className="border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs text-slate-300"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={xv}
                        className="border border-slate-200 p-0"
                      >
                        <button
                          onClick={() => onPick(v)}
                          className={cn(
                            'flex h-full w-full flex-col items-center justify-center px-2 py-2 text-center hover:bg-brand-50',
                            'min-w-[80px]',
                          )}
                        >
                          <div className="text-xs font-semibold text-brand-700">
                            {formatARS(priceOf(v))}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            stock {stockOf(v)}
                          </div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // Caso 3 (fallback): lista plana.
    return (
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {active.map((v) => {
          const attrLabel = Object.entries(v.attributes)
            .map(([k, val]) => `${k}: ${val}`)
            .join(', ');
          return (
            <li key={v.id}>
              <button
                onClick={() => onPick(v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-navy">
                    {attrLabel || v.sku || 'Variante'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {v.sku ? `SKU ${v.sku} · ` : ''}stock {stockOf(v)}
                  </div>
                </div>
                <div className="text-sm font-semibold text-brand-700">
                  {formatARS(priceOf(v))}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Elegí una variante — ${product.name}` : 'Elegí una variante'}
      widthClass="max-w-xl"
    >
      {renderBody()}
    </Modal>
  );
}
