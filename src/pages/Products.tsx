import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Package, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { usePermission } from '@/lib/permissions';
import { toast } from '@/stores/toast';
import { CSV_TEMPLATE, parseCsv, type ParseError, type ParsedRow } from '@/lib/csvImport';
import { productSchema, safeParse } from '@/lib/schemas';
import { confirmDialog } from '@/lib/dialog';
import { AttributeKeysInput } from '@/components/products/AttributeKeysInput';
import { VariantEditor } from '@/components/products/VariantEditor';
import { UNITS_OF_MEASURE, type Brand, type Category, type Product, type ProductVariant, type UnitOfMeasure } from '@/types';

interface FormState {
  id?: string;
  name: string;
  barcode: string;
  sku: string;
  price: string;
  cost: string;
  categoryId: string;
  taxRate: string;
  trackStock: boolean;
  allowSaleWhenZero: boolean;
  active: boolean;
  initialStock: Record<string, { qty: string; minQty: string }>;
  // --- Sprint PROD-RETAIL ---
  brandId: string;
  description: string;
  unitOfMeasure: UnitOfMeasure;
  /** Tags como string CSV en el form, se convierte a array al guardar. */
  tagsText: string;
  imageUrl: string;
  season: string;
  // --- Sprint VAR ---
  hasVariants: boolean;
  attributeKeys: string[];
  variants: ProductVariant[];
  /** Snapshot de los ids reales (no temp-*) que tenía el producto al abrir el form.
   *  Usado para diffear qué borrar al guardar. */
  originalVariantIds: string[];
}

const emptyForm: FormState = {
  name: '',
  barcode: '',
  sku: '',
  price: '',
  cost: '',
  categoryId: '',
  taxRate: '21',
  trackStock: true,
  allowSaleWhenZero: false,
  active: true,
  initialStock: {},
  brandId: '',
  description: '',
  unitOfMeasure: 'unit',
  tagsText: '',
  imageUrl: '',
  season: '',
  hasVariants: false,
  attributeKeys: [],
  variants: [],
  originalVariantIds: [],
};

/**
 * Sprint PROD-RETAIL: render del select de categorías mostrando jerarquía
 * (rubro padre + sub-rubros indentados con "└─"). Hace orden estable
 * (padre → sus hijos), independiente del sort_order.
 */
function renderCategoryOptions(categories: Category[]) {
  const roots = categories.filter((c) => !c.parentId);
  return roots.flatMap((root) => {
    const children = categories.filter((c) => c.parentId === root.id);
    return [
      <option key={root.id} value={root.id}>
        {root.name}
      </option>,
      ...children.map((c) => (
        <option key={c.id} value={c.id}>
          {'   └─ '}{c.name}
        </option>
      )),
    ];
  });
}

type ImportPhase = 'idle' | 'preview' | 'running' | 'done';

interface ImportStats {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
  total: number;
}

