import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Pencil, Plus, Star, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { PriceListItemsEditor } from '@/components/pricelists/PriceListItemsEditor';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';
import type { PriceList } from '@/types';

interface CreateForm {
  name: string;
  code: string;
  isDefault: boolean;
  sortOrder: string;
}

interface EditForm {
  id: string;
  name: string;
  code: string;
}

const emptyCreate: CreateForm = {
  name: '',
  code: '',
  isDefault: false,
  sortOrder: '0',
};

/** Slug simple para auto-generar el code desde el name. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    // Quita combining diacritical marks (acentos) post-NFD.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export default function PriceLists() {
  const [lists, setLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Modales.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [creating, setCreating] = useState(false);
  // El code lo auto-generamos hasta que el usuario lo tocó a mano.
  const [codeTouched, setCodeTouched] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(preselect?: string) {
    setLoading(true);
    try {
      // No filtramos activeOnly: en esta pantalla queremos ver también las
      // inactivas para reactivarlas eventualmente (con un toggle a futuro).
      const ls = await data.listPriceLists();
      setLists(ls);
      // Mantener la selección si sigue existiendo; sino, default o primera.
      const target =
        preselect ??
        (selectedId && ls.some((l) => l.id === selectedId) ? selectedId : null) ??
        ls.find((l) => l.isDefault)?.id ??
        ls[0]?.id ??
        null;
      setSelectedId(target);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  function openCreate() {
    setCreateForm(emptyCreate);
    setCodeTouched(false);
    setCreateOpen(true);
  }

  function updateCreate<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setCreateForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = createForm.name.trim();
    const code = createForm.code.trim() || slugify(name);
    if (!name) return toast.error('El nombre es obligatorio.');
    if (!code) return toast.error('El código no puede quedar vacío.');
    if (!/^[a-z0-9_]+$/i.test(code)) {
      return toast.error('El código solo puede tener letras, números y guion bajo.');
    }
    setCreating(true);
    try {
      const sortOrder = Number(createForm.sortOrder) || 0;
      const created = await data.createPriceList({
        name,
        code,
        isDefault: createForm.isDefault,
        sortOrder,
      });
      toast.success('Lista creada');
      setCreateOpen(false);
      await load(created.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(list: PriceList) {
    setEditForm({ id: list.id, name: list.name, code: list.code });
    setEditOpen(true);
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!editForm) return;
    const name = editForm.name.trim();
    const code = editForm.code.trim();
    if (!name) return toast.error('El nombre es obligatorio.');
    if (!code) return toast.error('El código es obligatorio.');
    if (!/^[a-z0-9_]+$/i.test(code)) {
      return toast.error('El código solo puede tener letras, números y guion bajo.');
    }
    setEditing(true);
    try {
      await data.updatePriceList(editForm.id, { name, code });
      toast.success('Lista actualizada');
      setEditOpen(false);
      await load(editForm.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEditing(false);
    }
  }

  async function handleMakeDefault(list: PriceList) {
    if (list.isDefault) return;
    const ok = await confirmDialog(`¿Marcar "${list.name}" como lista default?`, {
      text:
        'La lista default es la que se usa cuando un cliente no tiene otra asignada. ' +
        'Solo puede haber una.',
      confirmText: 'Marcar como default',
      icon: 'question',
    });
    if (!ok) return;
    try {
      await data.updatePriceList(list.id, { isDefault: true });
      toast.success('Lista marcada como default');
      await load(list.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDeactivate(list: PriceList) {
    if (list.isDefault) {
      toast.error('No se puede desactivar la lista default.');
      return;
    }
    const ok = await confirmDialog(`¿Desactivar la lista "${list.name}"?`, {
      text:
        'Los clientes que la tengan asignada van a usar la lista default. ' +
        'Esta acción se puede revertir reactivando la lista.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivatePriceList(list.id);
      toast.success('Lista desactivada');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Listas de precios"
        subtitle="Mantené precios diferenciados para mayoristas, clientes VIP, promos, etc. Asignalas a clientes desde su ficha."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nueva lista
          </Button>
        }
      />

      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : lists.length === 0 ? (
        <Empty
          title="Sin listas de precios"
          description="Cargá tu primera lista para empezar a diferenciar precios por cliente."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nueva lista
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {lists.map((l) => {
                const isSelected = l.id === selectedId;
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => setSelectedId(l.id)}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2.5 text-left transition',
                        isSelected
                          ? 'bg-ice text-navy'
                          : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <Tags
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          isSelected ? 'text-navy' : 'text-slate-400',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{l.name}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                            {l.code}
                          </code>
                          {l.isDefault && (
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              Default
                            </span>
                          )}
                          {!l.active && (
                            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              Inactiva
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Body */}
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <BadgeDollarSign className="h-5 w-5 text-brand-600" />
                      <h2 className="font-display text-lg font-bold text-navy">
                        {selected.name}
                      </h2>
                      {selected.isDefault && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Default
                        </span>
                      )}
                      {!selected.active && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          Inactiva
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Código:{' '}
                      <code className="font-mono text-slate-700">{selected.code}</code>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(selected)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                    {!selected.isDefault && selected.active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMakeDefault(selected)}
                      >
                        <Star className="h-3.5 w-3.5" />
                        Marcar default
                      </Button>
                    )}
                    {!selected.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeactivate(selected)}
                        className="text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Desactivar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <PriceListItemsEditor
                    key={selected.id}
                    priceListId={selected.id}
                    isDefault={selected.isDefault}
                  />
                </div>
              </>
            ) : (
              <div className="p-6 text-sm text-slate-500">
                Seleccioná una lista a la izquierda.
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modal: crear nueva lista */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nueva lista de precios"
      >
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Nombre <span className="text-red-600">*</span>
            </label>
            <Input
              value={createForm.name}
              onChange={(e) => {
                const v = e.target.value;
                updateCreate('name', v);
                if (!codeTouched) {
                  updateCreate('code', slugify(v));
                }
              }}
              autoFocus
              placeholder="Ej: Mayorista, VIP, Black Friday"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Código <span className="text-red-600">*</span>
            </label>
            <Input
              value={createForm.code}
              onChange={(e) => {
                setCodeTouched(true);
                updateCreate('code', e.target.value);
              }}
              placeholder="Ej: mayorista"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Identificador único, sin espacios. Se autogenera desde el nombre.
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Orden de aparición
            </label>
            <Input
              type="number"
              min="0"
              value={createForm.sortOrder}
              onChange={(e) => updateCreate('sortOrder', e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={createForm.isDefault}
              onChange={(e) => updateCreate('isDefault', e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <strong>Marcar como default</strong>
              <span className="block text-xs text-slate-500">
                Esta lista se va a usar para clientes que no tengan otra asignada. La que era
                default queda como una lista normal.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creando…' : 'Crear lista'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: editar nombre / code */}
      <Modal
        open={editOpen && editForm !== null}
        onClose={() => setEditOpen(false)}
        title="Editar lista"
      >
        {editForm && (
          <form onSubmit={handleEdit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Nombre <span className="text-red-600">*</span>
              </label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Código <span className="text-red-600">*</span>
              </label>
              <Input
                value={editForm.code}
                onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editing}>
                {editing ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
