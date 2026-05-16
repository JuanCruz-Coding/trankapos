import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { addMoney, subMoney } from '@/lib/money';
import type { Product, Sale } from '@/types';

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
