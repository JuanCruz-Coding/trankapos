import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, Info, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { addMoney, subMoney } from '@/lib/money';
import type { Product, Sale } from '@/types';
import type { AfipDocumentDetail } from '@/data/driver';

interface Props {
  /** Ventas filtradas por el wrapper Reports (rango, status, categoría, branch). */
  filtered: Sale[];
  rangeFrom: Date;
  rangeTo: Date;
  /** Catálogo para calcular margen con cost actual. */
  products: Product[];
}

/**
 * Helper local de exportación CSV (mismo patrón que ProductosTab/Reports).
 * Incluye BOM para que Excel detecte UTF-8 correctamente.
 */
function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Label legible para Factura A/B/C en CSV y tabla. */
function letterLabel(letter: AfipDocumentDetail['docLetter']): string {
  return `Factura ${letter}`;
}

/** Número de comprobante padded: 00001-00000123. "—" si todavía no tiene número. */
function formatVoucherNumber(doc: AfipDocumentDetail): string {
  if (doc.voucherNumber === null) return '—';
  const pv = String(doc.salesPoint).padStart(5, '0');
  const nro = String(doc.voucherNumber).padStart(8, '0');
  return `${pv}-${nro}`;
}

/** Fecha dd/MM/yyyy para libro IVA (formato estándar AFIP). */
function formatAfipDate(iso: string): string {
  return format(new Date(iso), 'dd/MM/yyyy');
}

