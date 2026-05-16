import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Printer, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  LabelPrintSheet,
  type LabelPrintItem,
  type LabelTemplate,
} from '@/components/labels/LabelPrintSheet';
import type { Product, ProductVariant } from '@/types';

// Importa los estilos @media print de la página.
import './labels-print.css';

interface RowItem {
  /** key único usado por copiesById y selección. */
  key: string;
  product: Product;
  variant: ProductVariant;
  /** Display: precio efectivo (variant override > product price). */
  effectivePrice: number;
  /** Display: código preferido para imprimir (variant.barcode → variant.sku → product.barcode → product.sku). */
  preferredCode: string;
  /** Display: "M / Negro" o "" si no tiene attrs. */
  attrLabel: string;
}

const TEMPLATE_OPTIONS: {
  value: LabelTemplate;
  title: string;
  description: string;
}[] = [
  {
    value: 'small',
    title: 'Pequeña 50×25 mm',
    description: 'Etiqueta chica de prenda. Imprime una al lado de la otra.',
  },
  {
    value: 'a4_24up',
    title: 'Hoja A4 — 24 etiquetas',
    description: 'Plantilla 3×8 (70×35 mm cada una). Ideal para hojas adhesivas.',
  },
  {
    value: 'shelf',
    title: 'Cartel de góndola',
    description: 'A6 horizontal con precio gigante. Una por hoja.',
  },
  {
    value: 'thermal_80',
    title: 'Térmica 80 mm',
    description: 'Tira continua para impresora de tickets.',
  },
];

function buildAttrLabel(attrs: Record<string, string> | null | undefined): string {
  if (!attrs) return '';
  const entries = Object.entries(attrs).filter(([, v]) => v && String(v).trim());
  if (entries.length === 0) return '';
  return entries.map(([, v]) => v).join(' / ');
}

function pickCode(product: Product, variant: ProductVariant): string {
  return (
    variant.barcode?.trim() ||
    variant.sku?.trim() ||
    product.barcode?.trim() ||
    product.sku?.trim() ||
    ''
  );
}

