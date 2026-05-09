import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { safeParse, userSchema } from '@/lib/schemas';
import { confirmDialog } from '@/lib/dialog';
import {
  PERMISSION_DEFAULTS_BY_ROLE,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
} from '@/lib/permissions';
import type {
  BranchAccess,
  Permission,
  PermissionsMap,
  Role,
  User,
} from '@/types';

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
  branchId: string;
  active: boolean;
  /** 'all' o array de branchIds */
  branchAccessMode: 'all' | 'specific';
  branchAccessIds: string[];
  permissionOverrides: PermissionsMap;
}

const emptyForm: FormState = {
  email: '',
  name: '',
  password: '',
  role: 'cashier',
  branchId: '',
  active: true,
  branchAccessMode: 'specific',
  branchAccessIds: [],
  permissionOverrides: {},
};

export default function Users() {
  const { session } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const users = useLiveQuery(() => data.listUsers(), [session?.tenantId, refreshKey]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId, refreshKey]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  function openNew() {
    const firstBranch = branches?.[0]?.id ?? '';
    setForm({
      ...emptyForm,
      branchId: firstBranch,
      branchAccessMode: 'specific',
      branchAccessIds: firstBranch ? [firstBranch] : [],
    });
    setModal(true);
  }

  function openEdit(u: User) {
    const access = u.branchAccess;
    const mode: 'all' | 'specific' = access === 'all' ? 'all' : 'specific';
    const ids = Array.isArray(access) ? access : [];
    setForm({
      id: u.id,
      email: u.email,
      name: u.name,
      password: '',
      role: u.role,
      branchId: u.branchId ?? '',
      active: u.active,
      branchAccessMode: mode,
      branchAccessIds: ids,
      permissionOverrides: u.permissionOverrides ?? {},
    });
    setModal(true);
  }

  function toggleBranchAccess(branchId: string) {
    setForm((f) => {
      const exists = f.branchAccessIds.includes(branchId);
      return {
        ...f,
        branchAccessIds: exists
          ? f.branchAccessIds.filter((id) => id !== branchId)
          : [...f.branchAccessIds, branchId],
      };
    });
  }

  function setPermissionOverride(key: Permission, value: boolean | undefined) {
    setForm((f) => {
      const next: PermissionsMap = { ...f.permissionOverrides };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return { ...f, permissionOverrides: next };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(userSchema, {
      email: form.email,
      name: form.name,
      password: form.password || undefined,
      role: form.role,
      branchId: form.branchId || null,
      active: form.active,
    });
    if (!parsed.ok) return toast.error(parsed.error);
    if (!form.id && !parsed.data.password) {
      return toast.error('La contraseña es obligatoria al crear un usuario');
    }

    // Resolver branchAccess que se manda al driver
    const branchAccess: BranchAccess =
      form.branchAccessMode === 'all' ? 'all' : form.branchAccessIds;

    if (form.branchAccessMode === 'specific' && branchAccess.length === 0 && form.role !== 'owner') {
      return toast.error('El usuario debe tener acceso a al menos una sucursal');
    }

    try {
      if (form.id) {
        await data.updateUser(form.id, {
          ...parsed.data,
          branchAccess,
          permissionOverrides: form.permissionOverrides,
        });
        toast.success('Usuario actualizado');
      } else {
        await data.createUser({
          ...parsed.data,
          password: parsed.data.password!,
          branchAccess,
          permissionOverrides: form.permissionOverrides,
        });
        toast.success('Usuario creado');
      }
      setModal(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(u: User) {
    const ok = await confirmDialog(`¿Eliminar usuario "${u.name}"?`, {
      text: 'No vas a poder recuperarlo.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deleteUser(u.id);
      toast.success('Usuario eliminado');
      setRefreshKey((k) => k + 1);
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
                <th className="px-4 py-3">Acceso</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users!.map((u) => {
                const access = u.branchAccess;
                let accessLabel: string;
                if (u.role === 'owner' || access === 'all') {
                  accessLabel = 'Todas las sucursales';
                } else if (Array.isArray(access) && access.length > 0) {
                  const names = access
                    .map((id) => branches?.find((b) => b.id === id)?.name)
                    .filter(Boolean);
                  accessLabel =
                    names.length === 1
                      ? (names[0] as string)
                      : `${names.length} sucursales`;
                } else {
                  accessLabel = 'Sin acceso';
                }
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
                    <td className="px-4 py-3 text-slate-600">{accessLabel}</td>
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
        widthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
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
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Sucursal por defecto
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {(branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                La sucursal con la que el user arranca al loguearse.
              </p>
            </div>
          </div>

          {/* ---- Acceso a sucursales ---- */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-2 text-xs font-semibold uppercase text-slate-500">
              Acceso a sucursales
            </legend>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="branchAccessMode"
                  checked={form.branchAccessMode === 'all'}
                  onChange={() => setForm({ ...form, branchAccessMode: 'all' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <strong>Todas las sucursales</strong>
                  <span className="block text-xs text-slate-500">
                    Incluye sucursales que se creen a futuro. Recomendado para owner / regional.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="branchAccessMode"
                  checked={form.branchAccessMode === 'specific'}
                  onChange={() => setForm({ ...form, branchAccessMode: 'specific' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <strong>Sucursales específicas</strong>
                  <span className="block text-xs text-slate-500">
                    Marcá abajo cuáles puede ver. No verá las que no estén marcadas.
                  </span>
                </span>
              </label>
              {form.branchAccessMode === 'specific' && (
                <div className="ml-6 mt-2 grid gap-1 sm:grid-cols-2">
                  {(branches ?? []).map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.branchAccessIds.includes(b.id)}
                        onChange={() => toggleBranchAccess(b.id)}
                        className="h-4 w-4"
                      />
                      {b.name}
                    </label>
                  ))}
                  {(branches ?? []).length === 0 && (
                    <span className="text-xs text-slate-400">No hay sucursales todavía.</span>
                  )}
                </div>
              )}
            </div>
          </fieldset>

          {/* ---- Permisos avanzados ---- */}
          {form.role !== 'owner' && (
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-2 text-xs font-semibold uppercase text-slate-500">
                Permisos avanzados
              </legend>
              <p className="mb-2 text-xs text-slate-500">
                Los permisos por default vienen del rol. Usá los toggles para hacer
                excepciones a un usuario en particular. Owner siempre tiene todos los permisos.
              </p>
              <div className="space-y-1.5">
                {PERMISSION_KEYS.map((key) => {
                  const roleDefault = PERMISSION_DEFAULTS_BY_ROLE[form.role][key];
                  const override = form.permissionOverrides[key];
                  const effective = override !== undefined ? override : roleDefault;
                  const isOverride = override !== undefined;
                  return (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 rounded p-1.5 hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800">
                          {PERMISSION_LABELS[key]}
                          {isOverride && (
                            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              override
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {PERMISSION_DESCRIPTIONS[key]}{' '}
                          <span className="text-slate-400">
                            (Por rol {form.role}: {roleDefault ? 'sí' : 'no'})
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={effective}
                          onChange={(e) =>
                            setPermissionOverride(
                              key,
                              e.target.checked === roleDefault ? undefined : e.target.checked,
                            )
                          }
                          className="h-4 w-4"
                        />
                        {isOverride && (
                          <button
                            type="button"
                            className="text-[10px] text-slate-400 underline hover:text-slate-700"
                            onClick={() => setPermissionOverride(key, undefined)}
                            title="Volver al default del rol"
                          >
                            reset
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4"
            />
            Usuario activo
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
