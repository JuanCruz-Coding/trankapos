import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Pencil,
  Plus,
  Trash2,
  ArrowLeftRight,
  Warehouse as WarehouseIcon,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';
import type { ReturnReason, Warehouse } from '@/types';

interface FormState {
  id?: string;
  code: string;
  label: string;
  stockDestination: 'original' | 'specific_warehouse' | 'discard';
  destinationWarehouseId: string | null;
  allowsCashRefund: boolean;
  active: boolean;
  sortOrder: string;
}

const emptyForm: FormState = {
  code: '',
  label: '',
  stockDestination: 'original',
  destinationWarehouseId: null,
  allowsCashRefund: false,
  active: true,
  sortOrder: '0',
};

/** Convierte un label en un code slug (lowercase, sin espacios). */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/**
 * CRUD de motivos de devolución/cambio (Sprint DEV).
 *
 * Los motivos se usan al hacer una devolución o cambio desde Sales para
 * indicar por qué el cliente devuelve y a dónde va el stock devuelto.
 */
export function ReturnReasonsEditor() {
  const [reasons, setReasons] = useState<ReturnReason[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  // codeManuallyEdited: si el usuario tocó el code, dejamos de auto-slugify
  // a partir del label (evita pisar lo que escribió a mano).
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [rs, ws] = await Promise.all([
        data.listReturnReasons({ activeOnly: false }),
        data.listWarehouses(),
      ]);
      setReasons(rs);
      setWarehouses(ws);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Para el select de "depósito específico" recomendamos primero los que no
  // participan en POS (típicamente service / merma / devoluciones).
  const sortedWarehouses = useMemo(() => {
    return [...warehouses]
      .filter((w) => w.active)
      .sort((a, b) => {
        // participatesInPos=false va primero
        if (a.participatesInPos !== b.participatesInPos) {
          return a.participatesInPos ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });
  }, [warehouses]);

  function warehouseLabel(id: string | null): string {
    if (!id) return '—';
    return warehouses.find((w) => w.id === id)?.name ?? '(eliminado)';
  }

  function openNew() {
    setForm(emptyForm);
    setCodeManuallyEdited(false);
    setModalOpen(true);
  }

  function openEdit(r: ReturnReason) {
    setForm({
      id: r.id,
      code: r.code,
      label: r.label,
      stockDestination: r.stockDestination,
      destinationWarehouseId: r.destinationWarehouseId,
      allowsCashRefund: r.allowsCashRefund,
      active: r.active,
      sortOrder: String(r.sortOrder),
    });
    setCodeManuallyEdited(true); // al editar, no pisamos el code aunque cambien el label
    setModalOpen(true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleLabelChange(value: string) {
    setForm((f) => {
      const next = { ...f, label: value };
      // Auto-generar code mientras el usuario no lo tocó manualmente.
      if (!codeManuallyEdited) {
        next.code = slugify(value);
      }
      return next;
    });
  }

  function handleCodeChange(value: string) {
    setCodeManuallyEdited(true);
    // Forzamos lowercase, sin espacios.
    const cleaned = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    update('code', cleaned);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) {
      return toast.error('El label es obligatorio.');
    }
    if (!form.code.trim()) {
      return toast.error('El code es obligatorio.');
    }
    if (form.stockDestination === 'specific_warehouse' && !form.destinationWarehouseId) {
      return toast.error('Elegí un depósito de destino.');
    }
    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      return toast.error('Sort order debe ser numérico.');
    }

    setSaving(true);
    try {
      const input = {
        code: form.code.trim(),
        label: form.label.trim(),
        stockDestination: form.stockDestination,
        destinationWarehouseId:
          form.stockDestination === 'specific_warehouse' ? form.destinationWarehouseId : null,
        allowsCashRefund: form.allowsCashRefund,
        active: form.active,
        sortOrder,
      };
      if (form.id) {
        await data.updateReturnReason(form.id, input);
        toast.success('Motivo actualizado');
      } else {
        await data.createReturnReason(input);
        toast.success('Motivo creado');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: ReturnReason) {
    const ok = await confirmDialog(`¿Desactivar motivo "${r.label}"?`, {
      text: 'Ya no aparecerá al hacer devoluciones nuevas. Las devoluciones pasadas no se afectan.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivateReturnReason(r.id);
      toast.success('Motivo desactivado');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Motivos que el cajero puede elegir al hacer una devolución o cambio. El{' '}
          <strong>destino del stock</strong> define a qué depósito vuelve el item devuelto.
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nuevo motivo
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Cargando motivos…</div>
      ) : reasons.length === 0 ? (
        <Empty
          title="Todavía no hay motivos cargados"
          description="Creá motivos típicos: 'Falla', 'Talle incorrecto', 'Cliente arrepentido'. Cada uno define a qué depósito vuelve el stock devuelto."
          action={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Crear primer motivo
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Destino del stock</th>
                <th className="px-3 py-2">Orden</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reasons.map((r) => (
                <tr key={r.id} className={cn('hover:bg-slate-50', !r.active && 'opacity-60')}>
                  <td className="px-3 py-2 font-medium text-navy">{r.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.code}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <StockDestinationBadge
                        destination={r.stockDestination}
                        warehouseName={warehouseLabel(r.destinationWarehouseId)}
                      />
                      {r.allowsCashRefund && (
                        <span
                          className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                          title="Este motivo permite devolución en efectivo aún si la política es 'sólo vale'"
                        >
                          Permite cash
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.sortOrder}</td>
                  <td className="px-3 py-2">
                    {r.active ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Activo
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openEdit(r)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-navy"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {r.active && (
                      <button
                        onClick={() => handleDelete(r)}
                        className="ml-1 rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700"
                        title="Desactivar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Editar motivo' : 'Nuevo motivo'}
        widthClass="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Label" hint="El texto que ve el cajero al hacer la devolución">
            <Input
              value={form.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              autoFocus
              placeholder="Ej. Falla de fábrica"
            />
          </Field>
          <Field label="Code" hint="Identificador interno (lowercase, sin espacios). Se autogenera.">
            <Input
              value={form.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="falla_de_fabrica"
              maxLength={32}
            />
          </Field>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-700">Destino del stock</div>
            <div className="space-y-2">
              <RadioCard
                checked={form.stockDestination === 'original'}
                onSelect={() => update('stockDestination', 'original')}
                title="Vuelve al depósito original"
                description="El item devuelto se reincorpora al stock del depósito donde se vendió. Uso típico: cambio de talle, cliente arrepentido."
                accent="emerald"
              />
              <RadioCard
                checked={form.stockDestination === 'specific_warehouse'}
                onSelect={() => update('stockDestination', 'specific_warehouse')}
                title="Va a un depósito específico"
                description="Útil para mandar fallas a un depósito 'Service' o 'Devoluciones' separado del stock vendible."
                accent="amber"
              />
              {form.stockDestination === 'specific_warehouse' && (
                <div className="ml-7 mt-2">
                  <Field
                    label="Depósito de destino"
                    hint="Recomendamos depósitos que no participan en POS (no se cuentan como stock vendible)."
                  >
                    <select
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                      value={form.destinationWarehouseId ?? ''}
                      onChange={(e) =>
                        update('destinationWarehouseId', e.target.value || null)
                      }
                    >
                      <option value="">Seleccionar…</option>
                      {sortedWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {!w.participatesInPos && ' (no POS · recomendado)'}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <RadioCard
                checked={form.stockDestination === 'discard'}
                onSelect={() => update('stockDestination', 'discard')}
                title="Se descarta (merma)"
                description="El item devuelto no vuelve a ningún depósito. Se registra como pérdida. Uso típico: productos rotos, perecederos."
                accent="red"
              />
            </div>
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300 bg-white p-3 text-sm">
              <input
                type="checkbox"
                checked={form.allowsCashRefund}
                onChange={(e) => update('allowsCashRefund', e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-medium">Permite devolución en efectivo</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Aún si la política del comercio es "siempre vale". Útil para motivos como
                  "Defectuoso" (Ley 24.240: derecho del consumidor a la devolución en cash).
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Orden" hint="Cuanto menor, primero en la lista.">
              <Input
                type="number"
                step="1"
                value={form.sortOrder}
                onChange={(e) => update('sortOrder', e.target.value)}
              />
            </Field>
            {form.id && (
              <Field label="Activo">
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => update('active', e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{form.active ? 'Visible al hacer devoluciones' : 'Oculto'}</span>
                </label>
              </Field>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear motivo'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function StockDestinationBadge({
  destination,
  warehouseName,
}: {
  destination: ReturnReason['stockDestination'];
  warehouseName: string;
}) {
  if (destination === 'original') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <ArrowLeftRight className="h-3 w-3" />
        Depósito original
      </span>
    );
  }
  if (destination === 'specific_warehouse') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <WarehouseIcon className="h-3 w-3" />
        {warehouseName}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      <XCircle className="h-3 w-3" />
      Descarte (merma)
    </span>
  );
}

function RadioCard({
  checked,
  onSelect,
  title,
  description,
  accent,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  accent: 'emerald' | 'amber' | 'red';
}) {
  const accents = {
    emerald: 'border-emerald-300 bg-emerald-50',
    amber: 'border-amber-300 bg-amber-50',
    red: 'border-red-300 bg-red-50',
  } as const;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
        checked ? accents[accent] : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className="mt-0.5 text-xs text-slate-600">{description}</div>
      </div>
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </label>
  );
}