export default function Labels() {
  const { session } = useAuth();

  const products = useLiveQuery(async () => {
    if (!session) return [];
    return data.listProducts();
  }, [session?.tenantId]);

  const allVariants = useLiveQuery(async () => {
    if (!session) return [];
    return data.listVariants();
  }, [session?.tenantId]);

  const [tenantName, setTenantName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    if (!session) return;
    data
      .getTenant()
      .then((t) => {
        if (!cancelled) setTenantName(t?.name ?? '');
      })
      .catch(() => {
        /* silenciar — el footer del tenant es opcional */
      });
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId]);

  const [template, setTemplate] = useState<LabelTemplate>('a4_24up');
  const [copiesById, setCopiesById] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');

  // Armamos un row por (producto, variante). Sin variantes el producto tiene
  // 1 default con attributes={} → muestra solo "Producto".
  const rows: RowItem[] = useMemo(() => {
    if (!products || !allVariants) return [];
    const byProduct = new Map<string, ProductVariant[]>();
    for (const v of allVariants) {
      if (!v.active) continue;
      const arr = byProduct.get(v.productId) ?? [];
      arr.push(v);
      byProduct.set(v.productId, arr);
    }
    const out: RowItem[] = [];
    for (const p of products) {
      if (!p.active) continue;
      const variants = byProduct.get(p.id) ?? [];
      // Defensive: si no hay variantes registradas, no podemos imprimir nada
      // útil para este producto. Saltamos.
      if (variants.length === 0) continue;
      for (const v of variants) {
        out.push({
          key: `${p.id}-${v.id}`,
          product: p,
          variant: v,
          effectivePrice: v.priceOverride ?? p.price,
          preferredCode: pickCode(p, v),
          attrLabel: buildAttrLabel(v.attributes),
        });
      }
    }
    return out;
  }, [products, allVariants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.product.name.toLowerCase().includes(q) ||
        r.preferredCode.toLowerCase().includes(q) ||
        r.attrLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  const selectedItems: LabelPrintItem[] = useMemo(() => {
    return rows
      .filter((r) => (copiesById[r.key] ?? 0) > 0)
      .map((r) => ({
        key: r.key,
        productName: r.product.name,
        attrLabel: r.attrLabel,
        price: r.effectivePrice,
        barcode: r.preferredCode,
      }));
  }, [rows, copiesById]);

  const totalLabels = useMemo(() => {
    return selectedItems.reduce(
      (acc, item) => acc + Math.max(0, Math.floor(copiesById[item.key] ?? 0)),
      0,
    );
  }, [selectedItems, copiesById]);

  function setCopies(key: string, value: number) {
    setCopiesById((prev) => {
      const next = { ...prev };
      if (value <= 0) {
        delete next[key];
      } else {
        next[key] = Math.floor(value);
      }
      return next;
    });
  }

  function toggleRow(key: string) {
    setCopiesById((prev) => {
      const current = prev[key] ?? 0;
      if (current > 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: 1 };
    });
  }

  function selectAllVisible() {
    setCopiesById((prev) => {
      const next = { ...prev };
      for (const r of filtered) {
        if (!next[r.key]) next[r.key] = 1;
      }
      return next;
    });
  }

  function clearSelection() {
    setCopiesById({});
  }

  function handlePrint() {
    if (totalLabels === 0) return;
    // Inyectamos un @page específico para esta impresión y lo removemos al
    // terminar, así no pisamos el @page del ticket (index.css) que sigue
    // cargado globalmente cuando el usuario navega entre Labels y POS.
    const pageSize = (() => {
      switch (template) {
        case 'a4_24up':
          return 'A4';
        case 'shelf':
          return '148mm 105mm'; // A6 landscape
        case 'thermal_80':
          return '80mm auto';
        case 'small':
        default:
          return 'auto';
      }
    })();

    const style = document.createElement('style');
    style.setAttribute('data-labels-print', '1');
    style.textContent = `@media print { @page { size: ${pageSize}; margin: 0; } }`;
    document.head.appendChild(style);

    const cleanup = () => {
      if (style.parentNode) style.parentNode.removeChild(style);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    try {
      window.print();
    } finally {
      // Fallback por si afterprint no se dispara en algún navegador.
      setTimeout(cleanup, 1000);
    }
  }

  if (!products || !allVariants) {
    return (
      <div>
        <PageHeader title="Etiquetas e impresiones" />
        <div className="text-sm text-slate-500">Cargando productos…</div>
      </div>
    );
  }

  return (
    <div className="labels-page">
      {/* No usamos un wrapper print:hidden global porque eso esconde también
          al preview (que contiene #labels-print). En su lugar marcamos como
          print:hidden cada elemento que NO queremos que salga (header,
          sidebar) y dejamos el preview visible. La regla de visibility-based
          de labels-print.css se encarga del resto: body * queda oculto y
          solo #labels-print se muestra. */}
      <div className="print:hidden">
        <PageHeader
          title="Etiquetas e impresiones"
          subtitle="Imprimí etiquetas con código de barras y precio para tus productos."
          actions={
            <Button onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4" />
              Imprimir ({totalLabels})
            </Button>
          }
        />
      </div>

      {rows.length === 0 ? (
        <div className="print:hidden">
          <Empty
            title="No hay productos para imprimir"
            description="Cargá productos primero desde la sección Productos para poder generar etiquetas."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
            {/* Sidebar izquierdo — print:hidden para que NO salga al imprimir */}
            <div className="flex flex-col gap-4 print:hidden">
              {/* Selector de plantilla */}
              <div>
                <div className="eyebrow mb-2 text-slate-500">Plantilla</div>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTemplate(opt.value)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition',
                        template === opt.value
                          ? 'border-brand-500 bg-ice ring-2 ring-brand-200'
                          : 'border-slate-200 bg-white hover:border-slate-300',
                      )}
                    >
                      <TemplateThumb template={opt.value} active={template === opt.value} />
                      <div className="mt-1 text-xs font-semibold text-navy">{opt.title}</div>
                      <div className="text-[11px] leading-tight text-slate-500">
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Buscador */}
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Buscar por nombre, código o atributo"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {filtered.length} item{filtered.length === 1 ? '' : 's'}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={selectAllVisible}
                    >
                      Seleccionar todos
                    </button>
                    <button
                      type="button"
                      className="text-slate-500 hover:underline"
                      onClick={clearSelection}
                    >
                      Quitar selección
                    </button>
                  </div>
                </div>
              </div>

              {/* Lista de productos / variantes */}
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Sin resultados para "{search}".
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filtered.map((r) => {
                      const copies = copiesById[r.key] ?? 0;
                      const isSelected = copies > 0;
                      return (
                        <li
                          key={r.key}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2',
                            isSelected && 'bg-ice/40',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(r.key)}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {r.product.name}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              {r.attrLabel && <span>{r.attrLabel}</span>}
                              {r.preferredCode ? (
                                <span className="font-mono text-[11px]">{r.preferredCode}</span>
                              ) : (
                                <span className="italic text-amber-600">Sin código</span>
                              )}
                              <span className="ml-auto font-semibold text-slate-700">
                                {formatARS(r.effectivePrice)}
                              </span>
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={copies}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setCopies(r.key, Number.isFinite(v) && v >= 0 ? v : 0);
                            }}
                            className="h-8 w-14 rounded-md border border-slate-300 px-2 text-center text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                            aria-label="Copias"
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Preview derecho — el contenedor del sheet (LabelPrintSheet)
                lleva id="labels-print" y queda visible en pantalla Y en
                print. El resto del body (header, sidebar, navbar) sí queda
                oculto durante la impresión gracias a labels-print.css. */}
            <div>
              <div className="eyebrow mb-2 text-slate-500 print:hidden">
                Preview ({totalLabels} etiquetas)
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 print:border-0 print:bg-white print:p-0">
                {totalLabels === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 print:hidden">
                    Tocá un producto a la izquierda y poné al menos 1 copia para verlo acá.
                  </div>
                ) : (
                  <div className="overflow-auto print:overflow-visible">
                    <LabelPrintSheet
                      items={selectedItems}
                      copiesById={copiesById}
                      template={template}
                      tenantName={tenantName}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Miniatura visual de cada plantilla — pura presentación.
// ─────────────────────────────────────────────────────────────────────────

function TemplateThumb({ template, active }: { template: LabelTemplate; active: boolean }) {
  const stroke = active ? '#1565F0' : '#94a3b8';
  const fill = active ? '#E8F2FF' : '#f8fafc';

  if (template === 'small') {
    return (
      <svg viewBox="0 0 80 40" className="h-12 w-full">
        <rect x="1" y="6" width="34" height="28" rx="2" fill={fill} stroke={stroke} />
        <rect x="40" y="6" width="34" height="28" rx="2" fill={fill} stroke={stroke} />
        <rect x="4" y="14" width="28" height="12" fill={stroke} opacity="0.4" />
        <rect x="43" y="14" width="28" height="12" fill={stroke} opacity="0.4" />
      </svg>
    );
  }
  if (template === 'a4_24up') {
    return (
      <svg viewBox="0 0 60 80" className="h-12 w-full">
        <rect x="1" y="1" width="58" height="78" rx="2" fill={fill} stroke={stroke} />
        {Array.from({ length: 8 }).map((_, row) =>
          Array.from({ length: 3 }).map((_, col) => (
            <rect
              key={`${row}-${col}`}
              x={4 + col * 18}
              y={4 + row * 9}
              width={16}
              height={7}
              fill="white"
              stroke={stroke}
              strokeWidth="0.4"
            />
          )),
        )}
      </svg>
    );
  }
  if (template === 'shelf') {
    return (
      <svg viewBox="0 0 80 50" className="h-12 w-full">
        <rect x="1" y="1" width="78" height="48" rx="2" fill={fill} stroke={stroke} />
        <text
          x="40"
          y="32"
          fontSize="20"
          fontWeight="bold"
          textAnchor="middle"
          fill={stroke}
        >
          $$$
        </text>
        <rect x="6" y="40" width="22" height="6" fill={stroke} opacity="0.4" />
      </svg>
    );
  }
  // thermal_80
  return (
    <svg viewBox="0 0 40 60" className="h-12 w-full">
      <rect x="6" y="2" width="28" height="56" rx="1" fill={fill} stroke={stroke} />
      <line x1="6" y1="20" x2="34" y2="20" stroke={stroke} strokeDasharray="2 2" />
      <line x1="6" y1="40" x2="34" y2="40" stroke={stroke} strokeDasharray="2 2" />
      <rect x="10" y="8" width="20" height="8" fill={stroke} opacity="0.4" />
      <rect x="10" y="28" width="20" height="8" fill={stroke} opacity="0.4" />
      <rect x="10" y="48" width="20" height="8" fill={stroke} opacity="0.4" />
    </svg>
  );
}

