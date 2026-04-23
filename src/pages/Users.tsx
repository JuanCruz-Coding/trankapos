import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Pencil, Trash2, Users as UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import type { Role, User } from '@/types';

const ROLES: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Dueño' },
  { value: 'manager', label: 'Encargado' },
  { value: 'cashier', label: 'Cajero' },
];

interface FormState {
  id?: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  depotId: string;
  active: boolean;
}

const emptyForm: FormState = {
  email: '',
  name: '',
  password: '',
  role: 'cashier',
  depotId: '',
  active: true,
};

export default function Users() {
  const { session } = useAuth();
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId]);
  const depots = useLiveQuery(() => data.listDepots(), [session?.tenantId]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  function openNew() {
    setForm({ ...emptyForm, depotId: depots?.[0]?.id ?? '' });
    setModal(true);
  }

  function openEdit(u: User) {
    setForm({
      id: u.id,
      email: u.email,
      name: u.name,
      password: '',
      role: u.role,
      depotId: u.depotId ?? '',
      active: u.active,
    });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        email: form.email,
        name: form.name,
        role: form.role,
        depotId: form.depotId || null,
        active: form.active,
        ...(form.password ? { password: form.password } : {}),
      };
      if (form.id) {
        await data.updateUser(form.id, payload);
        toast.success('Usuario actualizado');
      } else {
        if (!form.password) {
          toast.error('Password requerido');
          return;
        }
        await data.createUser(payload as any);
        toast.success('Usuario creado');
      }
      setModal(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(`¿Eliminar usuario "${u.name}"?`)) return;
    try {
      await data.deleteUser(u.id);
      toast.success('Usuario eliminado');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Dueños, encargados y cajeros"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Nuevo usuario
          </Button>
        }
      />

      {(users ?? []).length === 0 ? (
        <Empty title="Sin usuarios" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Depósito</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users!.map((u) => {
                const depot = depots?.find((d) => d.id === u.depotId);
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                          {u.name[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 capitalize">{u.role}</td>
                    <td className="px-4 py-3 text-slate-600">{depot?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-xs ' +
                          (u.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500')
                        }
                      >
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {u.id !== session?.userId && (
                          <button
                            onClick={() => handleDelete(u)}
                            className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
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
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? 'Editar usuario' : 'Nuevo usuario'}
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
            <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              {form.id ? 'Nueva contraseña (opcional)' : 'Contraseña'}
            </label>
            <Input
              type="password"
              minLength={form.id ? 0 : 6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Rol</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Depósito</label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.depotId}
                onChange={(e) => setForm({ ...form, depotId: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {(depots ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
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
