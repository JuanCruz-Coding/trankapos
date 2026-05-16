import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Info, RotateCcw } from 'lucide-react';
import { format, eachDayOfInterval, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { addMoney } from '@/lib/money';
import type { ReturnReason, Sale } from '@/types';
import type { AfipDocumentDetail } from '@/data/driver';

interface Props {
  /** Ventas filtradas por el wrapper Reports (rango, status, categoría, branch). */
  filtered: Sale[];
  rangeFrom: Date;
  rangeTo: Date;
}

/** Kinds que cuentan como una devolución (NC emitida). */
const RETURN_KINDS = new Set(['void_total', 'void_partial', 'exchange_nc']);

/**
 * Helper local de exportación CSV (mismo patrón que ProductosTab/Reports).
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

/** Suma del valor devuelto en una venta: items.qtyReturned * price. */
function returnedAmountForSale(s: Sale): number {
  let total = 0;
  for (const it of s.items) {
    const qr = it.qtyReturned ?? 0;
    if (qr > 0) total += it.price * qr;
  }
  return total;
}

/**
 * DevolucionesTab — Pieza B del Sprint RPT.
 *
 * Reportes:
 *  2.1. Resumen de devoluciones (4 stats)
 *  2.2. Por motivo (agrupa NC por reasonId, conteos + %)
 *  2.3. Por producto (items con qtyReturned > 0 en `filtered`)
 *  2.4. Ratio ventas vs devoluciones (BarChart últimos N días)
 *
 * Decisiones / TODOs:
 *  - El monto $ por NC individual NO está expuesto en AfipDocumentDetail
 *    (no hay campo `total` ni acceso a `raw_request`). Por eso el monto total
 *    devuelto y el monto por producto se calculan desde `sale.items.qtyReturned`,
 *    no desde las NC. Es una aproximación: si hubo múltiples NC sobre la misma
 *    venta, agrupa todo. Para distinguir monto por NC necesitamos exponer el
 *    total del documento. TODO.
 *  - "Por motivo" muestra # de devoluciones y % por conteo (no por monto).
 *    Lo importante del reporte es identificar qué motivos disparan más
 *    devoluciones, y para eso el conteo es válido. Si más adelante queremos
 *    monto por motivo, hay que exponer el total de la NC.
 */
export function DevolucionesTab({ filtered, rangeFrom, rangeTo }: Props) {
  const { session } = useAuth();

  // ---- Carga de AFIP docs (NC del rango) ----
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

  // ---- Carga de motivos ----
  const [reasons, setReasons] = useState<ReturnReason[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await data.listReturnReasons({ activeOnly: false });
        if (!cancelled) setReasons(r);
      } catch {
        if (!cancelled) setReasons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId]);

  const reasonById = useMemo(() => new Map(reasons.map((r) => [r.id, r])), [reasons]);

  // Documentos que son devoluciones (NC con kind de return).
  const returnDocs = useMemo(
    () => afipDocs.filter((d) => RETURN_KINDS.has(d.kind ?? '')),
    [afipDocs],
  );

  // -----------------------------------------------------------------
  // 2.1. Resumen
  // -----------------------------------------------------------------
  // Total devuelto $ se calcula desde `filtered.sales[].items.qtyReturned`.
  // Esto evita depender del monto por NC (no expuesto), pero asume que `filtered`
  // tiene las ventas que recibieron devoluciones en el rango. Si la NC se emitió
  // sobre una venta de un rango anterior, no aparece. Trade-off documentado.
  const resumen = useMemo(() => {
    const totalDevuelto = addMoney(...filtered.map(returnedAmountForSale));
    const numDevoluciones = returnDocs.length;
    const totalVendido = addMoney(
      ...filtered.filter((s) => !s.voided).map((s) => s.total),
    );
    const pctTotal = totalVendido > 0 ? (totalDevuelto / totalVendido) * 100 : 0;
    const promedio = numDevoluciones > 0 ? totalDevuelto / numDevoluciones : 0;
    return { totalDevuelto, numDevoluciones, pctTotal, promedio, totalVendido };
  }, [filtered, returnDocs]);

  // -----------------------------------------------------------------
  // 2.2. Por motivo
  // -----------------------------------------------------------------
  type MotivoAgg = {
    reasonId: string | null;
    label: string;
    count: number;
    pct: number;
  };

  const porMotivo = useMemo<MotivoAgg[]>(() => {
    const map = new Map<string | null, number>();
    for (const d of returnDocs) {
      const key = d.reasonId ?? null;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const total = returnDocs.length;
    return Array.from(map.entries())
      .map(([reasonId, count]) => {
        const label = reasonId
          ? reasonById.get(reasonId)?.label ?? '(motivo eliminado)'
          : 'Otros / sin motivo';
        return {
          reasonId,
          label,
          count,
          pct: total > 0 ? (count / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [returnDocs, reasonById]);

  function exportMotivosCSV() {
    const rows: (string | number)[][] = [
      ['Motivo', 'Devoluciones', '% del total'],
      ...porMotivo.map((m) => [m.label, m.count, m.pct.toFixed(1) + '%']),
    ];
    downloadCSV(rows, `devoluciones-por-motivo-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  // -----------------------------------------------------------------
  // 2.3. Por producto
  // -----------------------------------------------------------------
  type ProductoAgg = {
    productId: string;
    name: string;
    qty: number;
    monto: number;
  };

  const porProducto = useMemo<ProductoAgg[]>(() => {
    const map = new Map<string, { name: string; qty: number; montos: number[] }>();
    for (const s of filtered) {
      for (const it of s.items) {
        const qr = it.qtyReturned ?? 0;
        if (qr <= 0) continue;
        const cur = map.get(it.productId) ?? { name: it.name, qty: 0, montos: [] };
        cur.qty += qr;
        cur.montos.push(it.price * qr);
        map.set(it.productId, cur);
      }
    }
    return Array.from(map.entries())
      .map(([productId, v]) => ({
        productId,
        name: v.name,
        qty: v.qty,
        monto: addMoney(...v.montos),
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20);
  }, [filtered]);

  function exportProductosCSV() {
    const rows: (string | number)[][] = [
      ['Producto', 'Cantidad devuelta', 'Monto estimado'],
      ...porProducto.map((p) => [p.name, p.qty, p.monto.toFixed(2)]),
    ];
    downloadCSV(rows, `devoluciones-por-producto-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  // -----------------------------------------------------------------
  // 2.4. Ratio ventas vs devoluciones (BarChart últimos N días)
  // -----------------------------------------------------------------
  const ratioData = useMemo(() => {
    // N días máximo = 10. Si el rango es > 10, recorto al final del rango.
    const days = Math.min(
      10,
      Math.max(1, differenceInCalendarDays(rangeTo, rangeFrom) + 1),
    );
    const end = rangeTo;
    const start = new Date(end);
    start.setDate(end.getDate() - (days - 1));
    const interval = eachDayOfInterval({ start, end });

    return interval.map((day) => {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);
      const ventasDelDia = filtered.filter((s) => {
        if (s.voided) return false;
        const d = new Date(s.createdAt);
        return d >= dayStart && d <= dayEnd;
      });
      const ventas = addMoney(...ventasDelDia.map((s) => s.total));
      const devoluciones = addMoney(...ventasDelDia.map(returnedAmountForSale));
      return {
        label: format(day, 'dd/MM', { locale: es }),
        ventas,
        devoluciones,
      };
    });
  }, [filtered, rangeFrom, rangeTo]);

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 2.1. Resumen */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen de devoluciones</CardTitle>
        </CardHeader>
        <CardBody>
          {afipError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              No se pudieron cargar las NC desde AFIP: {afipError}. Algunos números pueden estar
              incompletos.
            </div>
          )}
          {loadingAfip ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Cargando devoluciones…
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <Stat label="Total devuelto" value={formatARS(resumen.totalDevuelto)} />
              <Stat label="# Devoluciones" value={String(resumen.numDevoluciones)} />
              <Stat
                label="% del total vendido"
                value={`${resumen.pctTotal.toFixed(1)}%`}
              />
              <Stat label="Devolución promedio" value={formatARS(resumen.promedio)} />
            </div>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            "Total devuelto" y "Promedio" se estiman desde{' '}
            <code className="mx-1">sale.items.qtyReturned × price</code>. El conteo de NC viene de
            AFIP. Para montos exactos por NC necesitamos exponer el total del documento (TODO).
          </p>
        </CardBody>
      </Card>

      {/* 2.2. Por motivo */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Por motivo</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportMotivosCSV}
            disabled={porMotivo.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardBody>
          {porMotivo.length === 0 ? (
            <p className="text-sm text-slate-400">Sin devoluciones en el rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Motivo</th>
                    <th className="py-2 pr-3 text-right">Devoluciones</th>
                    <th className="py-2 text-right">% del total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porMotivo.map((m) => (
                    <tr key={m.reasonId ?? '__null__'}>
                      <td className="py-2 pr-3">{m.label}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.count}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">
                        {m.pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* 2.3. Por producto */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Por producto (top 20)</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportProductosCSV}
            disabled={porProducto.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardBody>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Útil para detectar productos defectuosos o con tasas anómalas de devolución.
          </p>
          {porProducto.length === 0 ? (
            <p className="text-sm text-slate-400">Sin items devueltos en las ventas del rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Producto</th>
                    <th className="py-2 pr-3 text-right">Cant. devuelta</th>
                    <th className="py-2 text-right">Monto estimado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porProducto.map((p) => (
                    <tr key={p.productId}>
                      <td className="py-2 pr-3">{p.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.qty}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">
                        {formatARS(p.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* 2.4. Ratio ventas vs devoluciones */}
      <Card>
        <CardHeader>
          <CardTitle>
            <RotateCcw className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            Ratio ventas vs devoluciones
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Últimos {ratioData.length} día{ratioData.length === 1 ? '' : 's'} del rango.
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratioData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatARS(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ventas" name="Ventas" fill="#196df5" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="devoluciones"
                  name="Devoluciones"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
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
