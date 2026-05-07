import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Store, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { depotSchema, safeParse } from '@/lib/schemas';
import type { Depot } from '@/types';

interface FormState {
  id?: string;
  name: string;
  address: string;
  active: boolean;
}

export default function Depots() {
  const { session } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const depots = useLiveQuery(() => data.listDepots(), [session?.tenantId, refreshKey]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', address: '', active: true });

  function openNew() {
    setForm({ name: '', address: '', active: true });
    setModal(true);
  }

  function openEdit(d: Depot) {
    setForm({ id: d.id, name: d.name, address: d.address, active: d.active });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(depotSchema, {
      name: form.name,
      address: form.address,
      active: form.active,
    });
    if (!parsed.ok) return toast.error(parsed.error);
    try {
      if (form.id) {
        await data.updateDepot(form.id, parsed.data);
        toast.success('Depósito actualizado');
      } else {
        await data.createDepot(parsed.data);
        toast.success('Depósito creado');
      }
      setModal(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(d: Depot) {
    if (!confirm(`¿Eliminar depósito "${d.name}"?`)) return;
    await data.deleteDepot(d.id);
    toast.success('Depósito eliminado');
    setRefreshKey((k) => k + 1);
  }

  return (
    <div>
      <PageHeader
        title="Depósitos"
        subtitle="Cada depósito maneja su propio stock y caja"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Nuevo depósito
          </Button>
        }
      />

      {(depots ?? []).length === 0 ? (
        <Empty title="Sin depósitos" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {depots!.map((d) => (
            <div
              key={d.id}
              className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex gap-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <Store className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{d.name}</div>
                  <div className="text-xs text-slate-500">{d.address || 'Sin dirección'}</div>
                  {!d.active && <div className="mt-1 text-xs text-red-500">Inactivo</div>}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEdit(d)}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(d)}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? 'Editar depósito' : 'Nuevo depósito'}
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
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Dirección</label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4"
            />
            Activo
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">{form.id ? 'Guardar' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
