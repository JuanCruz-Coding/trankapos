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
import type { CustomerGroup, PriceList } from '@/types';

interface GroupForm {
  id: string | null;
  name: string;
  code: string;
  defaultPriceListId: string;
  sortOrder: string;
  active: boolean;
}

const emptyForm: GroupForm = {
  id: null,
  name: '',
  code: '',
  defaultPriceListId: '',
  sortOrder: '0',
  active: true,
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export default function CustomerGroups() {
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<GroupForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);

  const priceListById = useMemo(() => {
    const m = new Map<string, PriceList>();
    priceLists.forEach((p) => m.set(p.id, p));
    return m;
  }, [priceLists]);

  async function load() {
    setLoading(true);
    try {
      const [gs, pls] = await Promise.all([
        data.listCustomerGroups({ activeOnly: false }),
        data.listPriceLists({ activeOnly: true }),
      ]);
      setGroups(gs);
      setPriceLists(pls);
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
    setCodeTouched(false);
    setOpen(true);
  }

  function openEdit(g: CustomerGroup) {
    setForm({
      id: g.id,
      name: g.name,
      code: g.code,
      defaultPriceListId: g.defaultPriceListId ?? '',
      sortOrder: String(g.sortOrder),
      active: g.active,
    });
    setCodeTouched(true);
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Nombre requerido');
    const code = form.code.trim() || slugify(form.name);
    if (!code) return toast.error('Código requerido');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code,
        defaultPriceListId: form.defaultPriceListId || null,
        sortOrder: Number(form.sortOrder) || 0,
        active: form.active,
      };
      if (form.id) {
        await data.updateCustomerGroup(form.id, payload);
        toast.success('Grupo actualizado');
      } else {
        await data.createCustomerGroup(payload);
        toast.success('Grupo creado');
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(g: CustomerGroup) {
    const ok = await confirmDialog(`Desactivar grupo "${g.name}"?`, {
      text: 'Los clientes asignados quedan con grupo, pero el grupo no aparece en los selectores.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivateCustomerGroup(g.id);
      toast.success('Grupo desactivado');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Grupos de clientes"
        subtitle="Segmentá tus clientes (VIP, mayoristas, empresas). Cada grupo puede tener una lista de precios por defecto y servir de condición para promociones."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nuevo grupo
          </Button>
        }
      />

      {loading ? (
        <div className="py-12 text-center text-slate-500">Cargando…</div>
      ) : groups.length === 0 ? (
        <Empty
          title="Sin grupos"
          description="Creá un grupo para asignar listas de precios y promociones a segmentos de clientes."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Lista por defecto</th>
                <th className="px-4 py-3 text-right">Orden</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {groups.map((g) => {
                const pl = g.defaultPriceListId ? priceListById.get(g.defaultPriceListId) : null;
                return (
                  <tr key={g.id} className={!g.active ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 font-medium text-slate-900">{g.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{g.code}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {pl ? pl.name : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{g.sortOrder}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={
                          g.active
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500'
                        }
                      >
                        {g.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => openEdit(g)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {g.active && (
                          <button
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => handleDeactivate(g)}
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
        title={form.id ? 'Editar grupo' : 'Nuevo grupo'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  code: codeTouched ? f.code : slugify(name),
                }));
              }}
              placeholder="VIP, Mayorista, Empresas…"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Código</label>
            <Input
              value={form.code}
              onChange={(e) => {
                setCodeTouched(true);
                setForm((f) => ({ ...f, code: e.target.value }));
              }}
              placeholder="vip, mayorista…"
              className="font-mono text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              Identificador interno. Sugerido automáticamente desde el nombre.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Lista de precios por defecto
            </label>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={form.defaultPriceListId}
              onChange={(e) => setForm((f) => ({ ...f, defaultPriceListId: e.target.value }))}
            >
              <option value="">Sin lista por defecto</option>
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault && ' (default)'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Cuando un cliente del grupo no tiene una lista propia, se usa esta.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Orden</label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                className="w-24"
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <span>Activo</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar' : 'Crear grupo'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
