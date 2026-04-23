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
import { toast } from '@/stores/toast';
import { CSV_TEMPLATE, parseCsv, type ParseError, type ParsedRow } from '@/lib/csvImport';
import type { Product } from '@/types';

interface FormState {
  id?: string;
  name: string;
  barcode: string;
  price: string;
  cost: string;
  categoryId: string;
  taxRate: string;
  active: boolean;
  initialStock: Record<string, { qty: string; minQty: string }>;
}

const emptyForm: FormState = {
  name: '',
  barcode: '',
  price: '',
  cost: '',
  categoryId: '',
  taxRate: '21',
  active: true,
  initialStock: {},
};

type ImportPhase = 'idle' | 'preview' | 'running' | 'done';

interface ImportStats {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
  total: number;
}

export default function Products() {
  const { session, activeDepotId } = useAuth();
  const products = useLiveQuery(async () => {
    if (!session) return [];
    return data.listProducts();
  }, [session?.tenantId]);
  const categories = useLiveQuery(() => data.listCategories(), [session?.tenantId]);
  const depots = useLiveQuery(() => data.listDepots(), [session?.tenantId]);
  const stock = useLiveQuery(() => data.listStock(), [session?.tenantId]);

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
        (depots ?? []).map((d) => [d.id, { qty: '0', minQty: '5' }]),
      ),
    });
    setModal(true);
  }

  function openEdit(p: Product) {
    setForm({
      id: p.id,
      name: p.name,
      barcode: p.barcode ?? '',
      price: String(p.price),
      cost: String(p.cost),
      categoryId: p.categoryId ?? '',
      taxRate: String(p.taxRate),
      active: p.active,
      initialStock: {},
    });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        categoryId: form.categoryId || null,
        taxRate: Number(form.taxRate) || 0,
        active: form.active,
      };
      if (form.id) {
        await data.updateProduct(form.id, payload);
        toast.success('Producto actualizado');
      } else {
        const initialStock = Object.entries(form.initialStock)
          .map(([depotId, v]) => ({
            depotId,
            qty: Number(v.qty) || 0,
            minQty: Number(v.minQty) || 0,
          }))
          .filter((x) => x.qty > 0 || x.minQty > 0);
        await data.createProduct({ ...payload, initialStock });
        toast.success('Producto creado');
      }
      setModal(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(p: Product) {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return;
    try {
      await data.deleteProduct(p.id);
      toast.success('Producto eliminado');
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

        const existing = row.barcode ? await data.findProductByBarcode(row.barcode) : null;
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
            activeDepotId && row.stock > 0
              ? [{ depotId: activeDepotId, qty: row.stock, minQty: 0 }]
              : [];
          await data.createProduct({
            name: row.name,
            barcode: row.barcode,
            price: row.price,
            cost: row.cost,
            categoryId,
            taxRate: row.taxRate,
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
  }

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    (stock ?? []).forEach((s) => map.set(s.productId, (map.get(s.productId) ?? 0) + s.qty));
    return map;
  }, [stock]);

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
                <th className="px-4 py-3 text-right">Precio</th>
                <th className="px-4 py-3 text-right">Costo</th>
                <th className="px-4 py-3 text-right">Stock total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const qty = stockByProduct.get(p.id) ?? 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-md bg-slate-100 p-2 text-slate-500">
                          <Package className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{p.name}</div>
                          {!p.active && <div className="text-xs text-red-500">Inactivo</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.barcode ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatARS(p.price)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatARS(p.cost)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={qty <= 0 ? 'text-red-600' : ''}>{qty}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Editar producto' : 'Nuevo producto'}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Nombre</label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Código de barras</label>
            <Input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
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
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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
          </div>

          {!form.id && depots && depots.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-medium text-slate-700">Stock inicial por depósito</div>
              <div className="space-y-2">
                {depots.map((d) => {
                  const v = form.initialStock[d.id] ?? { qty: '0', minQty: '5' };
                  return (
                    <div key={d.id} className="flex items-center gap-2">
                      <div className="flex-1 text-sm">{d.name}</div>
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
                              [d.id]: { ...v, qty: e.target.value },
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
                              [d.id]: { ...v, minQty: e.target.value },
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
                  if (confirm(`¿Eliminar categoría "${c.name}"?`)) {
                    await data.deleteCategory(c.id);
                    toast.success('Categoría eliminada');
                  }
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
                stock). Si no, se crea. El stock inicial se carga en el depósito activo.
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

            {importRows.length > 0 && !activeDepotId && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                No hay depósito activo: el stock inicial se ignorará.
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
