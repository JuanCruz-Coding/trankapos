import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  BarChart3,
  Package,
  Users,
  DollarSign,
  RotateCcw,
  Lock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { cn } from '@/lib/utils';
import { PAYMENT_METHODS, type PaymentMethod, type Sale, type Subscription, type Tenant } from '@/types';
import { ProductosTab } from '@/components/reports/ProductosTab';
import { ClientesTab } from '@/components/reports/ClientesTab';
import { FinancieroTab } from '@/components/reports/FinancieroTab';
import { DevolucionesTab } from '@/components/reports/DevolucionesTab';

type StatusFilter = 'active' | 'voided' | 'all';
type PresetOrCustom = RangePreset | 'custom';
type ReportTab = 'resumen' | 'productos' | 'clientes' | 'financiero' | 'devoluciones';

const PRESETS: { value: PresetOrCustom; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'custom', label: 'Personalizado' },
];

/**
 * Reports — Sprint RPT. Tabs:
 *   Resumen      → ventas por día, medios de pago, cajero, top productos.
 *   Productos    → top por unidades/monto/margen, sin movimiento, ABC. (Pieza A)
 *   Clientes     → top compradores, ticket promedio, frecuencia. Solo retail. (Pieza A)
 *   Financiero   → margen bruto/neto, comparativa período. (Pieza B)
 *   Devoluciones → por motivo, por producto, ratio. (Pieza B)
 *
 * Los filtros (rango, categoría, status) son globales — viven en el wrapper y se
 * pasan a cada tab como props. Mover entre tabs no resetea los filtros.
 */
export default function Reports() {
  const { session, activeBranchId } = useAuth();
  const [tab, setTab] = useState<ReportTab>('resumen');
  const [preset, setPreset] = useState<PresetOrCustom>('7d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  // Cargar tenant (businessMode → Clientes tab) + subscription (plan → Financiero gate).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [t, sub] = await Promise.all([
          data.getTenant(),
          data.getSubscription().catch(() => null),
        ]);
        if (cancelled) return;
        setTenant(t);
        setSubscription(sub);
      } catch {
        if (!cancelled) {
          setTenant(null);
          setSubscription(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId]);

  // Plan gate para el tab Financiero (Pro / Empresa).
  const planCode = subscription?.plan.code ?? 'free';
  const hasFinancieroAccess = ['pro', 'empresa'].includes(planCode);

  const sales = useLiveQuery(() => data.listSales({}), [session?.tenantId]);
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId]);
  const products = useLiveQuery(() => data.listProducts(), [session?.tenantId]);
  const categories = useLiveQuery(() => data.listCategories(), [session?.tenantId]);
  const customers = useLiveQuery(
    () => data.listCustomers({ activeOnly: false }),
    [session?.tenantId],
  );

  const range = useMemo(() => {
    if (preset === 'custom') {
      const from = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
      const to = customTo ? new Date(customTo + 'T23:59:59.999') : new Date();
      return { from, to };
    }
    return rangeFromPreset(preset);
  }, [preset, customFrom, customTo]);

  // map productId → categoryId para filtrar líneas por categoría
  const productCategory = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p.categoryId])),
    [products],
  );

  const filtered = useMemo(
    () =>
      (sales ?? []).filter((s) => {
        if (status === 'active' && s.voided) return false;
        if (status === 'voided' && !s.voided) return false;
        if (new Date(s.createdAt) < range.from) return false;
        if (new Date(s.createdAt) > range.to) return false;
        if (activeBranchId && s.branchId !== activeBranchId) return false;
        if (categoryId) {
          const hasCategory = s.items.some(
            (it) => productCategory.get(it.productId) === categoryId,
          );
          if (!hasCategory) return false;
        }
        return true;
      }),
    [sales, range.from, range.to, activeBranchId, status, categoryId, productCategory],
  );

  function exportCSV() {
    const rows = [
      ['fecha', 'sucursal', 'cajero', 'items', 'subtotal', 'descuento', 'total'],
      ...filtered.map((s) => [
        s.createdAt,
        branches?.find((b) => b.id === s.branchId)?.name ?? '',
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

  const showClientesTab = tenant?.businessMode === 'retail';

  const tabs: { id: ReportTab; label: string; icon: typeof BarChart3; visible: boolean }[] = [
    { id: 'resumen', label: 'Resumen', icon: BarChart3, visible: true },
    { id: 'productos', label: 'Productos', icon: Package, visible: true },
    { id: 'clientes', label: 'Clientes', icon: Users, visible: showClientesTab },
    { id: 'financiero', label: 'Financiero', icon: DollarSign, visible: true },
    { id: 'devoluciones', label: 'Devoluciones', icon: RotateCcw, visible: true },
  ];

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Análisis de ventas"
        actions={
          <Button variant="outline" onClick={exportCSV}>
            Exportar CSV
          </Button>
        }
      />

      {/* --- Filtros globales --- */}
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
        {preset === 'custom' && (
          <>
            <input
              type="date"
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-slate-500">a</span>
            <input
              type="date"
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}
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

      {/* --- Tabs --- */}
      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200">
        {tabs.filter((t) => t.visible).map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-3 py-2 -mb-px text-sm font-medium transition',
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* --- Contenido por tab --- */}
      {tab === 'resumen' && (
        <ResumenTab
          filtered={filtered}
          users={users}
          categoryId={categoryId}
          productCategory={productCategory}
        />
      )}
      {tab === 'productos' && (
        <ProductosTab
          filtered={filtered}
          products={products ?? []}
          categoryId={categoryId}
          productCategory={productCategory}
        />
      )}
      {tab === 'clientes' && (
        <ClientesTab filtered={filtered} customers={customers ?? []} />
      )}
      {tab === 'financiero' && (
        hasFinancieroAccess ? (
          <FinancieroTab
            filtered={filtered}
            rangeFrom={range.from}
            rangeTo={range.to}
            products={products ?? []}
          />
        ) : (
          <PlanGate
            featureName="Reporte Financiero"
            description="Margen bruto estimado y comparativa de período actual vs anterior te ayudan a medir la rentabilidad real del negocio."
            requiredPlan="Pro"
            currentPlan={planCode}
          />
        )
      )}
      {tab === 'devoluciones' && (
        <DevolucionesTab
          filtered={filtered}
          rangeFrom={range.from}
          rangeTo={range.to}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tab Resumen — los 4 reportes originales pre-Sprint RPT.
// ---------------------------------------------------------------------

function ResumenTab({
  filtered,
  users,
  categoryId,
  productCategory,
}: {
  filtered: Sale[];
  users: { id: string; name: string }[] | undefined;
  categoryId: string;
  productCategory: Map<string, string | null>;
}) {
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

  return (
    <div>
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

/**
 * Bloquea una sección cuando el plan del tenant no incluye la feature.
 * Sigue mostrando el tab en el nav (consistencia) pero ofrece un CTA al upgrade.
 */
function PlanGate({
  featureName,
  description,
  requiredPlan,
  currentPlan,
}: {
  featureName: string;
  description: string;
  requiredPlan: string;
  currentPlan: string;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/30 p-8 text-center">
      <Lock className="mx-auto h-10 w-10 text-brand-500" />
      <h3 className="mt-3 font-display text-lg font-semibold text-navy">
        {featureName}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</p>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
        Disponible en plan <strong>{requiredPlan}</strong>{' '}
        {currentPlan !== 'free' && <span className="opacity-60">· tenés "{currentPlan}"</span>}
      </div>
      <div className="mt-4">
        <Link
          to="/plan"
          className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Ver planes
        </Link>
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
