import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { addMoney } from '@/lib/money';
import { dayKey, rangeFromPreset, type RangePreset } from '@/lib/dates';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PAYMENT_METHODS, type PaymentMethod } from '@/types';

type StatusFilter = 'active' | 'voided' | 'all';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'month', label: 'Este mes' },
];

export default function Reports() {
  const { session, activeDepotId } = useAuth();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const sales = useLiveQuery(() => data.listSales({}), [session?.tenantId]);
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId]);
  const depots = useLiveQuery(() => data.listDepots(), [session?.tenantId]);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  const categories = useLiveQuery(() => data.listCategories(), [session?.tenantId]);

  const range = rangeFromPreset(preset);

  // map productId → categoryId para filtrar líneas por categoría
  const productCategory = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p.categoryId])),
    [products],
  );

  const filtered = useMemo(
    () =>
      (sales ?? [])
        .filter((s) => {
          if (status === 'active' && s.voided) return false;
          if (status === 'voided' && !s.voided) return false;
          if (new Date(s.createdAt) < range.from) return false;
          if (new Date(s.createdAt) > range.to) return false;
          if (activeDepotId && s.depotId !== activeDepotId) return false;
          if (categoryId) {
            const hasCategory = s.items.some(
              (it) => productCategory.get(it.productId) === categoryId,
            );
            if (!hasCategory) return false;
          }
          return true;
        }),
    [sales, range.from, range.to, activeDepotId, status, categoryId, productCategory],
  );

  const total = addMoney(...filtered.map((s) => s.total));
  const count = filtered.length;
  const byDay = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of filtered) {
      const k = dayKey(s.createdAt);
      const arr = map.get(k) ?? [];
      arr.push(s.total);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort()
      .map(([day, totals]) => ({
        day,
        label: format(new Date(day), 'dd/MM', { locale: es }),
        total: addMoney(...totals),
      }));
  }, [filtered]);

  const byPayment = useMemo(() => {
    const map = new Map<PaymentMethod, number[]>();
    for (const s of filtered) {
      for (const p of s.payments) {
        const arr = map.get(p.method) ?? [];
        arr.push(p.amount);
        map.set(p.method, arr);
      }
    }
    return PAYMENT_METHODS.map((m) => ({
      label: m.label,
      total: addMoney(...(map.get(m.value) ?? [])),
    }));
  }, [filtered]);

  const byCashier = useMemo(() => {
    const map = new Map<string, { count: number; totals: number[] }>();
    for (const s of filtered) {
      const cur = map.get(s.cashierId) ?? { count: 0, totals: [] };
      cur.count++;
      cur.totals.push(s.total);
      map.set(s.cashierId, cur);
    }
    return Array.from(map.entries()).map(([id, v]) => ({
      id,
      name: users?.find((u) => u.id === id)?.name ?? '—',
      count: v.count,
      total: addMoney(...v.totals),
    }));
  }, [filtered, users]);

  const byProduct = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; totals: number[] }>();
    for (const s of filtered) {
      for (const it of s.items) {
        if (categoryId && productCategory.get(it.productId) !== categoryId) continue;
        const cur = map.get(it.productId) ?? { name: it.name, qty: 0, totals: [] };
        cur.qty += it.qty;
        cur.totals.push(it.subtotal);
        map.set(it.productId, cur);
      }
    }
    return Array.from(map.values())
      .map((v) => ({ name: v.name, qty: v.qty, total: addMoney(...v.totals) }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, categoryId, productCategory]);

  function exportCSV() {
    const rows = [
      ['fecha', 'depósito', 'cajero', 'items', 'subtotal', 'descuento', 'total'],
      ...filtered.map((s) => [
        s.createdAt,
        depots?.find((d) => d.id === s.depotId)?.name ?? '',
        users?.find((u) => u.id === s.cashierId)?.name ?? '',
        String(s.items.reduce((a, i) => a + i.qty, 0)),
        s.subtotal.toFixed(2),
        s.discount.toFixed(2),
        s.total.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas-${preset}-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Análisis de ventas"
        actions={<Button variant="outline" onClick={exportCSV}>Exportar CSV</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={
              'rounded-full border px-3 py-1 text-xs ' +
              (preset === p.value
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
            }
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <option value="active">Solo no anuladas</option>
          <option value="voided">Solo anuladas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Stat label="Total vendido" value={formatARS(total)} />
        <Stat label="Tickets" value={String(count)} />
        <Stat
          label="Ticket promedio"
          value={count > 0 ? formatARS(total / count) : formatARS(0)}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ventas por día</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatARS(v)} />
                  <Bar dataKey="total" fill="#196df5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por medio de pago</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-slate-100">
              {byPayment.map((p) => (
                <li key={p.label} className="flex items-center justify-between py-2">
                  <span className="text-sm">{p.label}</span>
                  <span className="text-sm font-semibold">{formatARS(p.total)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por cajero</CardTitle>
          </CardHeader>
          <CardBody>
            {byCashier.length === 0 ? (
              <p className="text-sm text-slate-400">Sin datos</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {byCashier.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span className="text-sm">{c.name}</span>
                    <div className="text-right text-xs">
                      <div className="font-semibold text-sm text-slate-900">{formatARS(c.total)}</div>
                      <div className="text-slate-500">{c.count} ventas</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top productos</CardTitle>
          </CardHeader>
          <CardBody>
            {byProduct.length === 0 ? (
              <p className="text-sm text-slate-400">Sin datos</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Producto</th>
                      <th className="py-2 text-right">Unidades</th>
                      <th className="py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {byProduct.slice(0, 15).map((p) => (
                      <tr key={p.name}>
                        <td className="py-2">{p.name}</td>
                        <td className="py-2 text-right">{p.qty}</td>
                        <td className="py-2 text-right font-semibold">{formatARS(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
