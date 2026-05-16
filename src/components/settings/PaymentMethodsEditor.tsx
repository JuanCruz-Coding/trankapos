import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';
import { PAYMENT_METHODS, type PaymentMethod, type PaymentMethodConfig } from '@/types';

interface FormState {
  id?: string;
  code: string;
  label: string;
  paymentMethodBase: PaymentMethod;
  cardBrand: string;
  installments: string;
  surchargePct: string;
  sortOrder: string;
  active: boolean;
}

const emptyForm: FormState = {
  code: '',
  label: '',
  paymentMethodBase: 'credit',
  cardBrand: '',
  installments: '',
  surchargePct: '0',
  sortOrder: '0',
  active: true,
};

const BRAND_SUGGESTIONS = ['visa', 'master', 'amex', 'naranja', 'cabal'];

/** slug helper — coincide con la convención de ReturnReasonsEditor. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

const BASE_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((p) => [p.value, p.label]),
) as Record<PaymentMethod, string>;

/**
 * CRUD de medios de pago configurables (Sprint PMP).
 *
 * Permite definir variantes específicas (ej. "Visa 3 cuotas") por encima
 * de los métodos base del enum (cash/debit/credit/qr/transfer/on_account)
 * y asociarles un recargo % que se aplica al cobrar en el POS.
 */
export function PaymentMethodsEditor() {
  const [methods, setMethods] = useState<PaymentMethodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await data.listPaymentMethods({ activeOnly: false });
      setMethods(list);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setForm(emptyForm);
    setCodeManuallyEdited(false);
    setModalOpen(true);
  }

  function openEdit(m: PaymentMethodConfig) {
    setForm({
      id: m.id,
      code: m.code,
      label: m.label,
      paymentMethodBase: m.paymentMethodBase,
      cardBrand: m.cardBrand ?? '',
      installments: m.installments == null ? '' : String(m.installments),
      surchargePct: String(m.surchargePct),
      sortOrder: String(m.sortOrder),
      active: m.active,
    });
    setCodeManuallyEdited(true);
    setModalOpen(true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleLabelChange(value: string) {
    setForm((f) => {
      const next = { ...f, label: value };
      if (!codeManuallyEdited) {
        next.code = slugify(value);
      }
      return next;
    });
  }

  function handleCodeChange(value: string) {
    setCodeManuallyEdited(true);
    const cleaned = value
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '');
    update('code', cleaned);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return toast.error('El label es obligatorio.');
    if (!form.code.trim()) return toast.error('El code es obligatorio.');

    const surchargePct = Number(form.surchargePct);
    if (!Number.isFinite(surchargePct)) {
      return toast.error('El recargo % debe ser numérico (puede ser negativo).');
    }
    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder)) return toast.error('Sort order debe ser numérico.');

    let installments: number | null = null;
    if (form.installments.trim() !== '') {
      const n = Number(form.installments);
      if (!Number.isInteger(n) || n <= 0) {
        return toast.error('Cuotas debe ser un entero positivo.');
      }
      installments = n;
    }

    setSaving(true);
    try {
      const input = {
        code: form.code.trim(),
        label: form.label.trim(),
        paymentMethodBase: form.paymentMethodBase,
        cardBrand: form.cardBrand.trim() === '' ? null : form.cardBrand.trim().toLowerCase(),
        installments,
        surchargePct,
        sortOrder,
        active: form.active,
      };
      if (form.id) {
        await data.updatePaymentMethod(form.id, input);
        toast.success('Medio de pago actualizado');
      } else {
        await data.createPaymentMethod(input);
        toast.success('Medio de pago creado');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(m: PaymentMethodConfig) {
    const ok = await confirmDialog(`¿Desactivar "${m.label}"?`, {
      text: 'Ya no aparecerá al cobrar en el POS. Las ventas pasadas no se afectan.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivatePaymentMethod(m.id);
      toast.success('Medio de pago desactivado');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Medios de pago que el cajero puede elegir al cobrar. Podés definir variantes con
          recargo, ej. <strong>"Visa 3 cuotas +8%"</strong>. El recargo se suma al total del
          ticket automáticamente.
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nuevo medio
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Cargando medios de pago…</div>
      ) : methods.length === 0 ? (
        <Empty
          title="Todavía no hay medios configurados"
          description="Definí variantes con recargo (ej. 'Visa 3 cuotas +8%'). Si no creás ninguno, el POS sigue mostrando los métodos base sin recargo."
          action={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Crear primer medio
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Base</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Cuotas</th>
                <th className="px-3 py-2 text-right">Recargo %</th>
                <th className="px-3 py-2">Orden</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {methods.map((m) => (
                <tr key={m.id} className={cn('hover:bg-slate-50', !m.active && 'opacity-60')}>
                  <td className="px-3 py-2 font-medium text-navy">
                    <div>{m.label}</div>
                    <div className="font-mono text-[10px] text-slate-500">{m.code}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{BASE_LABEL[m.paymentMethodBase]}</td>
                  <td className="px-3 py-2 capitalize text-slate-600">{m.cardBrand ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{m.installments ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <SurchargeBadge pct={m.surchargePct} />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{m.sortOrder}</td>
                  <td className="px-3 py-2">
                    {m.active ? (
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
                      onClick={() => openEdit(m)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-navy"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {m.active && (
                      <button
                        onClick={() => handleDeactivate(m)}
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
        title={form.id ? 'Editar medio de pago' : 'Nuevo medio de pago'}
        widthClass="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field
            label="Label"
            hint="Lo que ve el cajero en el select. Ej. 'Visa 3 cuotas'."
          >
            <Input
              value={form.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              autoFocus
              placeholder="Ej. Visa 3 cuotas"
            />
          </Field>
          <Field
            label="Code"
            hint="Identificador interno (lowercase, sin espacios). Se autogenera del label."
          >
            <Input
              value={form.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="visa_3_cuotas"
              maxLength={48}
            />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Método base" hint="A qué método del POS pertenece.">
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.paymentMethodBase}
                onChange={(e) =>
                  update('paymentMethodBase', e.target.value as PaymentMethod)
                }
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recargo %" hint="Puede ser negativo (descuento por pago en efectivo).">
              <Input
                type="number"
                step="0.01"
                value={form.surchargePct}
                onChange={(e) => update('surchargePct', e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Field
                label="Marca (opcional)"
                hint="Ej. visa, master, amex. Solo aplica para débito/crédito."
              >
                <Input
                  value={form.cardBrand}
                  onChange={(e) => update('cardBrand', e.target.value)}
                  placeholder="visa"
                  maxLength={32}
                />
              </Field>
              <div className="mt-1 flex flex-wrap gap-1">
                {BRAND_SUGGESTIONS.map((b) => (
                  <button
                    type="button"
                    key={b}
                    onClick={() => update('cardBrand', b)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-medium transition',
                      form.cardBrand === b
                        ? 'border-brand-400 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Cuotas (opcional)" hint="Ej. 3, 6, 12. Vacío = 1 pago.">
              <Input
                type="number"
                min="1"
                step="1"
                value={form.installments}
                onChange={(e) => update('installments', e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Orden" hint="Cuanto menor, primero en el select del POS.">
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
                  <span>{form.active ? 'Visible al cobrar' : 'Oculto'}</span>
                </label>
              </Field>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear medio'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SurchargeBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-slate-400">0%</span>;
  const positive = pct > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        positive ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700',
      )}
    >
      {positive ? '+' : ''}
      {pct}%
    </span>
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
