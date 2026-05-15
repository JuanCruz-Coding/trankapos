import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatARS } from '@/lib/currency';
import { toast } from '@/stores/toast';
import type { ProductVariant } from '@/types';

interface Props {
  productId: string | null;
  /** Precio del producto (fallback cuando priceOverride es null). */
  basePrice: number;
  baseCost: number;
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
  attributeKeys: string[];
  disabled?: boolean;
}

/**
 * Editor de variantes embebido en el form de producto.
 *
 * Reglas/convenciones importantes:
 *  - Las variantes nuevas (sin id real todavía) llevan id `temp-<uuid>`. Products.tsx
 *    usa ese prefijo para decidir si llama `createVariant` (temp) o `updateVariant` (real).
 *  - El componente solo gestiona estado local — no llama al driver. El padre decide
 *    cuándo persistir.
 *  - La variante con `isDefault=true` no se puede borrar (la backend tampoco lo permite).
 *  - "Generar combinaciones" pide valores CSV por cada attribute key y arma todas las
 *    combinaciones cartesianas. SKU y barcode quedan vacíos; el comercio los completa
 *    después (o los autogenera la backend al guardar — eso ya es responsabilidad del
 *    driver, no de este editor).
 */
export function VariantEditor({
  productId: _productId,
  basePrice,
  baseCost,
  variants,
  onChange,
  attributeKeys,
  disabled,
}: Props) {
  const [comboModal, setComboModal] = useState(false);

  // Detecta combinaciones (clave|valor) duplicadas — todas las variantes deberían
  // ser únicas dentro de un producto.
  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<string>();
    variants.forEach((v) => {
      if (attributeKeys.length === 0) return;
      const sig = attributeKeys.map((k) => `${k}=${(v.attributes[k] ?? '').toLowerCase()}`).join('|');
      const count = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, count);
      if (count > 1) dups.add(sig);
    });
    return dups;
  }, [variants, attributeKeys]);

  function variantSig(v: ProductVariant): string {
    return attributeKeys.map((k) => `${k}=${(v.attributes[k] ?? '').toLowerCase()}`).join('|');
  }

  function makeTempId(): string {
    // crypto.randomUUID está disponible en navegadores modernos; fallback simple por si acaso.
    const rnd =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `temp-${rnd}`;
  }

  function addEmptyVariant() {
    const blank: ProductVariant = {
      id: makeTempId(),
      tenantId: '',
      productId: _productId ?? '',
      sku: null,
      barcode: null,
      attributes: Object.fromEntries(attributeKeys.map((k) => [k, ''])),
      priceOverride: null,
      costOverride: null,
      active: true,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    onChange([...variants, blank]);
  }

  function updateVariant(id: string, patch: Partial<ProductVariant>) {
    onChange(variants.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function updateAttribute(id: string, key: string, val: string) {
    onChange(
      variants.map((v) =>
        v.id === id ? { ...v, attributes: { ...v.attributes, [key]: val } } : v,
      ),
    );
  }

  function removeVariant(id: string) {
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    if (v.isDefault) {
      toast.error('La variante principal no se puede eliminar');
      return;
    }
    onChange(variants.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-700">
          Variantes ({variants.length})
        </div>
        <div className="flex items-center gap-2">
          {attributeKeys.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setComboModal(true)}
              disabled={disabled}
            >
              <Wand2 className="h-3.5 w-3.5" /> Generar combinaciones
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addEmptyVariant}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" /> Agregar variante
          </Button>
        </div>
      </div>

      {variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
          Sin variantes todavía. Agregá al menos una para poder guardar.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">SKU</th>
                <th className="px-2 py-2 font-medium">Código de barras</th>
                {attributeKeys.map((k) => (
                  <th key={k} className="px-2 py-2 font-medium capitalize">
                    {k}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Precio</th>
                <th className="px-2 py-2 text-right font-medium">Costo</th>
                <th className="px-2 py-2 text-center font-medium">Activa</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {variants.map((v) => {
                const isDup = attributeKeys.length > 0 && duplicateKeys.has(variantSig(v));
                return (
                  <tr key={v.id} className={isDup ? 'bg-red-50' : ''}>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 font-mono text-xs"
                        value={v.sku ?? ''}
                        onChange={(e) =>
                          updateVariant(v.id, { sku: e.target.value || null })
                        }
                        placeholder={v.isDefault ? 'auto' : '—'}
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 font-mono text-xs"
                        value={v.barcode ?? ''}
                        onChange={(e) =>
                          updateVariant(v.id, { barcode: e.target.value || null })
                        }
                        placeholder="—"
                        disabled={disabled}
                      />
                    </td>
                    {attributeKeys.map((k) => (
                      <td key={k} className="px-2 py-1.5">
                        <Input
                          className="h-8 text-xs"
                          value={v.attributes[k] ?? ''}
                          onChange={(e) => updateAttribute(v.id, k, e.target.value)}
                          placeholder={k}
                          disabled={disabled || v.isDefault}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8 w-24 text-right text-xs tabular-nums"
                        value={v.priceOverride ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateVariant(v.id, {
                            priceOverride: raw === '' ? null : Number(raw),
                          });
                        }}
                        placeholder={formatARS(basePrice)}
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8 w-24 text-right text-xs tabular-nums"
                        value={v.costOverride ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateVariant(v.id, {
                            costOverride: raw === '' ? null : Number(raw),
                          });
                        }}
                        placeholder={formatARS(baseCost)}
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={v.active}
                        onChange={(e) =>
                          updateVariant(v.id, { active: e.target.checked })
                        }
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {v.isDefault ? (
                        <Tooltip label="Es la variante principal, no se puede eliminar">
                          <button
                            type="button"
                            className="cursor-not-allowed rounded-md p-1.5 text-slate-300"
                            disabled
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeVariant(v.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          disabled={disabled}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {duplicateKeys.size > 0 && (
        <p className="text-[11px] text-red-600">
          Hay variantes con la misma combinación de atributos. Cada combinación debe ser única.
        </p>
      )}

      {comboModal && (
        <GenerateCombinationsModal
          attributeKeys={attributeKeys}
          onClose={() => setComboModal(false)}
          onGenerate={(combos) => {
            // Reemplaza solo las variantes "vacías" no-default; preserva default y las
            // que el comercio ya cargó con datos (SKU/barcode no vacíos). Igual evita
            // crear duplicados de combinaciones existentes.
            const existingSigs = new Set(
              variants.map((v) =>
                attributeKeys.map((k) => `${k}=${(v.attributes[k] ?? '').toLowerCase()}`).join('|'),
              ),
            );
            const newOnes: ProductVariant[] = combos
              .filter((attrs) => {
                const sig = attributeKeys.map((k) => `${k}=${(attrs[k] ?? '').toLowerCase()}`).join('|');
                return !existingSigs.has(sig);
              })
              .map((attrs) => ({
                id: makeTempId(),
                tenantId: '',
                productId: _productId ?? '',
                sku: null,
                barcode: null,
                attributes: attrs,
                priceOverride: null,
                costOverride: null,
                active: true,
                isDefault: false,
                createdAt: new Date().toISOString(),
              }));
            if (newOnes.length === 0) {
              toast.error('Esas combinaciones ya existen');
              return;
            }
            onChange([...variants, ...newOnes]);
            setComboModal(false);
            toast.success(`Se agregaron ${newOnes.length} variante(s)`);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal: Generar combinaciones                                                */
/* -------------------------------------------------------------------------- */

interface ComboProps {
  attributeKeys: string[];
  onClose: () => void;
  onGenerate: (combos: Record<string, string>[]) => void;
}

function GenerateCombinationsModal({ attributeKeys, onClose, onGenerate }: ComboProps) {
  // Por cada attribute key, el comercio carga un CSV de valores. Ej. talle: "S, M, L, XL".
  const [valuesByKey, setValuesByKey] = useState<Record<string, string>>(
    Object.fromEntries(attributeKeys.map((k) => [k, ''])),
  );

  function parseCsv(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const parsed = attributeKeys.map((k) => ({
    key: k,
    values: parseCsv(valuesByKey[k] ?? ''),
  }));
  const totalCombos = parsed.reduce((acc, p) => acc * (p.values.length || 0), 1);
  const canGenerate = parsed.every((p) => p.values.length > 0);

  function generate() {
    if (!canGenerate) return;
    // Producto cartesiano. Empezamos con [{}], y por cada key expandimos.
    let combos: Record<string, string>[] = [{}];
    for (const { key, values } of parsed) {
      const next: Record<string, string>[] = [];
      for (const combo of combos) {
        for (const v of values) {
          next.push({ ...combo, [key]: v });
        }
      }
      combos = next;
    }
    onGenerate(combos);
  }

  return (
    <Modal open onClose={onClose} title="Generar combinaciones de variantes">
      <div className="space-y-3">
        <p className="text-xs text-slate-600">
          Cargá los valores posibles de cada atributo separados por coma. Vamos a generar todas las combinaciones
          ({totalCombos > 0 && canGenerate ? totalCombos : '—'} variante{totalCombos === 1 ? '' : 's'}).
        </p>
        {attributeKeys.map((k) => (
          <div key={k}>
            <label className="mb-1 block text-xs font-medium text-slate-700 capitalize">{k}</label>
            <Input
              value={valuesByKey[k] ?? ''}
              onChange={(e) => setValuesByKey({ ...valuesByKey, [k]: e.target.value })}
              placeholder={k === 'talle' ? 'S, M, L, XL' : k === 'color' ? 'Negro, Blanco, Rojo' : 'valor1, valor2, ...'}
            />
          </div>
        ))}
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Las variantes nuevas se agregan sin SKU ni código de barras. Completalos manualmente o dejalos vacíos para que el sistema los autogenere al guardar.
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={generate} disabled={!canGenerate}>
            Generar {canGenerate ? `${totalCombos} variante${totalCombos === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
