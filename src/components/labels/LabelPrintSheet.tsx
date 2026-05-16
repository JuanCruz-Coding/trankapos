import {
  LabelA4Sheet,
  LabelShelfTag,
  LabelSmall,
  LabelThermal80,
  type LabelData,
} from './LabelTemplates';

/**
 * Wrapper que orquesta la impresión.
 *
 * Expande los items según `copiesById` (ej. si copiesById['X']=3, renderiza
 * 3 veces el item con id X), y los entrega al template seleccionado.
 *
 * Para que la impresión salga limpia, este componente envuelve TODO en un
 * `<div id="labels-print">`. El CSS en Labels.tsx oculta el resto de la app
 * en `@media print` y deja visible solo este nodo.
 */

export type LabelTemplate = 'small' | 'a4_24up' | 'shelf' | 'thermal_80';

export interface LabelPrintItem extends LabelData {
  /** Identificador único para mapear copies. ej. `${productId}-${variantId}`. */
  key: string;
}

interface Props {
  items: LabelPrintItem[];
  /** Cantidad de copias por cada item. key = LabelPrintItem.key. Default 1. */
  copiesById: Record<string, number>;
  template: LabelTemplate;
  tenantName?: string;
}

function expandItems(
  items: LabelPrintItem[],
  copiesById: Record<string, number>,
  tenantName?: string,
): LabelData[] {
  const out: LabelData[] = [];
  for (const item of items) {
    const copies = Math.max(0, Math.floor(copiesById[item.key] ?? 1));
    for (let i = 0; i < copies; i++) {
      out.push({
        productName: item.productName,
        attrLabel: item.attrLabel,
        price: item.price,
        barcode: item.barcode,
        tenantName,
      });
    }
  }
  return out;
}

export function LabelPrintSheet({ items, copiesById, template, tenantName }: Props) {
  const expanded = expandItems(items, copiesById, tenantName);

  if (expanded.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 print:hidden">
        Seleccioná productos a la izquierda y poné al menos una copia para ver el preview de impresión.
      </div>
    );
  }

  let content: React.ReactNode = null;

  if (template === 'a4_24up') {
    content = <LabelA4Sheet items={expanded} />;
  } else if (template === 'shelf') {
    content = (
      <div className="flex flex-col gap-4">
        {expanded.map((d, i) => (
          <div
            key={i}
            style={{ pageBreakAfter: 'always' }}
            className="print:break-after-page"
          >
            <LabelShelfTag data={d} />
          </div>
        ))}
      </div>
    );
  } else if (template === 'thermal_80') {
    content = (
      <div className="flex flex-col gap-2 print:gap-0">
        {expanded.map((d, i) => (
          <LabelThermal80 key={i} data={d} />
        ))}
      </div>
    );
  } else {
    // 'small'
    content = (
      <div className="flex flex-wrap gap-2 print:gap-1">
        {expanded.map((d, i) => (
          <LabelSmall key={i} data={d} />
        ))}
      </div>
    );
  }

  return <div id="labels-print">{content}</div>;
}
