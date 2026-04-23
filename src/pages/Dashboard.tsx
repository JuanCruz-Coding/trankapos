import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DollarSign, TrendingUp, Package, AlertTriangle, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { dayKey, rangeFromPreset } from '@/lib/dates';
import { format, subDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

export default function Dashboard() {
  const { session, activeDepotId } = useAuth();
  const sales = useLiveQuery(() => data.listSales({}), [session?.tenantId]);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  const stock = useLiveQuery(() => data.listStock(), [session?.tenantId]);

  const todayRange = rangeFromPreset('today');
  const salesToday = useMemo(
    () =>
      (sales ?? []).filter(
        (s) =>
          !s.voided &&
          new Date(s.createdAt) >= todayRange.from &&
          new Date(s.createdAt) <= todayRange.to &&
          (!activeDepotId || s.depotId === activeDepotId),
      ),
    [sales, activeDepotId, todayRange.from, todayRange.to],
  );

  const todayTotal = salesToday.reduce((a, s) => a + s.total, 0);
  const todayCount = salesToday.length;
  const avgTicket = todayCount > 0 ? todayTotal / todayCount : 0;

  const last14 = useMemo(() => {
    const out: { day: string; label: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const key = format(d, 'yyyy-MM-dd');
      out.push({ day: key, label: format(d, 'dd/MM', { locale: es }), total: 0 });
    }
    for (const s of sales ?? []) {
      if (s.voided) continue;
      if (activeDepotId && s.depotId !== activeDepotId) continue;
      const k = dayKey(s.createdAt);
      const bucket = out.find((x) => x.day === k);
      if (bucket) bucket.total += s.total;
    }
    return out;
  }, [sales, activeDepotId]);

  const topProducts = useMemo(() => {
    const agg = new Map<string, { name: string; qty: number; total: number }>();
    const last7 = startOfDay(subDays(new Date(), 6));
    for (const s of sales ?? []) {
      if (s.voided) continue;
      if (activeDepotId && s.depotId !== activeDepotId) continue;
      if (new Date(s.createdAt) < last7) continue;
      for (const it of s.items) {
        const cur = agg.get(it.productId) ?? { name: it.name, qty: 0, total: 0 };
        cur.qty += it.qty;
        cur.total += it.subtotal;
        agg.set(it.productId, cur);
      }
    }
    return Array.from(agg.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [sales, activeDepotId]);

  const lowStock = useMemo(() => {
    if (!stock || !products) return [];
    const byProduct = new Map(products.map((p) => [p.id, p]));
    return stock
      .filter((s) => (!activeDepotId || s.depotId === activeDepotId) && s.qty <= s.minQty)
      .map((s) => ({ stock: s, product: byProduct.get(s.productId) }))
      .filter((x) => x.product)
      .slice(0, 10);
  }, [stock, products, activeDepotId]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Resumen del día" />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={DollarSign} label="Ventas hoy" value={formatARS(todayTotal)} tone="brand" />
        <StatCard icon={Receipt} label="Tickets hoy" value={String(todayCount)} tone="emerald" />
        <StatCard icon={TrendingUp} label="Ticket prom." value={formatARS(avgTicket)} tone="amber" />
        <StatCard
          icon={AlertTriangle}
          label="Stock crítico"
          value={String(lowStock.length)}
          tone="red"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ventas últimos 14 días</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => formatARS(v)}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#196df5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top productos (7d)</CardTitle>
          </CardHeader>
          <CardBody>
            {topProducts.length === 0 ? (
              <p className="text-sm text-slate-400">Sin ventas en el período</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {topProducts.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 py-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.qty} unidades</div>
                    </div>
                    <div className="text-sm font-semibold">{formatARS(p.total)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {lowStock.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Productos con stock bajo</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Producto</th>
                    <th className="px-2 py-2 text-right">Stock</th>
                    <th className="px-2 py-2 text-right">Mín.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lowStock.map(({ stock: s, product }) => (
                    <tr key={s.id}>
                      <td className="px-2 py-2 flex items-center gap-2">
                        <Package className="h-4 w-4 text-slate-400" />
                        {product!.name}
                      </td>
                      <td
                        className={
                          'px-2 py-2 text-right font-semibold ' +
                          (s.qty <= 0 ? 'text-red-600' : 'text-amber-600')
                        }
                      >
                        {s.qty}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-500">{s.minQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  tone: 'brand' | 'emerald' | 'amber' | 'red';
}) {
  const styles = {
    brand: 'bg-brand-50 text-brand-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-slate-500">{label}</span>
        <div className={'rounded-lg p-2 ' + styles}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
