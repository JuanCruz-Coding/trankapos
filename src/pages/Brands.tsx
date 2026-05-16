import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import type { Brand } from '@/types';

interface BrandForm {
  id: string | null;
  name: string;
  sortOrder: string;
  active: boolean;
}

const emptyForm: BrandForm = {
  id: null,
  name: '',
  sortOrder: '0',
  active: true,
};

export default function Brands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BrandForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await data.listBrands({ activeOnly: false });
      setBrands(list);
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

  function openEdit(b: Brand) {
    setForm({
      id: b.id,
      name: b.name,
      sortOrder: String(b.sortOrder),
      active: b.active,
    });
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Nombre requerido');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sortOrder: Number(form.sortOrder) || 0,
        active: form.active,
      };
      if (form.id) {
        await data.updateBrand(form.id, payload);
        toast.success('Marca actualizada');
      } else {
        await data.createBrand(payload);
        toast.success('Marca creada');
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(b: Brand) {
    const ok = await confirmDialog(`Desactivar marca "${b.name}"?`, {
      text: 'Los productos asignados a esta marca la mantienen, pero la marca no aparece en los selectores.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivateBrand(b.id);
      toast.success('Marca desactivada');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Marcas"
        subtitle="Catálogo de marcas. Usalo para asignar a productos y para condicionar promociones por marca."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nueva marca
          </Button>
        }
      />

      {loading ? (
        <div className="py-12 text-center text-slate-500">Cargando…</div>
      ) : brands.length === 0 ? (
        <Empty
          title="Sin marcas"
          description="Creá las marcas que comercializás. Después las asignás en la ficha de cada producto."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Marca</th>
                <th className="px-4 py-3 text-right">Orden</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {brands.map((b) => (
                <tr key={b.id} className={!b.active ? 'opacity-50' : ''}>
                  <td className="px-4 py-3 font-medium text-slate-900">{b.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.sortOrder}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={
                        b.active
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700'
                          : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500'
                      }
                    >
                      {b.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => openEdit(b)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {b.active && (
                        <button
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => handleDeactivate(b)}
                          title="Desactivar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => !saving && setOpen(false)} title={form.id ? 'Editar marca' : 'Nueva marca'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nike, Adidas, Puma…"
              autoFocus
            />
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
              <span>Activa</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar' : 'Crear marca'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
