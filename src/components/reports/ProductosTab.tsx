import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Info, PackageX, Star, TrendingUp } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatARS } from '@/lib/currency';
import { addMoney, subMoney } from '@/lib/money';
import { format } from 'date-fns';
import type { Product, Sale } from '@/types';

interface Props {
  filtered: Sale[];
  products: Product[];
  categoryId: string;
  productCategory: Map<string, string | null>;
}

type ProductAgg = {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
};

/**
 * Helper local de exportación CSV (copiado del patrón de Reports.tsx).
 * Se incluye BOM (﻿) para que Excel detecte UTF-8 correctamente.
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
 * Productos Tab — Pieza A del Sprint RPT.
 *
 * Decisión: cuando hay filtro de categoría aplicado, solo considero las líneas
 * de venta cuyos productos pertenecen a esa categoría (consistente con ResumenTab.byProduct).
 * Para "sin movimiento" también respeto el filtro de categoría.
 *
 * Caveat de margen: products.cost es el costo ACTUAL, no snapshot histórico,
 * así que el margen mostrado es aproximado. Lo aclaro en el card con un warning.
 */
export function ProductosTab({ filtered, products, categoryId, productCategory }: Props) {
  // Map productId → product (catálogo) para acceder a cost/sku/price/createdAt.
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Agregación principal: una entrada por producto vendido. Respeta filtro de categoría.
  const productAggs = useMemo<ProductAgg[]>(() => {
    const map = new Map<
      string,
      { name: string; qty: number; revenues: number[]; costs: number[] }
    >();
    for (const s of filtered) {
      for (const it of s.items) {
        if (categoryId && productCategory.get(it.productId) !== categoryId) continue;
        const cur = map.get(it.productId) ?? {
          name: it.name,
          qty: 0,
          revenues: [],
          costs: [],
        };
        cur.qty += it.qty;
        cur.revenues.push(it.subtotal);
        const prod = productById.get(it.productId);
        const unitCost = prod?.cost ?? 0;
        // Costo aproximado: cost_actual * qty (variantes no consideradas aquí, falta costOverride snapshot).
        cur.costs.push(unitCost * it.qty);
        map.set(it.productId, cur);
      }
    }
    return Array.from(map.entries()).map(([productId, v]) => {
      const revenue = addMoney(...v.revenues);
      const cost = addMoney(...v.costs);
      const margin = subMoney(revenue, cost);
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
      return {
        productId,
        name: v.name,
        qty: v.qty,
        revenue,
        cost,
        margin,
        marginPct,
      };
    });
  }, [filtered, categoryId, productCategory, productById]);

  const totalRevenue = useMemo(
    () => addMoney(...productAggs.map((a) => a.revenue)),
    [productAggs],
  );

  // Top por monto.
  const topByRevenue = useMemo(
    () => [...productAggs].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    [productAggs],
  );

  // Top por unidades.
  const topByQty = useMemo(
    () => [...productAggs].sort((a, b) => b.qty - a.qty).slice(0, 30),
    [productAggs],
  );

  // Top por margen $.
  const topByMargin = useMemo(
    () => [...productAggs].sort((a, b) => b.margin - a.margin).slice(0, 30),
    [productAggs],
  );

  // Productos sin movimiento: están en el catálogo activo y NO aparecen en ninguna venta.
  // Respeto filtro de categoría: si hay filtro, solo muestro productos de esa categoría.
  const productsWithSales = useMemo(
    () => new Set(productAggs.map((a) => a.productId)),
    [productAggs],
  );
  const sinMovimiento = useMemo(() => {
    const now = Date.now();
    return products
      .filter((p) => p.active)
      .filter((p) => (categoryId ? p.categoryId === categoryId : true))
      .filter((p) => !productsWithSales.has(p.id))
      .map((p) => {
        const days = Math.floor((now - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: p.id,
          name: p.name,
          sku: p.sku ?? '—',
          price: p.price,
          days,
        };
      })
      .sort((a, b) => b.days - a.days);
  }, [products, productsWithSales, categoryId]);

  // Análisis ABC: clasifica productos por contribución acumulada al revenue total.
  // A: 0-80%, B: 80-95%, C: 95-100%. La lógica usa el revenue del filtered (no histórico).
  const abc = useMemo(() => {
    if (totalRevenue <= 0 || productAggs.length === 0) {
      return { a: 0, b: 0, c: 0, aRevenue: 0, bRevenue: 0, cRevenue: 0 };
    }
    const sorted = [...productAggs].sort((a, b) => b.revenue - a.revenue);
    let accum = 0;
    let a = 0,
      b = 0,
      c = 0;
    let aRevenue = 0,
      bRevenue = 0,
      cRevenue = 0;
    for (const p of sorted) {
      const pct = (accum / totalRevenue) * 100;
      if (pct < 80) {
        a++;
        aRevenue = addMoney(aRevenue, p.revenue);
      } else if (pct < 95) {
        b++;
        bRevenue = addMoney(bRevenue, p.revenue);
      } else {
        c++;
        cRevenue = addMoney(cRevenue, p.revenue);
      }
      accum = addMoney(accum, p.revenue);
    }
    return { a, b, c, aRevenue, bRevenue, cRevenue };
  }, [productAggs, totalRevenue]);

  // Exports
  function exportTopByRevenue() {
    const rows: (string | number)[][] = [
      ['producto', 'unidades', 'monto_total', 'pct_total'],
      ...topByRevenue.map((p) => [
        p.name,
        p.qty,
        p.revenue.toFixed(2),
        totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(2) : '0.00',
      ]),
    ];
    downloadCSV(rows, `top-productos-monto-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  function exportTopByQty() {
    const rows: (string | number)[][] = [
      ['producto', 'unidades', 'monto_total', 'pct_total'],
      ...topByQty.map((p) => [
        p.name,
        p.qty,
        p.revenue.toFixed(2),
        totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(2) : '0.00',
      ]),
    ];
    downloadCSV(rows, `top-productos-unidades-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  function exportTopByMargin() {
    const rows: (string | number)[][] = [
      ['producto', 'unidades', 'ingreso', 'margen', 'margen_pct'],
      ...topByMargin.map((p) => [
        p.name,
        p.qty,
        p.revenue.toFixed(2),
        p.margin.toFixed(2),
        p.marginPct.toFixed(2),
      ]),
    ];
    downloadCSV(rows, `top-productos-margen-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  function exportSinMovimiento() {
    const rows: (string | number)[][] = [
      ['producto', 'sku', 'precio', 'dias_desde_alta'],
      ...sinMovimiento.map((p) => [p.name, p.sku, p.price.toFixed(2), p.days]),
    ];
    downloadCSV(rows, `productos-sin-movimiento-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`);
  }

  return (
    <div className="space-y-6">
      {/* 1.5 ABC */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Análisis ABC</CardTitle>
            <AbcTooltip />
          </div>
        </CardHeader>
        <CardBody>
          {productAggs.length === 0 ? (
            <p className="text-sm text-slate-400">Sin datos</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <AbcCard
                letter="A"
                count={abc.a}
                revenue={abc.aRevenue}
                pct={totalRevenue > 0 ? (abc.aRevenue / totalRevenue) * 100 : 0}
                color="emerald"
                hint="Estrellas — priorizar stock"
              />
              <AbcCard
                letter="B"
                count={abc.b}
                revenue={abc.bRevenue}
                pct={totalRevenue > 0 ? (abc.bRevenue / totalRevenue) * 100 : 0}
                color="amber"
                hint="Soporte — mantener bajo control"
              />
              <AbcCard
                letter="C"
                count={abc.c}
                revenue={abc.cRevenue}
                pct={totalRevenue > 0 ? (abc.cRevenue / totalRevenue) * 100 : 0}
                color="slate"
                hint="Cola larga — revisar si conviene mantener"
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* 1.1 Top por monto */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Top productos por monto
              </div>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportTopByRevenue}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <ProductTable
            rows={topByRevenue.map((p) => ({
              name: p.name,
              qty: p.qty,
              revenue: p.revenue,
              pct: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0,
            }))}
            mode="revenue"
          />
        </CardBody>
      </Card>

      {/* 1.2 Top por unidades */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-brand-600" />
                Top productos por unidades
              </div>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportTopByQty}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <ProductTable
            rows={topByQty.map((p) => ({
              name: p.name,
              qty: p.qty,
              revenue: p.revenue,
              pct: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0,
            }))}
            mode="qty"
          />
        </CardBody>
      </Card>

      {/* 1.3 Top por margen */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Top productos por margen estimado</CardTitle>
            <Button variant="outline" size="sm" onClick={exportTopByMargin}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              Margen calculado con <strong>costos actuales</strong> del producto, no costos
              históricos al momento de la venta. Si modificás costos con frecuencia, este
              valor es aproximado.
            </p>
          </div>
          {topByMargin.length === 0 ? (
            <p className="text-sm text-slate-400">Sin datos</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Producto</th>
                    <th className="py-2 text-right">Unidades</th>
                    <th className="py-2 text-right">Ingreso</th>
                    <th className="py-2 text-right">Margen $</th>
                    <th className="py-2 text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topByMargin.map((p) => (
                    <tr key={p.productId}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 text-right">{p.qty}</td>
                      <td className="py-2 text-right">{formatARS(p.revenue)}</td>
                      <td
                        className={
                          'py-2 text-right font-semibold ' +
                          (p.margin >= 0 ? 'text-emerald-700' : 'text-red-700')
                        }
                      >
                        {formatARS(p.margin)}
                      </td>
                      <td className="py-2 text-right text-slate-600">
                        {p.marginPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* 1.4 Sin movimiento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              <div className="flex items-center gap-2">
                <PackageX className="h-4 w-4 text-slate-500" />
                Productos sin movimiento
              </div>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={exportSinMovimiento}
              disabled={sinMovimiento.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-xs text-slate-500">
            {sinMovimiento.length} producto(s) activo(s) sin ventas en el rango seleccionado.
            Útil para detectar stock muerto.
          </p>
          {sinMovimiento.length === 0 ? (
            <p className="text-sm text-slate-400">Todos los productos tuvieron ventas. </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Producto</th>
                    <th className="py-2">SKU</th>
                    <th className="py-2 text-right">Precio</th>
                    <th className="py-2 text-right">Días desde alta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sinMovimiento.slice(0, 200).map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 text-slate-500">{p.sku}</td>
                      <td className="py-2 text-right">{formatARS(p.price)}</td>
                      <td className="py-2 text-right text-slate-600">{p.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sinMovimiento.length > 200 && (
                <p className="mt-2 text-xs text-slate-500">
                  Mostrando primeros 200. Exportá el CSV para ver todos.
                </p>
              )}
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

function ProductTable({
  rows,
  mode,
}: {
  rows: { name: string; qty: number; revenue: number; pct: number }[];
  mode: 'revenue' | 'qty';
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">Sin datos</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2">Producto</th>
            <th className="py-2 text-right">
              {mode === 'qty' ? 'Unidades' : 'Unidades'}
            </th>
            <th className="py-2 text-right">Monto total</th>
            <th className="py-2 text-right">% del total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td className="py-2">{p.name}</td>
              <td className="py-2 text-right">{p.qty}</td>
              <td className="py-2 text-right font-semibold">{formatARS(p.revenue)}</td>
              <td className="py-2 text-right text-slate-600">{p.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AbcCard({
  letter,
  count,
  revenue,
  pct,
  color,
  hint,
}: {
  letter: 'A' | 'B' | 'C';
  count: number;
  revenue: number;
  pct: number;
  color: 'emerald' | 'amber' | 'slate';
  hint: string;
}) {
  // Clases hardcodeadas para que Tailwind las detecte correctamente (no template strings).
  const palette: Record<typeof color, { bg: string; border: string; text: string }> = {
    emerald: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      text: 'text-emerald-700',
    },
    amber: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      text: 'text-amber-700',
    },
    slate: {
      bg: 'bg-slate-50',
      border: 'border-slate-200',
      text: 'text-slate-700',
    },
  };
  const c = palette[color];
  return (
    <div className={`rounded-lg border p-4 ${c.bg} ${c.border}`}>
      <div className="flex items-baseline justify-between">
        <div className={`text-2xl font-bold ${c.text}`}>{letter}</div>
        <div className="text-xs text-slate-500">{pct.toFixed(0)}% del total</div>
      </div>
      <div className="mt-2 text-sm text-slate-700">
        <strong>{count}</strong> producto(s)
      </div>
      <div className="text-xs text-slate-600">{formatARS(revenue)}</div>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function AbcTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <Info className="h-4 w-4" />
        ¿Qué es?
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-10 w-72 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
          Clasificación según concentración de ventas (regla 80/20):
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>
              <strong>A</strong>: top productos que acumulan el 80% de las ventas. Tus estrellas
              — priorizar stock.
            </li>
            <li>
              <strong>B</strong>: siguientes hasta el 95%. Soporte.
            </li>
            <li>
              <strong>C</strong>: el 5% restante. Cola larga — revisar si conviene mantenerlos.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