/** Calcula el porcentaje de variación entre dos valores. null si el anterior es 0. */
function pctDelta(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

/**
 * FinancieroTab — Pieza B del Sprint RPT.
 *
 * Reportes:
 *  1.1. Margen bruto (estimado, con CAVEAT por costo actual)
 *  1.2. Comparativa período actual vs anterior (mismo tamaño)
 *  1.3. Libro IVA Ventas (facturas autorizadas en el rango) + CSV
 *
 * Decisiones / TODOs:
 *  - El margen usa `products.cost` ACTUAL (no snapshot histórico). Se muestra
 *    warning amber arriba del bloque. Snapshot histórico queda para otro sprint.
 *  - El libro IVA NO tiene acceso a `raw_request` (no expuesto por el driver),
 *    así que neto/IVA se derivan del Sale linkado por saleId con un cálculo
 *    aproximado por `letter` (A/C: 21% asumido; B: total ya incluye IVA).
 *    Para un cálculo exacto necesitaríamos exponer afip_documents.raw_request
 *    en el driver. Queda como TODO.
 */
export function FinancieroTab({ filtered, rangeFrom, rangeTo, products }: Props) {
  const { session } = useAuth();

  // Map productId → product para acceder a cost (margen) actual.
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // -----------------------------------------------------------------
  // 1.1. Margen bruto (estimado)
  // -----------------------------------------------------------------
  const margen = useMemo(() => {
    let revenueTotals: number[] = [];
    let costTotals: number[] = [];
    for (const s of filtered) {
      if (s.voided) continue;
      revenueTotals.push(s.total);
      for (const it of s.items) {
        const prod = productById.get(it.productId);
        const unitCost = prod?.cost ?? 0;
        // Aproximación: cost_actual * qty (no snapshot histórico, no costOverride por variante).
        costTotals.push(unitCost * it.qty);
      }
    }
    const revenue = addMoney(...revenueTotals);
    const cost = addMoney(...costTotals);
    const margin = subMoney(revenue, cost);
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return { revenue, cost, margin, marginPct };
  }, [filtered, productById]);

  // -----------------------------------------------------------------
  // 1.2. Comparativa período actual vs anterior
  // -----------------------------------------------------------------
  // Necesitamos TODAS las ventas para poder filtrar el período anterior, no solo `filtered`.
  // useLiveQuery se re-ejecuta cuando cambia el tenant.
  const allSales = useLiveQuery(() => data.listSales({}), [session?.tenantId]);

  // Tamaño del rango en ms; el período anterior es [from - size, from].
  const prevRange = useMemo(() => {
    const size = rangeTo.getTime() - rangeFrom.getTime();
    return {
      from: new Date(rangeFrom.getTime() - size),
      to: new Date(rangeFrom.getTime()),
    };
  }, [rangeFrom, rangeTo]);

  const comparativa = useMemo(() => {
    // Período actual usa `filtered` directamente (no anuladas — ya viene filtrado por status).
    // Para consistencia con período anterior, filtro voided=false explícitamente.
    const actual = filtered.filter((s) => !s.voided);
    const actualRevenue = addMoney(...actual.map((s) => s.total));
    const actualCount = actual.length;
    const actualAvg = actualCount > 0 ? actualRevenue / actualCount : 0;

    // Período anterior: filtro sobre allSales con mismas reglas básicas (voided=false).
    // No reaplicamos categoría/branch porque no las tenemos acá; este reporte es de
    // comparación temporal pura. Si querés acotar por branch/categoría, lo agregamos.
    const prev = (allSales ?? []).filter((s) => {
      if (s.voided) return false;
      const d = new Date(s.createdAt);
      if (d < prevRange.from) return false;
      if (d >= prevRange.to) return false;
      return true;
    });
    const prevRevenue = addMoney(...prev.map((s) => s.total));
    const prevCount = prev.length;
    const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

    return {
      actualRevenue,
      actualCount,
      actualAvg,
      prevRevenue,
      prevCount,
      prevAvg,
      revenueDelta: pctDelta(actualRevenue, prevRevenue),
      countDelta: pctDelta(actualCount, prevCount),
      avgDelta: pctDelta(actualAvg, prevAvg),
    };
  }, [filtered, allSales, prevRange]);

  // -----------------------------------------------------------------
  // 1.3. Libro IVA Ventas (Facturas autorizadas en el rango)
  // -----------------------------------------------------------------
  const [afipDocs, setAfipDocs] = useState<AfipDocumentDetail[]>([]);
  const [loadingAfip, setLoadingAfip] = useState(true);
  const [afipError, setAfipError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAfip(true);
    setAfipError(null);
    void (async () => {
      try {
        const result = await data.listAfipDocuments({
          status: 'authorized',
          from: rangeFrom.toISOString(),
          to: rangeTo.toISOString(),
          limit: 500,
        });
        if (!cancelled) setAfipDocs(result);
      } catch (err) {
        if (!cancelled) {
          setAfipDocs([]);
          setAfipError((err as Error).message);
        }
      } finally {
        if (!cancelled) setLoadingAfip(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, rangeFrom, rangeTo]);

  // Map saleId → Sale para resolver receptor + total cuando armemos el libro IVA.
  const saleById = useMemo(() => {
    const map = new Map<string, Sale>();
    for (const s of allSales ?? []) map.set(s.id, s);
    return map;
  }, [allSales]);

  // Filas del libro IVA: solo facturas (NC va a libro IVA Compras del receptor).
  type IvaRow = {
    docId: string;
    fecha: string;
    tipo: string;
    numero: string;
    receptor: string;
    docNumber: string;
    ivaCondicion: string;
    neto: number;
    iva: number;
    total: number;
    cae: string;
  };

  const libroIva = useMemo<IvaRow[]>(() => {
    return afipDocs
      .filter((d) => d.docType === 'factura')
      .map((d) => {
        const sale = d.saleId ? saleById.get(d.saleId) : null;
        const total = sale?.total ?? 0;
        // Cálculo aproximado de IVA según letra:
        //  - A: total = neto + 21%. neto = total / 1.21
        //  - B: total ya incluye IVA discriminado pero al consumidor; idem 1.21
        //  - C: monotributista no factura IVA → neto = total, iva = 0
        // TODO: cuando expongamos raw_request en el driver, calcular el desglose real.
        let neto: number;
        let iva: number;
        if (d.docLetter === 'C') {
          neto = total;
          iva = 0;
        } else {
          neto = total / 1.21;
          iva = total - neto;
        }
        return {
          docId: d.id,
          fecha: formatAfipDate(d.emittedAt ?? d.createdAt),
          tipo: letterLabel(d.docLetter),
          numero: formatVoucherNumber(d),
          receptor: sale?.customerLegalName ?? 'Consumidor Final',
          docNumber: sale?.customerDocNumber ?? '0',
          ivaCondicion: sale?.customerIvaCondition ?? 'consumidor_final',
          neto,
          iva,
          total,
          cae: d.cae ?? '—',
        };
      });
  }, [afipDocs, saleById]);

  const libroIvaTotals = useMemo(() => {
    return libroIva.reduce(
      (acc, r) => ({
        neto: addMoney(acc.neto, r.neto),
        iva: addMoney(acc.iva, r.iva),
        total: addMoney(acc.total, r.total),
      }),
      { neto: 0, iva: 0, total: 0 },
    );
  }, [libroIva]);

  function exportLibroIvaCSV() {
    const rows: (string | number)[][] = [
      [
        'Fecha',
        'Tipo',
        'Numero',
        'Receptor',
        'CUIT/DNI',
        'Condicion IVA',
        'Neto Gravado',
        'IVA 21%',
        'Total',
        'CAE',
      ],
      ...libroIva.map((r) => [
        r.fecha,
        r.tipo,
        r.numero,
        r.receptor,
        r.docNumber,
        r.ivaCondicion,
        r.neto.toFixed(2),
        r.iva.toFixed(2),
        r.total.toFixed(2),
        r.cae,
      ]),
    ];
    downloadCSV(rows, `libro-iva-ventas-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 1.1. Margen bruto */}
      <Card>
        <CardHeader>
          <CardTitle>Margen bruto (estimado)</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Margen calculado con costos <strong>actuales</strong> del catálogo. Para un cálculo
              exacto necesitamos un snapshot del costo al momento de la venta (pendiente para
              sprint posterior).
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Ingresos brutos" value={formatARS(margen.revenue)} />
            <Stat label="Costo de ventas" value={formatARS(margen.cost)} />
            <Stat label="Margen bruto" value={formatARS(margen.margin)} />
            <Stat label="Margen %" value={`${margen.marginPct.toFixed(1)}%`} />
          </div>
        </CardBody>
      </Card>

      {/* 1.2. Comparativa actual vs anterior */}
      <Card>
        <CardHeader>
          <CardTitle>Comparativa: actual vs período anterior</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Período anterior: {format(prevRange.from, 'dd/MM/yyyy')} —{' '}
            {format(prevRange.to, 'dd/MM/yyyy')} (mismo tamaño que el rango actual).
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <CompareStat
              label="Ingresos"
              actual={formatARS(comparativa.actualRevenue)}
              anterior={formatARS(comparativa.prevRevenue)}
              delta={comparativa.revenueDelta}
            />
            <CompareStat
              label="Tickets"
              actual={String(comparativa.actualCount)}
              anterior={String(comparativa.prevCount)}
              delta={comparativa.countDelta}
            />
            <CompareStat
              label="Ticket promedio"
              actual={formatARS(comparativa.actualAvg)}
              anterior={formatARS(comparativa.prevAvg)}
              delta={comparativa.avgDelta}
            />
          </div>
        </CardBody>
      </Card>

      {/* 1.3. Libro IVA Ventas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Libro IVA Ventas</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportLibroIvaCSV}
            disabled={libroIva.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardBody>
          <div className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo facturas autorizadas. El neto/IVA es aproximado a partir del total del comprobante
            según la letra (A/B: 21%, C: sin IVA). TODO: usar el desglose real de
            <code className="mx-1">afip_documents.raw_request</code> cuando esté expuesto en el
            driver.
          </div>

          {afipError ? (
            <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-6 text-center text-sm text-red-600">
              No se pudo cargar el libro IVA: {afipError}
            </div>
          ) : loadingAfip ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Cargando comprobantes…
            </div>
          ) : libroIva.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No hay facturas autorizadas en este rango.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Número</th>
                    <th className="py-2 pr-3">Receptor</th>
                    <th className="py-2 pr-3">CUIT/DNI</th>
                    <th className="py-2 pr-3">Cond. IVA</th>
                    <th className="py-2 pr-3 text-right">Neto</th>
                    <th className="py-2 pr-3 text-right">IVA 21%</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2">CAE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {libroIva.map((r) => (
                    <tr key={r.docId}>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{r.fecha}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.tipo}</td>
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{r.numero}</td>
                      <td className="py-2 pr-3">{r.receptor}</td>
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{r.docNumber}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                        {r.ivaCondicion}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatARS(r.neto)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatARS(r.iva)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                        {formatARS(r.total)}
                      </td>
                      <td className="py-2 tabular-nums text-slate-600 whitespace-nowrap">
                        {r.cae}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 pr-3" colSpan={6}>
                      Totales
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(libroIvaTotals.neto)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(libroIvaTotals.iva)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(libroIvaTotals.total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sub-componentes locales
// ---------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function CompareStat({
  label,
  actual,
  anterior,
  delta,
}: {
  label: string;
  actual: string;
  anterior: string;
  /** % de cambio. null si el anterior era 0 (no comparable). */
  delta: number | null;
}) {
  let deltaNode;
  if (delta === null) {
    deltaNode = (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Minus className="h-3 w-3" />
        sin datos previos
      </span>
    );
  } else if (delta > 0) {
    deltaNode = (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
        <ArrowUpRight className="h-3 w-3" />+{delta.toFixed(1)}%
      </span>
    );
  } else if (delta < 0) {
    deltaNode = (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
        <ArrowDownRight className="h-3 w-3" />
        {delta.toFixed(1)}%
      </span>
    );
  } else {
    deltaNode = (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Minus className="h-3 w-3" />
        0.0%
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{actual}</div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-slate-500">Anterior: {anterior}</span>
        {deltaNode}
      </div>
    </div>
  );
}
