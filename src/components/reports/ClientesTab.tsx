import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Download, UserCheck, UserX, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatARS } from '@/lib/currency';
import { addMoney } from '@/lib/money';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Customer, Sale } from '@/types';

interface Props {
  filtered: Sale[];
  customers: Customer[];
}

/**
 * Helper local de exportación CSV — mismo patrón que Reports.tsx.
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

/**
 * Buckets de ticket size para el histograma de distribución (2.2).
 * El último es "abierto" hacia arriba.
 */
const TICKET_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–1k', min: 0, max: 1000 },
  { label: '1k–5k', min: 1000, max: 5000 },
  { label: '5k–10k', min: 5000, max: 10000 },
  { label: '10k–25k', min: 10000, max: 25000 },
  { label: '25k–50k', min: 25000, max: 50000 },
  { label: '50k+', min: 50000, max: Infinity },
];

/**
 * Clientes Tab — Pieza A del Sprint RPT. Solo visible si businessMode='retail'.
 *
 * Decisión: si customers.length > 200 OR filtered.length > 5000 entramos en
 * "modo liviano" — solo top 30 + agregados. No filtramos por categoría adentro
 * porque las ventas ya vienen filtradas por el wrapper.
 */
export function ClientesTab({ filtered, customers }: Props) {
  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const heavyMode = customers.length > 200 || filtered.length > 5000;

  // 2.1 Top compradores — agregamos por customerId
  const topCustomers = useMemo(() => {
    const map = new Map<
      string,
      { count: number; totals: number[]; lastDate: string; legalName: string }
    >();
    for (const s of filtered) {
      if (!s.customerId) continue;
      const cur = map.get(s.customerId) ?? {
        count: 0,
        totals: [],
        lastDate: s.createdAt,
        legalName: s.customerLegalName ?? '—',
      };
      cur.count++;
      cur.totals.push(s.total);
      if (new Date(s.createdAt) > new Date(cur.lastDate)) {
        cur.lastDate = s.createdAt;
      }
      // Si el customer existe en customers actual, preferimos su legalName de catálogo (más fresco).
      const fromCatalog = customerById.get(s.customerId)?.legalName;
      if (fromCatalog) cur.legalName = fromCatalog;
      map.set(s.customerId, cur);
    }
    return Array.from(map.entries())
      .map(([customerId, v]) => {
        const total = addMoney(...v.totals);
        return {
          customerId,
          legalName: v.legalName,
          count: v.count,
          total,
          avg: v.count > 0 ? total / v.count : 0,
          lastDate: v.lastDate,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered, customerById]);

  const topCustomersDisplay = topCustomers.slice(0, 30);

  // 2.2 Distribución de tickets — histograma por bucket
  const ticketDistribution = useMemo(() => {
    const counts = TICKET_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    for (const s of filtered) {
      const idx = TICKET_BUCKETS.findIndex((b) => s.total >= b.min && s.total < b.max);
      if (idx >= 0) counts[idx].count++;
    }
    return counts;
  }, [filtered]);

  // 2.3 Ventas con/sin cliente
  const customerSplit = useMemo(() => {
    let withCust = 0;
    let withoutCust = 0;
    for (const s of filtered) {
      if (s.customerId) withCust++;
      else withoutCust++;
    }
    const total = withCust + withoutCust;
    return {
      withCust,
      withoutCust,
      total,
      pctWith: total > 0 ? (withCust / total) * 100 : 0,
      pctWithout: total > 0 ? (withoutCust / total) * 100 : 0,
    };
  }, [filtered]);

  // 2.4 Frecuencia de compra — distribución por nº de compras
  const frequency = useMemo(() => {
    let once = 0;
    let mid = 0; // 2–3
    let frequent = 0; // 4+
    for (const c of topCustomers) {
      if (c.count === 1) once++;
      else if (c.count <= 3) mid++;
      else frequent++;
    }
    return { once, mid, frequent };
  }, [topCustomers]);

  function exportTopCustomers() {
    const rows: (string | number)[][] = [
      ['cliente', 'compras', 'total', 'ticket_promedio', 'ultima_compra'],
      ...topCustomers.map((c) => [
        c.legalName,
        c.count,
        c.total.toFixed(2),
        c.avg.toFixed(2),
        c.lastDate,
      ]),
    ];
    downloadCSV(rows, `top-clientes-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  const totalCustomersWithSales = topCustomers.length;
  const motivationalCopy =
    customerSplit.pctWithout > 50
      ? 'Más de la mitad de tus ventas son anónimas. Identificar clientes te permite hacer marketing dirigido, segmentar promociones y construir fidelidad.'
      : null;

  return (
    <div className="space-y-6">
      {/* 2.3 Con/sin cliente */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                <UserCheck className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase text-slate-500">Ventas con cliente</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {customerSplit.pctWith.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-500">
                  {customerSplit.withCust} de {customerSplit.total} ventas
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                <UserX className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase text-slate-500">Ventas anónimas</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {customerSplit.pctWithout.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-500">
                  {customerSplit.withoutCust} de {customerSplit.total} ventas
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {motivationalCopy && (
        <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800">
          <strong>Tip:</strong> {motivationalCopy}
        </div>
      )}

      {/* 2.4 Frecuencia */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-brand-600" />
              Frecuencia de compra
            </div>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {totalCustomersWithSales === 0 ? (
            <p className="text-sm text-slate-400">Sin clientes identificados en el rango.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <FreqCard
                label="Compraron 1 vez"
                count={frequency.once}
                total={totalCustomersWithSales}
                color="slate"
              />
              <FreqCard
                label="Compraron 2–3 veces"
                count={frequency.mid}
                total={totalCustomersWithSales}
                color="amber"
              />
              <FreqCard
                label="Compraron 4+ veces"
                count={frequency.frequent}
                total={totalCustomersWithSales}
                color="emerald"
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* 2.2 Distribución de tickets */}
      <Card>
        <CardHeader>
          <CardTitle>Distribución de tickets</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-2 text-xs text-slate-500">
            Cantidad de ventas por rango de monto. Útil para ajustar la estrategia de precios.
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ticketDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#196df5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* 2.1 Top compradores */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Top compradores</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={exportTopCustomers}
              disabled={topCustomers.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {heavyMode && (
            <p className="mb-2 text-xs text-slate-500">
              Mostrando top 30 (modo liviano por volumen alto de datos). Exportá el CSV para ver
              el listado completo.
            </p>
          )}
          {topCustomersDisplay.length === 0 ? (
            <p className="text-sm text-slate-400">No hay ventas con cliente identificado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Cliente</th>
                    <th className="py-2 text-right"># Compras</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Ticket prom.</th>
                    <th className="py-2 text-right">Última compra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topCustomersDisplay.map((c) => (
                    <tr key={c.customerId}>
                      <td className="py-2">
                        <Link
                          to={`/customers?id=${c.customerId}`}
                          className="text-brand-700 hover:underline"
                        >
                          {c.legalName}
                        </Link>
                      </td>
                      <td className="py-2 text-right">{c.count}</td>
                      <td className="py-2 text-right font-semibold">{formatARS(c.total)}</td>
                      <td className="py-2 text-right text-slate-600">{formatARS(c.avg)}</td>
                      <td className="py-2 text-right text-xs text-slate-500">
                        {format(new Date(c.lastDate), 'dd/MM/yy', { locale: es })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function FreqCard({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: 'emerald' | 'amber' | 'slate';
}) {
  // Clases hardcodeadas para que Tailwind las detecte (no template strings dinámicos).
  const palette: Record<typeof color, { bg: string; border: string; text: string }> = {
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700' },
  };
  const c = palette[color];
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={`rounded-lg border p-4 ${c.bg} ${c.border}`}>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${c.text}`}>{count}</div>
      <div className="text-xs text-slate-500">{pct.toFixed(1)}% de los clientes</div>
    </div>
  );
}
