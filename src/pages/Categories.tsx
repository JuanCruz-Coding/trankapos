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
import type { Category } from '@/types';

interface CategoryForm {
  id: string | null;
  name: string;
  parentId: string;
  sortOrder: string;
}

const emptyForm: CategoryForm = {
  id: null,
  name: '',
  parentId: '',
  sortOrder: '0',
};

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await data.listCategories();
      setCategories(list);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Solo categorías raíz (parentId=null) pueden ser padres — enforza max 2 niveles.
  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  );

  // Hijos agrupados por parentId para renderizar jerárquico.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [categories]);

  function openCreate() {
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(c: Category) {
    setForm({
      id: c.id,
      name: c.name,
      parentId: c.parentId ?? '',
      sortOrder: String(c.sortOrder),
    });
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Nombre requerido');

    // Validar: no se puede asignar como padre a sí mismo o a uno de los hijos
    // de uno mismo (loop). El trigger SQL ya lo rechaza pero damos feedback antes.
    if (form.id && form.parentId === form.id) {
      return toast.error('Una categoría no puede ser su propio padre');
    }
    if (form.id && form.parentId) {
      // Si yo soy padre de algo, no puedo convertirme en sub-rubro (max 2 niveles).
      const hasChildren = (childrenByParent.get(form.id) ?? []).length > 0;
      if (hasChildren) {
        return toast.error(
          'Esta categoría tiene sub-rubros. No podés convertirla en sub-rubro porque excedería 2 niveles. Movelos primero.',
        );
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        parentId: form.parentId || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (form.id) {
        await data.updateCategory(form.id, payload);
        toast.success('Categoría actualizada');
      } else {
        await data.createCategory(payload);
        toast.success('Categoría creada');
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: Category) {
    const hasChildren = (childrenByParent.get(c.id) ?? []).length > 0;
    if (hasChildren) {
      return toast.error(
        'Esta categoría tiene sub-rubros. Borralos o movelos antes de eliminar el rubro padre.',
      );
    }
    const ok = await confirmDialog(`Borrar categoría "${c.name}"?`, {
      text: 'Los productos asignados a esta categoría quedan sin categoría (no se borran).',
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deleteCategory(c.id);
      toast.success('Categoría borrada');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Categorías"
        subtitle="Organizá tu catálogo por rubros y sub-rubros (máximo 2 niveles). Ej: Indumentaria → Calzado."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nueva categoría
          </Button>
        }
      />

      {loading ? (
        <div className="py-12 text-center text-slate-500">Cargando…</div>
      ) : categories.length === 0 ? (
        <Empty
          title="Sin categorías"
          description="Creá la primera categoría. Asignala después a tus productos desde su ficha."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-right">Orden</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rootCategories.flatMap((root) => {
                const kids = childrenByParent.get(root.id) ?? [];
                return [
                  <tr key={root.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{root.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{root.sortOrder}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => openEdit(root)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => handleDelete(root)}
                          title="Borrar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>,
                  ...kids.map((kid) => (
                    <tr key={kid.id} className="bg-slate-50/50">
                      <td className="px-4 py-3 pl-10 text-slate-700">
                        <span className="text-slate-400">└─</span> {kid.name}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{kid.sortOrder}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            onClick={() => openEdit(kid)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => handleDelete(kid)}
                            title="Borrar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={form.id ? 'Editar categoría' : 'Nueva categoría'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Indumentaria, Calzado, Bebidas…"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Rubro padre (opcional)
            </label>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={form.parentId}
              onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
            >
              <option value="">Es un rubro principal</option>
              {rootCategories
                .filter((c) => c.id !== form.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Si elegís un padre, esta categoría va a ser un sub-rubro. Máximo 2 niveles.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Orden</label>
            <Input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              className="w-24"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar' : 'Crear categoría'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
