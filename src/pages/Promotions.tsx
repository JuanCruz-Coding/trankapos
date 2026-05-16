import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import type {
  Brand,
  Category,
  CustomerGroup,
  Product,
  Promotion,
  PromotionScopeType,
  PromotionType,
} from '@/types';

interface PromoForm {
  id: string | null;
  name: string;
  promoType: PromotionType;
  percentOff: string;
  buyQty: string;
  payQty: string;
  scopeType: PromotionScopeType;
  scopeValue: string;
  customerGroupId: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  active: boolean;
}

const emptyForm: PromoForm = {
  id: null,
  name: '',
  promoType: 'percent_off',
  percentOff: '10',
  buyQty: '2',
  payQty: '1',
  scopeType: 'all',
  scopeValue: '',
  customerGroupId: '',
  startsAt: '',
  endsAt: '',
  priority: '0',
  active: true,
};

function toLocalDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function fromLocalDateTime(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmtDateRange(starts: string | null, ends: string | null): string {
  if (!starts && !ends) return 'Siempre';
  const fmt = (s: string) => new Date(s).toLocaleDateString('es-AR');
  if (starts && ends) return `${fmt(starts)} → ${fmt(ends)}`;
  if (starts) return `Desde ${fmt(starts)}`;
  return `Hasta ${fmt(ends!)}`;
}

function describePromo(p: Promotion): string {
  if (p.promoType === 'percent_off') {
    return `${p.percentOff}% off`;
  }
  return `${p.buyQty}×${p.payQty}`;
}

function describeScope(
  p: Promotion,
  productById: Map<string, Product>,
  categoryById: Map<string, Category>,
  brandById: Map<string, Brand>,
): string {
  if (p.scopeType === 'all') return 'Todo el catálogo';
  if (p.scopeType === 'product') {
    const prod = p.scopeValue ? productById.get(p.scopeValue) : null;
    return prod ? `Producto: ${prod.name}` : 'Producto eliminado';
  }
  if (p.scopeType === 'category') {
    const cat = p.scopeValue ? categoryById.get(p.scopeValue) : null;
    return cat ? `Categoría: ${cat.name}` : 'Categoría eliminada';
  }
  const brand = p.scopeValue ? brandById.get(p.scopeValue) : null;
  return brand ? `Marca: ${brand.name}` : 'Marca eliminada';
}

export default function Promotions() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PromoForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);
  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);
  const groupById = useMemo(() => {
    const m = new Map<string, CustomerGroup>();
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);
  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    brands.forEach((b) => m.set(b.id, b));
    return m;
  }, [brands]);

  async function load() {
    setLoading(true);
    try {
      const [ps, gs, prods, cats, bs] = await Promise.all([
        data.listPromotions({ activeOnly: false }),
        data.listCustomerGroups({ activeOnly: true }),
        data.listProducts(),
        data.listCategories(),
        data.listBrands({ activeOnly: true }),
      ]);
      setPromos(ps);
      setGroups(gs);
      setProducts(prods);
      setCategories(cats);
      setBrands(bs);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(p: Promotion) {
    setForm({
      id: p.id,
      name: p.name,
      promoType: p.promoType,
      percentOff: p.percentOff != null ? String(p.percentOff) : '10',
      buyQty: p.buyQty != null ? String(p.buyQty) : '2',
      payQty: p.payQty != null ? String(p.payQty) : '1',
      scopeType: p.scopeType,
      scopeValue: p.scopeValue ?? '',
      customerGroupId: p.customerGroupId ?? '',
      startsAt: toLocalDateTime(p.startsAt),
      endsAt: toLocalDateTime(p.endsAt),
      priority: String(p.priority),
      active: p.active,
    });
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Nombre requerido');

    if (form.promoType === 'percent_off') {
      const pct = Number(form.percentOff);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return toast.error('% off debe estar entre 0 y 100');
      }
    } else {
      const b = Number(form.buyQty);
      const p = Number(form.payQty);
      if (!Number.isFinite(b) || b < 2) return toast.error('Cantidad a llevar mínimo 2');
      if (!Number.isFinite(p) || p < 1) return toast.error('Cantidad a pagar mínimo 1');
      if (b <= p) return toast.error('Cantidad a llevar debe ser mayor que a pagar');
    }

    if (form.scopeType !== 'all' && !form.scopeValue.trim()) {
      return toast.error('El scope requiere un valor');
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        promoType: form.promoType,
        percentOff: form.promoType === 'percent_off' ? Number(form.percentOff) : null,
        buyQty: form.promoType === 'nxm' ? Number(form.buyQty) : null,
        payQty: form.promoType === 'nxm' ? Number(form.payQty) : null,
        scopeType: form.scopeType,
        scopeValue: form.scopeType === 'all' ? null : form.scopeValue.trim(),
        customerGroupId: form.customerGroupId || null,
        startsAt: fromLocalDateTime(form.startsAt),
        endsAt: fromLocalDateTime(form.endsAt),
        priority: Number(form.priority) || 0,
        active: form.active,
      };
      if (form.id) {
        await data.updatePromotion(form.id, payload);
        toast.success('Promoción actualizada');
      } else {
        await data.createPromotion(payload);
        toast.success('Promoción creada');
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(p: Promotion) {
    const ok = await confirmDialog(`Desactivar promoción "${p.name}"?`, {
      text: 'No se va a aplicar más en el POS. Las ventas pasadas con esta promo no se tocan.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivatePromotion(p.id);
      toast.success('Promoción desactivada');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Promociones"
        subtitle="2x1, % off por categoría/producto/marca, descuentos para un grupo de clientes. Se aplican automáticamente al cobrar."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nueva promoción
          </Button>
        }
      />

      {loading ? (
        <div className="py-12 text-center text-slate-500">Cargando…</div>
      ) : promos.length === 0 ? (
        <Empty
          title="Sin promociones"
          description="Creá tu primera promoción. Se aplican automáticamente al armar el carrito."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Aplica a</th>
                <th className="px-4 py-3 text-left">Clientes</th>
                <th className="px-4 py-3 text-left">Vigencia</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {promos.map((p) => {
                const group = p.customerGroupId ? groupById.get(p.customerGroupId) : null;
                return (
                  <tr key={p.id} className={!p.active ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {describePromo(p)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {describeScope(p, productById, categoryById, brandById)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {group ? group.name : <span className="text-slate-400">Todos</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {fmtDateRange(p.startsAt, p.endsAt)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={
                          p.active
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500'
                        }
                      >
                        {p.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => openEdit(p)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {p.active && (
                          <button
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => handleDeactivate(p)}
                            title="Desactivar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={form.id ? 'Editar promoción' : 'Nueva promoción'}
        widthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: 2x1 verano / 20% off categoría calzado"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={
                  'rounded-lg border-2 p-3 text-left text-sm transition ' +
                  (form.promoType === 'percent_off'
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
                onClick={() => setForm((f) => ({ ...f, promoType: 'percent_off' }))}
              >
                <div className="font-medium">% de descuento</div>
                <div className="text-xs text-slate-500">Ej: 20% off en categoría</div>
              </button>
              <button
                type="button"
                className={
                  'rounded-lg border-2 p-3 text-left text-sm transition ' +
                  (form.promoType === 'nxm'
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
                onClick={() => setForm((f) => ({ ...f, promoType: 'nxm' }))}
              >
                <div className="font-medium">Lleva X paga Y</div>
                <div className="text-xs text-slate-500">Ej: 2x1, 3x2</div>
              </button>
            </div>
          </div>

          {form.promoType === 'percent_off' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Porcentaje de descuento
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={form.percentOff}
                  onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))}
                  className="w-32"
                />
                <span className="text-sm text-slate-600">%</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Lleva</label>
                <Input
                  type="number"
                  min="2"
                  value={form.buyQty}
                  onChange={(e) => setForm((f) => ({ ...f, buyQty: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Paga</label>
                <Input
                  type="number"
                  min="1"
                  value={form.payQty}
                  onChange={(e) => setForm((f) => ({ ...f, payQty: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Aplica a</label>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={form.scopeType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  scopeType: e.target.value as PromotionScopeType,
                  scopeValue: '',
                }))
              }
            >
              <option value="all">Todo el catálogo</option>
              <option value="product">Un producto específico</option>
              <option value="category">Una categoría</option>
              <option value="brand">Una marca</option>
            </select>
          </div>

          {form.scopeType === 'product' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Producto</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                value={form.scopeValue}
                onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))}
              >
                <option value="">Elegir producto…</option>
                {products
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {form.scopeType === 'category' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Categoría</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                value={form.scopeValue}
                onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))}
              >
                <option value="">Elegir categoría…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.scopeType === 'brand' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Marca</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                value={form.scopeValue}
                onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))}
              >
                <option value="">Elegir marca…</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {brands.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  No tenés marcas cargadas. Andá a "Marcas" en el menú lateral y creá la marca
                  primero (la podés asignar después a los productos en su ficha).
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filtro de cliente
            </label>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={form.customerGroupId}
              onChange={(e) => setForm((f) => ({ ...f, customerGroupId: e.target.value }))}
            >
              <option value="">Todos los clientes (incluso anónimos)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  Solo grupo: {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Desde (opcional)
              </label>
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Hasta (opcional)
              </label>
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Prioridad</label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-24"
              />
              <p className="mt-1 text-xs text-slate-500">
                Si dos promos empatan en descuento, gana la de mayor prioridad.
              </p>
            </div>
            <label className="flex items-center gap-2 self-end pb-7 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <span>Activa</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar' : 'Crear promoción'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
