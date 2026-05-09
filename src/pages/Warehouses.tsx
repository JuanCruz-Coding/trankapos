import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Boxes, Pencil, Trash2, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { warehouseSchema, safeParse } from '@/lib/schemas';
import { confirmDialog } from '@/lib/dialog';
import { usePlan } from '@/lib/features';
import type { Warehouse } from '@/types';

interface FormState {
  id?: string;
  name: string;
  branchId: string | null;
  isDefault: boolean;
  active: boolean;
}

export default function Warehouses() {
  const { session, refreshSubscription } = useAuth();
  const { has } = usePlan();
  const [refreshKey, setRefreshKey] = useState(0);
  const warehouses = useLiveQuery(() => data.listWarehouses(), [session?.tenantId, refreshKey]);
  const branches = useLiveQuery(() => data.listBranches(), [session?.tenantId, refreshKey]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    branchId: null,
    isDefault: false,
    active: true,
  });

  const branchById = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b])),
    [branches],
  );

  const canCentral = has('central_warehouse');

  function openNew() {
    setForm({
      name: '',
      branchId: branches?.[0]?.id ?? null,
      isDefault: false,
      active: true,
    });
    setModal(true);
  }

  function openEdit(w: Warehouse) {
    setForm({
      id: w.id,
      name: w.name,
      branchId: w.branchId,
      isDefault: w.isDefault,
      active: w.active,
    });
    setModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(warehouseSchema, {
      name: form.name,
      branchId: form.branchId,
      isDefault: form.isDefault,
      active: form.active,
    });
    if (!parsed.ok) return toast.error(parsed.error);
    try {
      if (form.id) {
        await data.updateWarehouse(form.id, parsed.data);
        toast.success('Depósito actualizado');
      } else {
        await data.createWarehouse(parsed.data);
        toast.success('Depósito creado');
      }
      setModal(false);
      setRefreshKey((k) => k + 1);
      void refreshSubscription();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(w: Warehouse) {
    if (w.isDefault) {
      toast.error('No podés eliminar el depósito principal de una sucursal');
      return;
    }
    const ok = await confirmDialog(`¿Eliminar depósito "${w.name}"?`, {
      text: 'Se va a eliminar junto con su stock asociado.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deleteWarehouse(w.id);
      toast.success('Depósito eliminado');
      setRefreshKey((k) => k + 1);
      void refreshSubscription();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Depósitos"
        subtitle="Cada depósito tiene su propio stock. El principal de cada sucursal es desde el que vende el POS."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Nuevo depósito
          </Button>
        }
      />

      {(warehouses ?? []).length === 0 ? (
        <Empty title="Sin depósitos" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {warehouses!.map((w) => {
            const branch = w.branchId ? branchById.get(w.branchId) : null;
            return (
              <div
                key={w.id}
                className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex gap-3">
                  <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                    <Boxes className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      {w.name}
                      {w.isDefault && (
                        <span title="Principal" className="text-amber-500">
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {branch ? branch.name : <em className="text-cyan-700">Central (sin sucursal)</em>}
                    </div>
                    {!w.active && <div className="mt-1 text-xs text-red-500">Inactivo</div>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(w)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(w)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
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
            <label className="mb-1 block text-xs font-medium text-slate-700">Sucursal</label>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              value={form.branchId ?? '__central__'}
              onChange={(e) =>
                setForm({
                  ...form,
                  branchId: e.target.value === '__central__' ? null : e.target.value,
                })
              }
            >
              {(branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {canCentral && (
                <option value="__central__">— Central (sin sucursal)</option>
              )}
            </select>
            {!canCentral && (
              <p className="mt-1 text-xs text-slate-500">
                Los depósitos centrales (sin sucursal) solo están disponibles en plan Empresa.
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="h-4 w-4"
              disabled={form.branchId === null}
            />
            Es el principal de la sucursal (POS resta de este depósito)
          </label>
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