export default function Products() {
  const { session, activeBranchId } = useAuth();
  const canViewCosts = usePermission('view_costs');
  const canManageProducts = usePermission('manage_products');
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);
  const products = useLiveQuery(async () => {
    if (!session) return [];
    return data.listProducts();
  }, [session?.tenantId, refreshKey]);
  const categories = useLiveQuery(() => data.listCategories(), [session?.tenantId, refreshKey]);
  const brands = useLiveQuery(() => data.listBrands({ activeOnly: true }), [session?.tenantId, refreshKey]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId]);
  const warehouses = useLiveQuery(() => data.listWarehouses(), [session?.tenantId]);
  const stock = useLiveQuery(() => data.listStock(), [session?.tenantId, refreshKey]);
  // Variantes globales — usadas para mostrar el badge "N variantes" en la tabla.
  // Es 1 sola llamada y agrupamos por productId en memoria.
  const allVariants = useLiveQuery(
    () => data.listVariants(),
    [session?.tenantId, refreshKey],
  );

  // Para el modal de import CSV: el stock inicial va al warehouse default de la branch activa.
  const activeDefaultWarehouse = useMemo(() => {
    if (!activeBranchId) return null;
    return (warehouses ?? []).find(
      (w) => w.branchId === activeBranchId && w.isDefault && w.active,
    ) ?? null;
  }, [warehouses, activeBranchId]);

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [importModal, setImportModal] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  const [importRows, setImportRows] = useState<ParsedRow[]>([]);
  const [importErrors, setImportErrors] = useState<ParseError[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!products) return [];
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q),
    );
  }, [products, search]);

  function openNew() {
    setForm({
      ...emptyForm,
      initialStock: Object.fromEntries(
        (warehouses ?? []).map((w) => [w.id, { qty: '0', minQty: '5' }]),
      ),
    });
    setModal(true);
  }

  async function openEdit(p: Product) {
    // Cargo variantes del producto. Si hay >1 o si la default tiene atributos cargados,
    // arrancamos con hasVariants=true. La default siempre va con isDefault=true y
    // attributes={} para productos simples.
    let pvariants: ProductVariant[] = [];
    try {
      pvariants = await data.listVariants(p.id);
    } catch {
      // Si el driver tira (stub no implementado o error), arrancamos sin variantes y
      // dejamos el producto como simple. El form igual se puede abrir.
      pvariants = [];
    }
    const nonDefaultCount = pvariants.filter((v) => !v.isDefault).length;
    const defaultHasAttrs = pvariants.some(
      (v) => v.isDefault && Object.keys(v.attributes ?? {}).length > 0,
    );
    const hasVariants = nonDefaultCount > 0 || defaultHasAttrs;

    // Las claves se infieren de las variantes existentes (unión de keys de cada
    // attributes). Para productos simples queda [].
    const keysSet = new Set<string>();
    pvariants.forEach((v) => {
      Object.keys(v.attributes ?? {}).forEach((k) => keysSet.add(k));
    });

    setForm({
      id: p.id,
      name: p.name,
      barcode: p.barcode ?? '',
      sku: p.sku ?? '',
      price: String(p.price),
      cost: String(p.cost),
      categoryId: p.categoryId ?? '',
      taxRate: String(p.taxRate),
      trackStock: p.trackStock,
      allowSaleWhenZero: p.allowSaleWhenZero,
      active: p.active,
      initialStock: {},
      brandId: p.brandId ?? '',
      description: p.description ?? '',
      unitOfMeasure: p.unitOfMeasure,
      tagsText: (p.tags ?? []).join(', '),
      imageUrl: p.imageUrl ?? '',
      season: p.season ?? '',
      hasVariants,
      attributeKeys: Array.from(keysSet),
      variants: pvariants,
      originalVariantIds: pvariants.map((v) => v.id),
    });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(productSchema, {
      name: form.name,
      barcode: form.barcode,
      sku: form.sku,
      price: Number(form.price),
      cost: Number(form.cost),
      categoryId: form.categoryId || null,
      taxRate: Number(form.taxRate),
      trackStock: form.trackStock,
      allowSaleWhenZero: form.allowSaleWhenZero,
      active: form.active,
    });
    if (!parsed.ok) return toast.error(parsed.error);

    // Sprint PROD-RETAIL: campos extra que el schema no valida pero que mandamos al driver.
    const retailExtras = {
      brandId: form.brandId || null,
      description: form.description.trim() || null,
      unitOfMeasure: form.unitOfMeasure,
      tags: form.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      imageUrl: form.imageUrl.trim() || null,
      season: form.season.trim() || null,
    };

    // Validación de variantes (solo si hasVariants).
    if (form.hasVariants) {
      if (form.variants.length === 0) {
        return toast.error('Tenés que agregar al menos una variante o desactivar "este producto tiene variantes"');
      }
      if (form.attributeKeys.length > 0) {
        const missing = form.variants.find((v) =>
          form.attributeKeys.some((k) => !(v.attributes?.[k] ?? '').trim()),
        );
        if (missing) {
          return toast.error('Hay variantes con atributos sin valor. Completalas antes de guardar.');
        }
      }
    }

    try {
      let productId = form.id;
      if (form.id) {
        await data.updateProduct(form.id, { ...parsed.data, ...retailExtras });
      } else {
        const initialStock = Object.entries(form.initialStock)
          .map(([warehouseId, v]) => ({
            warehouseId,
            qty: Number(v.qty) || 0,
            minQty: Number(v.minQty) || 0,
          }))
          .filter((x) => x.qty > 0 || x.minQty > 0);
        const created = await data.createProduct({ ...parsed.data, ...retailExtras, initialStock });
        productId = created.id;
      }

      // --- Diff de variantes ---
      // Solo si hasVariants. Si está apagado, el backend mantiene la default tal cual
      // y no tocamos nada. Si pasó de hasVariants=true a false en una edición, ese
      // toggle no borra las variantes extra (decisión conservadora — si lo desea, el
      // comercio puede eliminarlas a mano antes de apagar el toggle).
      if (form.hasVariants && productId) {
        const currentIds = new Set(form.variants.map((v) => v.id));
        // 1. Borrar las que estaban antes y ya no están (nunca la default).
        for (const oldId of form.originalVariantIds) {
          if (!currentIds.has(oldId) && !oldId.startsWith('temp-')) {
            try {
              await data.deleteVariant(oldId);
            } catch (err) {
              toast.error(`No se pudo eliminar una variante: ${(err as Error).message}`);
            }
          }
        }
        // 2. Crear las temp-* y actualizar las reales que cambiaron.
        //    Nota: por simplicidad updateamos todas las reales (sin comparar campo por campo).
        for (const v of form.variants) {
          const input = {
            productId,
            sku: v.sku,
            barcode: v.barcode,
            attributes: v.attributes,
            priceOverride: v.priceOverride,
            costOverride: v.costOverride,
            active: v.active,
          };
          if (v.id.startsWith('temp-')) {
            try {
              await data.createVariant(input);
            } catch (err) {
              toast.error(`No se pudo crear una variante: ${(err as Error).message}`);
            }
          } else {
            try {
              await data.updateVariant(v.id, input);
            } catch (err) {
              toast.error(`No se pudo actualizar una variante: ${(err as Error).message}`);
            }
          }
        }
      }

      toast.success(form.id ? 'Producto actualizado' : 'Producto creado');
      setModal(false);
      bumpRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(p: Product) {
    const ok = await confirmDialog(`¿Eliminar "${p.name}"?`, {
      text:
        'Si el producto tiene ventas o transferencias no se puede borrar; en ese caso, desactivalo (editá y desmarcá "Producto activo") para sacarlo del POS sin perder el histórico.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deleteProduct(p.id);
      toast.success('Producto eliminado');
      bumpRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function openImport() {
    setImportPhase('idle');
    setImportRows([]);
    setImportErrors([]);
    setImportProgress(0);
    setImportStats(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImportModal(true);
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-productos.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { rows, errors } = parseCsv(text);
      setImportRows(rows);
      setImportErrors(errors);
      setImportPhase('preview');
    } catch (err) {
      toast.error(`No se pudo leer el archivo: ${(err as Error).message}`);
    }
  }

  async function runImport() {
    setImportPhase('running');
    setImportProgress(0);
    const cats = await data.listCategories();
    const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
    let created = 0;
    let updated = 0;
    const errors: { line: number; message: string }[] = [];

    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      try {
        let categoryId: string | null = null;
        if (row.category) {
          const key = row.category.toLowerCase();
          let cat = catByName.get(key);
          if (!cat) {
            cat = await data.createCategory({ name: row.category });
            catByName.set(key, cat);
          }
          categoryId = cat.id;
        }

        const existing = row.barcode ? await data.findProductByCode(row.barcode) : null;
        if (existing) {
          await data.updateProduct(existing.id, {
            name: row.name,
            price: row.price,
            cost: row.cost,
            categoryId,
            taxRate: row.taxRate,
          });
          updated++;
        } else {
          const initialStock =
            activeDefaultWarehouse && row.stock > 0
              ? [{ warehouseId: activeDefaultWarehouse.id, qty: row.stock, minQty: 0 }]
              : [];
          await data.createProduct({
            name: row.name,
            barcode: row.barcode,
            sku: null,
            price: row.price,
            cost: row.cost,
            categoryId,
            taxRate: row.taxRate,
            trackStock: true,
            allowSaleWhenZero: false,
            active: true,
            initialStock,
          });
          created++;
        }
      } catch (err) {
        errors.push({ line: row.line, message: (err as Error).message });
      }
      setImportProgress(i + 1);
    }

    setImportStats({ created, updated, errors, total: importRows.length });
    setImportPhase('done');
    bumpRefresh();
  }

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    (stock ?? []).forEach((s) => map.set(s.productId, (map.get(s.productId) ?? 0) + s.qty));
    return map;
  }, [stock]);

  // Variantes agrupadas por productId. Si tiene >1, o tiene 1 pero con attributes ≠ {},
  // consideramos que el producto "tiene variantes" (para mostrar badge / cargar al editar).
  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    (allVariants ?? []).forEach((v) => {
      const list = map.get(v.productId) ?? [];
      list.push(v);
      map.set(v.productId, list);
    });
    return map;
  }, [allVariants]);

  const [catModal, setCatModal] = useState(false);
  const [newCat, setNewCat] = useState('');

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle="Catálogo general del kiosko"
        actions={
          <>
            <Button variant="outline" onClick={() => setCatModal(true)}>
              Categorías
            </Button>
            <Button variant="outline" onClick={openImport}>
              <Upload className="h-4 w-4" /> Importar CSV
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Nuevo producto
            </Button>
          </>
        }
      />

      <div className="mb-4 flex max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Sin productos"
          description="Agregá tu primer producto para empezar a vender."
          action={<Button onClick={openNew}>Agregar producto</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Código</th>
                <th className="hidden px-4 py-3 md:table-cell">Categoría</th>
                <th className="px-4 py-3 text-right">Precio</th>
                {canViewCosts && (
                  <th className="hidden px-4 py-3 text-right md:table-cell">Costo</th>
                )}
                {canViewCosts && (
                  <th className="hidden px-4 py-3 text-right lg:table-cell">Margen</th>
                )}
                <th className="hidden px-4 py-3 text-right lg:table-cell">IVA</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const qty = stockByProduct.get(p.id) ?? 0;
                const category = (categories ?? []).find((c) => c.id === p.categoryId);
                const marginAbs = p.price - p.cost;
                const marginPct = p.cost > 0 ? (marginAbs / p.cost) * 100 : null;
                const marginColor =
                  marginAbs < 0 ? 'text-red-600' : marginAbs === 0 ? 'text-slate-500' : 'text-emerald-700';
                const pvariants = variantsByProduct.get(p.id) ?? [];
                // Solo cuenta como "con variantes" si hay >1 o si la default tiene attrs.
                const nonDefaultCount = pvariants.filter((v) => !v.isDefault).length;
                const defaultHasAttrs = pvariants.some(
                  (v) => v.isDefault && Object.keys(v.attributes ?? {}).length > 0,
                );
                const variantCount = nonDefaultCount > 0 || defaultHasAttrs ? pvariants.length : 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="rounded-md bg-slate-100 p-2 text-slate-500">
                          <Package className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{p.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                            {!p.active && (
                              <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-600">
                                Inactivo
                              </span>
                            )}
                            {!p.trackStock && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                Sin stock
                              </span>
                            )}
                            {p.allowSaleWhenZero && p.trackStock && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                                Vende en 0
                              </span>
                            )}
                            {variantCount > 0 && (
                              <span
                                className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700"
                                title="Producto con variantes"
                              >
                                {variantCount} variante{variantCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                        {p.barcode && <span title="Código de barras">{p.barcode}</span>}
                        {p.sku && (
                          <span className="text-cyan-700" title="SKU interno">
                            {p.sku}
                          </span>
                        )}
                        {!p.barcode && !p.sku && <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                      {category ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                          {category.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatARS(p.price)}</td>
                    {canViewCosts && (
                      <td className="hidden px-4 py-3 text-right tabular-nums text-slate-500 md:table-cell">
                        {formatARS(p.cost)}
                      </td>
                    )}
                    {canViewCosts && (
                      <td className={cn('hidden px-4 py-3 text-right tabular-nums lg:table-cell', marginColor)}>
                        {p.cost > 0 ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="font-medium">{formatARS(marginAbs)}</span>
                            <span className="text-[10px] opacity-80">
                              {marginPct !== null ? `${marginPct.toFixed(0)}%` : '—'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="hidden px-4 py-3 text-right tabular-nums text-slate-500 lg:table-cell">
                      {p.taxRate}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={qty <= 0 ? 'text-red-600' : ''}>{qty}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManageProducts && (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openEdit(p)}
                            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? 'Editar producto' : 'Nuevo producto'}
        widthClass={form.hasVariants ? 'max-w-4xl' : 'max-w-lg'}
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Nombre</label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Código de barras (EAN)</label>
              <Input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="7790895..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">SKU / código interno</label>
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder={!form.id && !form.barcode ? 'auto-generado al guardar' : 'opcional'}
              />
              {!form.id && !form.barcode && !form.sku && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Sin EAN: el sistema asigna un SKU automático según la configuración.
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Precio venta</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Costo</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Categoría</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Sin categoría</option>
                {renderCategoryOptions(categories ?? [])}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Marca</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.brandId}
                onChange={(e) => setForm({ ...form, brandId: e.target.value })}
              >
                <option value="">Sin marca</option>
                {(brands ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">IVA %</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Unidad de medida</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.unitOfMeasure}
                onChange={(e) =>
                  setForm({ ...form, unitOfMeasure: e.target.value as UnitOfMeasure })
                }
              >
                {UNITS_OF_MEASURE.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <details className="rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
              Datos adicionales (descripción, tags, imagen, temporada)
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Descripción</label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detalle del producto (opcional, sirve para tickets largos y catálogo)"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Tags (separados por coma)
                  </label>
                  <Input
                    value={form.tagsText}
                    onChange={(e) => setForm({ ...form, tagsText: e.target.value })}
                    placeholder="oferta, premium, nuevo"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Temporada</label>
                  <Input
                    value={form.season}
                    onChange={(e) => setForm({ ...form, season: e.target.value })}
                    placeholder="Verano 2026"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">URL de imagen</label>
                <Input
                  type="url"
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            </div>
          </details>

          {!form.id && warehouses && warehouses.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-medium text-slate-700">Stock inicial por depósito</div>
              <div className="space-y-2">
                {warehouses.map((w) => {
                  const v = form.initialStock[w.id] ?? { qty: '0', minQty: '5' };
                  const branch = w.branchId ? (branches ?? []).find((b) => b.id === w.branchId) : null;
                  const label = branch ? `${branch.name} · ${w.name}` : `Central · ${w.name}`;
                  return (
                    <div key={w.id} className="flex items-center gap-2">
                      <div className="flex-1 text-sm">{label}</div>
                      <Input
                        type="number"
                        min="0"
                        placeholder="qty"
                        className="h-9 w-20 text-sm"
                        value={v.qty}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            initialStock: {
                              ...form.initialStock,
                              [w.id]: { ...v, qty: e.target.value },
                            },
                          })
                        }
                      />
                      <Input
                        type="number"
                        min="0"
                        placeholder="mín"
                        className="h-9 w-20 text-sm"
                        value={v.minQty}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            initialStock: {
                              ...form.initialStock,
                              [w.id]: { ...v, minQty: e.target.value },
                            },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.trackStock}
                onChange={(e) => setForm({ ...form, trackStock: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Controla stock
                <span className="block text-xs text-slate-500">
                  Si está apagado, este producto no descuenta stock al venderse (ej. servicios).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowSaleWhenZero}
                onChange={(e) => setForm({ ...form, allowSaleWhenZero: e.target.checked })}
                className="mt-0.5 h-4 w-4"
                disabled={!form.trackStock}
              />
              <span>
                Permite venta en cero / negativo
                <span className="block text-xs text-slate-500">
                  Override por producto del setting global "Permitir vender en negativo".
                </span>
              </span>
            </label>
          </div>
          {/* --- Sprint VAR: variantes --- */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hasVariants}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((prev) => {
                    if (checked) {
                      // Si no hay variantes cargadas (producto nuevo), arrancamos con
                      // 1 variante "default" temporal vacía para que el comercio la
                      // edite o use "Generar combinaciones".
                      const next = { ...prev, hasVariants: true };
                      if (prev.variants.length === 0) {
                        next.variants = [
                          {
                            id: `temp-${
                              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                                ? crypto.randomUUID()
                                : Math.random().toString(36).slice(2)
                            }`,
                            tenantId: '',
                            productId: prev.id ?? '',
                            sku: null,
                            barcode: null,
                            attributes: {},
                            priceOverride: null,
                            costOverride: null,
                            active: true,
                            isDefault: true,
                            createdAt: new Date().toISOString(),
                          },
                        ];
                      }
                      return next;
                    }
                    return { ...prev, hasVariants: false };
                  });
                }}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Este producto tiene variantes
                <span className="block text-xs text-slate-500">
                  Por ejemplo: una remera con varios talles y colores. Cada variante puede tener su propio SKU y código de barras.
                </span>
              </span>
            </label>

            {form.hasVariants && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Atributos
                  </label>
                  <AttributeKeysInput
                    value={form.attributeKeys}
                    onChange={(keys) => {
                      // Al cambiar las claves, sincronizamos los attributes de cada variante:
                      // agregamos las nuevas con valor "" y mantenemos las viejas que sigan en uso.
                      setForm((prev) => ({
                        ...prev,
                        attributeKeys: keys,
                        variants: prev.variants.map((v) => {
                          const next: Record<string, string> = {};
                          for (const k of keys) {
                            next[k] = v.attributes?.[k] ?? '';
                          }
                          return { ...v, attributes: next };
                        }),
                      }));
                    }}
                  />
                </div>

                <VariantEditor
                  productId={form.id ?? null}
                  basePrice={Number(form.price) || 0}
                  baseCost={Number(form.cost) || 0}
                  variants={form.variants}
                  onChange={(variants) => setForm((prev) => ({ ...prev, variants }))}
                  attributeKeys={form.attributeKeys}
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4"
            />
            Producto activo
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">{form.id ? 'Guardar' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={catModal} onClose={() => setCatModal(false)} title="Categorías">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newCat.trim()) return;
            await data.createCategory({ name: newCat.trim() });
            setNewCat('');
            toast.success('Categoría creada');
            bumpRefresh();
          }}
          className="mb-3 flex gap-2"
        >
          <Input
            placeholder="Nueva categoría"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <Button type="submit">Agregar</Button>
        </form>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {(categories ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{c.name}</span>
              <button
                className="text-slate-400 hover:text-red-600"
                onClick={async () => {
                  const ok = await confirmDialog(`¿Eliminar categoría "${c.name}"?`, {
                    confirmText: 'Eliminar',
                    danger: true,
                  });
                  if (!ok) return;
                  await data.deleteCategory(c.id);
                  toast.success('Categoría eliminada');
                  bumpRefresh();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {(categories ?? []).length === 0 && (
            <div className="p-3 text-center text-xs text-slate-400">Sin categorías</div>
          )}
        </div>
      </Modal>

      <Modal
        open={importModal}
        onClose={() => setImportModal(false)}
        title="Importar productos desde CSV"
        widthClass="max-w-2xl"
      >
        {importPhase === 'idle' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="mb-1 font-medium text-slate-700">Formato esperado</div>
              <div>
                Columnas: <code>nombre</code>, <code>codigo_barras</code>, <code>precio</code>,{' '}
                <code>costo</code>, <code>categoria</code>, <code>iva</code>, <code>stock</code>.
              </div>
              <div className="mt-1">
                Separador: <code>;</code> o <code>,</code>. Números: admite <code>1.234,50</code> o{' '}
                <code>1234.50</code>.
              </div>
              <div className="mt-1">
                Si el <code>codigo_barras</code> ya existe, se actualiza el producto (sin tocar
                stock). Si no, se crea. El stock inicial se carga en el depósito principal de la sucursal activa.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" type="button" onClick={downloadTemplate}>
                <Download className="h-4 w-4" /> Descargar plantilla
              </Button>
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Elegir archivo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {importPhase === 'preview' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                {importRows.length} fila(s) válida(s)
              </span>
              {importErrors.length > 0 && (
                <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-700">
                  {importErrors.length} con error
                </span>
              )}
            </div>

            {importRows.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-2 py-1">Nombre</th>
                      <th className="px-2 py-1">Código</th>
                      <th className="px-2 py-1 text-right">Precio</th>
                      <th className="px-2 py-1 text-right">Costo</th>
                      <th className="px-2 py-1">Categoría</th>
                      <th className="px-2 py-1 text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importRows.slice(0, 50).map((r) => (
                      <tr key={r.line}>
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 text-slate-500">{r.barcode ?? '—'}</td>
                        <td className="px-2 py-1 text-right">{formatARS(r.price)}</td>
                        <td className="px-2 py-1 text-right text-slate-500">{formatARS(r.cost)}</td>
                        <td className="px-2 py-1 text-slate-500">{r.category ?? '—'}</td>
                        <td className="px-2 py-1 text-right">{r.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.length > 50 && (
                  <div className="px-2 py-1 text-center text-xs text-slate-400">
                    …y {importRows.length - 50} más
                  </div>
                )}
              </div>
            )}

            {importErrors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {importErrors.map((e, i) => (
                  <div key={i}>
                    Línea {e.line}: {e.message}
                  </div>
                ))}
              </div>
            )}

            {importRows.length > 0 && !activeDefaultWarehouse && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                No hay sucursal activa con depósito principal: el stock inicial se ignorará.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" type="button" onClick={() => setImportModal(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={runImport}
                disabled={importRows.length === 0}
              >
                Importar {importRows.length} producto(s)
              </Button>
            </div>
          </div>
        )}

        {importPhase === 'running' && (
          <div className="space-y-3 py-4">
            <div className="text-sm text-slate-600">
              Procesando {importProgress} de {importRows.length}…
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${importRows.length === 0 ? 0 : (importProgress / importRows.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {importPhase === 'done' && importStats && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="text-2xl font-semibold text-emerald-700">
                  {importStats.created}
                </div>
                <div className="text-xs text-emerald-700">Creados</div>
              </div>
              <div className="rounded-lg bg-sky-50 p-3">
                <div className="text-2xl font-semibold text-sky-700">{importStats.updated}</div>
                <div className="text-xs text-sky-700">Actualizados</div>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <div className="text-2xl font-semibold text-red-700">
                  {importStats.errors.length}
                </div>
                <div className="text-xs text-red-700">Con error</div>
              </div>
            </div>

            {importStats.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {importStats.errors.map((e, i) => (
                  <div key={i}>
                    Línea {e.line}: {e.message}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" onClick={() => setImportModal(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
