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
import { branchSchema, safeParse } from '@/lib/schemas';
import { confirmDialog } from '@/lib/dialog';
import type { Branch } from '@/types';

interface FormState {
  id?: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
}

export default function Branches() {
  const { session, refreshSubscription } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId, refreshKey]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    address: '',
    phone: '',
    email: '',
    active: true,
  });

  function openNew() {
    setForm({ name: '', address: '', phone: '', email: '', active: true });
    setModal(true);
  }

  function openEdit(b: Branch) {
    setForm({
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      email: b.email,
      active: b.active,
    });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(branchSchema, {
      name: form.name,
      address: form.address,
      phone: form.phone,
      email: form.email,
      active: form.active,
    });
    if (!parsed.ok) return toast.error(parsed.error);
    try {
      if (form.id) {
        await data.updateBranch(form.id, parsed.data);
        toast.success('Sucursal actualizada');
      } else {
        await data.createBranch(parsed.data);
        toast.success('Sucursal creada');
      }
      setModal(false);
      setRefreshKey((k) => k + 1);
      void refreshSubscription();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(b: Branch) {
    const ok = await confirmDialog(`¿Eliminar sucursal "${b.name}"?`, {
      text: 'Se va a eliminar junto con sus depósitos y stock asociado.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deleteBranch(b.id);
      toast.success('Sucursal eliminada');
      setRefreshKey((k) => k + 1);
      void refreshSubscription();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sucursales"
        subtitle="Cada sucursal tiene sus propias cajas, ventas y depósitos"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Nueva sucursal
          </Button>
        }
      />

      {(branches ?? []).length === 0 ? (
        <Empty title="Sin sucursales" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {branches!.map((b) => (
            <div
              key={b.id}
              className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex gap-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <Store className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{b.name}</div>
                  <div className="text-xs text-slate-500">{b.address || 'Sin dirección'}</div>
                  {!b.active && <div className="mt-1 text-xs text-red-500">Inactiva</div>}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEdit(b)}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(b)}
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
        title={form.id ? 'Editar sucursal' : 'Nueva sucursal'}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Teléfono</label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4"
            />
            Activa
          </label>
          {!form.id && (
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              Al crear la sucursal se genera automáticamente su depósito principal con el mismo nombre.
            </p>
          )}
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
