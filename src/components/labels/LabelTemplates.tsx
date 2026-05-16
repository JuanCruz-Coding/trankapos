import { formatARS } from '@/lib/currency';
import { BarcodeSvg } from './BarcodeSvg';

/**
 * Datos de una etiqueta individual. Cualquier template los consume.
 */
export interface LabelData {
  productName: string;
  /** ej. "M / Negro". Vacío si producto sin variantes. */
  attrLabel: string;
  price: number;
  /** EAN o SKU. Si está vacío, BarcodeSvg muestra "Sin código". */
  barcode: string;
  /** Opcional, footer para etiquetas grandes. */
  tenantName?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// LabelSmall — 50x25mm. Ideal para etiquetas chicas de indumentaria.
// ─────────────────────────────────────────────────────────────────────────

export function LabelSmall({ data }: { data: LabelData }) {
  return (
    <div
      className="flex flex-col overflow-hidden border border-dashed border-slate-300 bg-white box-border print:border-0"
      style={{
        width: '50mm',
        height: '25mm',
        padding: '1mm',
      }}
    >
      <div className="flex items-start justify-between gap-1 leading-tight">
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-semibold text-black"
            style={{ fontSize: '7pt', lineHeight: 1.1 }}
          >
            {data.productName}
          </div>
          {data.attrLabel && (
            <div
              className="truncate text-slate-500"
              style={{ fontSize: '6pt', lineHeight: 1.1 }}
            >
              {data.attrLabel}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <BarcodeSvg
          value={data.barcode}
          height={22}
          width={1}
          fontSize={6}
          displayValue={true}
        />
      </div>

      <div
        className="text-right font-bold text-black"
        style={{ fontSize: '11pt', lineHeight: 1 }}
      >
        {formatARS(data.price)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LabelA4Cell — celda de hoja A4 24-up (3 cols × 8 rows). 70x35mm.
// ─────────────────────────────────────────────────────────────────────────

export function LabelA4Cell({ data }: { data: LabelData }) {
  return (
    <div
      className="flex flex-col overflow-hidden border border-dashed border-slate-300 bg-white box-border print:border-0"
      style={{
        width: '70mm',
        height: '35mm',
        padding: '2mm',
      }}
    >
      <div className="leading-tight">
        <div
          className="truncate font-semibold text-black"
          style={{ fontSize: '9pt', lineHeight: 1.15 }}
        >
          {data.productName}
        </div>
        {data.attrLabel && (
          <div
            className="truncate text-slate-500"
            style={{ fontSize: '7pt', lineHeight: 1.1 }}
          >
            {data.attrLabel}
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center py-1">
        <BarcodeSvg value={data.barcode} height={30} width={1.2} fontSize={8} displayValue={true} />
      </div>

      <div
        className="text-right font-bold text-black"
        style={{ fontSize: '14pt', lineHeight: 1 }}
      >
        {formatARS(data.price)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LabelA4Sheet — grilla 3×8 (24 etiquetas por hoja A4). Pagina cada 24.
// ─────────────────────────────────────────────────────────────────────────

const A4_PER_PAGE = 24;

export function LabelA4Sheet({ items }: { items: LabelData[] }) {
  const pages: LabelData[][] = [];
  for (let i = 0; i < items.length; i += A4_PER_PAGE) {
    pages.push(items.slice(i, i + A4_PER_PAGE));
  }

  if (pages.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {pages.map((pageItems, pageIdx) => (
        <div
          key={pageIdx}
          className="grid bg-white print:break-after-page"
          style={{
            width: '210mm',
            minHeight: '297mm',
            gridTemplateColumns: 'repeat(3, 70mm)',
            gridAutoRows: '35mm',
            gap: '0mm',
            padding: '0mm 0mm 0mm 0mm',
            // Centrar la grilla en la hoja A4. A4 = 210x297mm. Grilla 3*70 = 210mm
            // de ancho exactos. En alto 8*35 = 280mm, así que el restante 17mm se
            // reparte arriba/abajo (~8.5mm cada lado).
            paddingTop: '8.5mm',
            paddingBottom: '8.5mm',
            justifyContent: 'center',
            pageBreakAfter: 'always',
          }}
        >
          {pageItems.map((item, i) => (
            <LabelA4Cell key={i} data={item} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LabelShelfTag — cartel de góndola/estante A6 landscape (148x105mm).
// ─────────────────────────────────────────────────────────────────────────

export function LabelShelfTag({ data }: { data: LabelData }) {
  return (
    <div
      className="flex flex-col bg-white box-border border border-dashed border-slate-300 print:border-0"
      style={{
        width: '148mm',
        height: '105mm',
        padding: '6mm',
      }}
    >
      <div className="border-b border-slate-200 pb-2">
        <div
          className="font-display font-bold text-navy"
          style={{ fontSize: '18pt', lineHeight: 1.1 }}
        >
          {data.productName}
        </div>
        {data.attrLabel && (
          <div className="mt-0.5 text-slate-600" style={{ fontSize: '12pt' }}>
            {data.attrLabel}
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div
          className="font-display font-bold text-brand-700"
          style={{ fontSize: '60pt', lineHeight: 1, letterSpacing: '-0.02em' }}
        >
          {formatARS(data.price)}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-end">
          <BarcodeSvg value={data.barcode} height={22} width={1.4} fontSize={9} displayValue={true} />
        </div>
        {data.tenantName && (
          <div className="text-right text-slate-400" style={{ fontSize: '9pt' }}>
            {data.tenantName}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LabelThermal80 — formato continuo 80mm (impresora térmica de tickets).
// ─────────────────────────────────────────────────────────────────────────

export function LabelThermal80({ data }: { data: LabelData }) {
  return (
    <div
      className="flex flex-col bg-white box-border border-b border-dashed border-slate-300"
      style={{
        width: '80mm',
        padding: '3mm 4mm',
      }}
    >
      <div
        className="font-semibold text-black"
        style={{ fontSize: '12pt', lineHeight: 1.15 }}
      >
        {data.productName}
      </div>
      {data.attrLabel && (
        <div className="text-slate-600" style={{ fontSize: '9pt', lineHeight: 1.1 }}>
          {data.attrLabel}
        </div>
      )}

      <div className="my-1 flex justify-center">
        <BarcodeSvg value={data.barcode} height={36} width={1.6} fontSize={10} displayValue={true} />
      </div>

      <div
        className="text-right font-bold text-black"
        style={{ fontSize: '16pt', lineHeight: 1 }}
      >
        {formatARS(data.price)}
      </div>
    </div>
  );
}
