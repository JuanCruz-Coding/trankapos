import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { CustomerCreditPanel } from '@/components/customers/CustomerCreditPanel';
import { CustomerSalesPanel } from '@/components/customers/CustomerSalesPanel';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { formatCuit, validateDocument } from '@/lib/cuitValidator';
import { formatARS } from '@/lib/currency';
import {
  CUSTOMER_DOC_TYPES,
  CUSTOMER_IVA_CONDITIONS,
  type Customer,
  type CustomerDocType,
  type CustomerIvaCondition,
  type CustomerRequiredFields,
  type Tenant,
} from '@/types';

interface FormState {
  id?: string;
  docType: CustomerDocType;
  docNumber: string;
  legalName: string;
  ivaCondition: CustomerIvaCondition;
  email: string;
  notes: string;
  // Sprint CRM-RETAIL: campos extendidos.
  phone: string;
  address: string;
  city: string;
  stateProvince: string;
  birthdate: string;
  marketingOptIn: boolean;
}

const emptyForm: FormState = {
  docType: 80,
  docNumber: '',
  legalName: '',
  ivaCondition: 'consumidor_final',
  email: '',
  notes: '',
  phone: '',
  address: '',
  city: '',
  stateProvince: '',
  birthdate: '',
  marketingOptIn: false,
};

/** Defaults conservadores si el tenant todavía no setteó los required_fields. */
const DEFAULT_REQUIRED: CustomerRequiredFields = {
  docNumber: true,
  ivaCondition: true,
  phone: false,
  email: false,
  address: false,
  birthdate: false,
};

/** Etiquetas para los mensajes de error de required_fields. */
const REQUIRED_LABELS: Record<keyof CustomerRequiredFields, string> = {
  docNumber: 'Número de documento',
  ivaCondition: 'Condición frente al IVA',
  phone: 'Teléfono',
  email: 'Email',
  address: 'Domicilio',
  birthdate: 'Fecha de nacimiento',
};

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [padronLoading, setPadronLoading] = useState(false);
  // Saldo a favor por cliente (Sprint DEV). Indexado por customerId.
  // Se carga en batch para los primeros 50 clientes para no abusar del backend.
  const [creditByCustomer, setCreditByCustomer] = useState<Record<string, number>>({});

  // Required fields del tenant. Lo cargamos junto con el tenant. Si no llegó
  // todavía o no está configurado, usamos los defaults conservadores.
  const requiredFields = tenant?.customerRequiredFields ?? DEFAULT_REQUIRED;
  const businessMode = tenant?.businessMode ?? 'kiosk';

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [list, t] = await Promise.all([
        data.listCustomers({ activeOnly: true }),
        data.getTenant().catch(() => null),
      ]);
      setCustomers(list);
      setTenant(t);
      // Carga los saldos en paralelo para los primeros 50 visibles.
      // Si un cliente no tiene fila en customer_credits, getCustomerCredit
      // devuelve null (balance=0 efectivo).
      const sample = list.slice(0, 50);
      const credits = await Promise.all(
        sample.map(async (c) => {
          try {
            const cr = await data.getCustomerCredit(c.id);
            return [c.id, cr?.balance ?? 0] as const;
          } catch {
            return [c.id, 0] as const;
          }
        }),
      );
      const map: Record<string, number> = {};
      for (const [id, balance] of credits) {
        if (balance !== 0) map[id] = balance;
      }
      setCreditByCustomer(map);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.legalName.toLowerCase().includes(q) ||
        c.docNumber.includes(q.replace(/\D/g, '')),
    );
  }, [customers, search]);

  function openNew() {
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(c: Customer) {
    setForm({
      id: c.id,
      docType: c.docType,
      docNumber: c.docNumber,
      legalName: c.legalName,
      ivaCondition: c.ivaCondition,
      email: c.email ?? '',
      notes: c.notes ?? '',
      phone: c.phone ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
      stateProvince: c.stateProvince ?? '',
      birthdate: c.birthdate ?? '',
      marketingOptIn: c.marketingOptIn ?? false,
    });
    setModalOpen(true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Solo aplica a CUIT (80) con 11 dígitos exactos. El padrón AFIP (ws_sr_padron_a5)
  // indexa por CUIT — CUIL (86) y DNI (96) no se consultan.
  const canConsultPadron = form.docType === 80 && /^[0-9]{11}$/.test(form.docNumber);

  async function handleConsultPadron() {
    if (!canConsultPadron) return;
    setPadronLoading(true);
    try {
      const result = await data.consultAfipPadron({ cuit: form.docNumber });
      if (!result.ok || !result.persona) {
        toast.error(result.error ?? 'No se pudo consultar el padrón AFIP.');
        return;
      }
      const { persona } = result;
      setForm((f) => {
        const next: FormState = {
          ...f,
          legalName: persona.legalName,
          ivaCondition: persona.ivaCondition,
        };
        // Sumamos el domicilio fiscal a notas SOLO si el campo está vacío,
        // para no pisar texto que el comercio haya cargado a mano.
        if (persona.address && !f.notes.trim()) {
          next.notes = `Domicilio fiscal AFIP: ${persona.address}`;
        }
        // Si el form de domicilio está vacío y el padrón trae uno, lo cargamos
        // para que el comercio no tenga que copiarlo a mano.
        if (persona.address && !f.address.trim()) {
          next.address = persona.address;
        }
        return next;
      });
      toast.success('Datos cargados desde AFIP');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPadronLoading(false);
    }
  }

  /**
   * Valida los required_fields del tenant contra el form actual.
   * Devuelve un mensaje de error (en español) si algún required está vacío.
   */
  function validateRequiredFields(): string | null {
    const missing: string[] = [];
    if (requiredFields.docNumber && !form.docNumber.trim()) {
      missing.push(REQUIRED_LABELS.docNumber);
    }
    if (requiredFields.ivaCondition && !form.ivaCondition) {
      missing.push(REQUIRED_LABELS.ivaCondition);
    }
    if (requiredFields.phone && !form.phone.trim()) {
      missing.push(REQUIRED_LABELS.phone);
    }
    if (requiredFields.email && !form.email.trim()) {
      missing.push(REQUIRED_LABELS.email);
    }
    if (requiredFields.address && !form.address.trim()) {
      missing.push(REQUIRED_LABELS.address);
    }
    if (requiredFields.birthdate && !form.birthdate.trim()) {
      missing.push(REQUIRED_LABELS.birthdate);
    }
    if (missing.length === 0) return null;
    if (missing.length === 1) {
      return `El campo ${missing[0]} es obligatorio según la configuración del comercio.`;
    }
    return `Faltan campos obligatorios: ${missing.join(', ')}.`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const docErr = validateDocument(form.docType, form.docNumber);
    if (docErr) return toast.error(docErr);
    if (!form.legalName.trim()) return toast.error('Razón social / nombre es obligatorio.');

    const reqErr = validateRequiredFields();
    if (reqErr) return toast.error(reqErr);

    setSaving(true);
    try {
      const payload = {
        docType: form.docType,
        docNumber: form.docNumber,
        legalName: form.legalName.trim(),
        ivaCondition: form.ivaCondition,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        stateProvince: form.stateProvince.trim() || null,
        birthdate: form.birthdate.trim() || null,
        marketingOptIn: form.marketingOptIn,
      };
      if (form.id) {
        await data.updateCustomer(form.id, payload);
        toast.success('Cliente actualizado');
      } else {
        await data.createCustomer(payload);
        toast.success('Cliente creado');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: Customer) {
    const ok = await confirmDialog(`¿Desactivar cliente "${c.legalName}"?`, {
      text: 'No vas a poder usarlo en nuevas facturas. Las facturas anteriores no se afectan.',
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.deactivateCustomer(c.id);
      toast.success('Cliente desactivado');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const ivaLabel = (v: CustomerIvaCondition) =>
    CUSTOMER_IVA_CONDITIONS.find((c) => c.value === v)?.label ?? v;
  const docTypeLabel = (v: CustomerDocType) =>
    CUSTOMER_DOC_TYPES.find((d) => d.value === v)?.label ?? String(v);

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Datos de receptores para Factura A/B. Los clientes esporádicos podés cargarlos directo al cobrar."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Button>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o CUIT/DNI…"
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : filtered.length === 0 ? (
        <Empty
          title={search ? 'Sin resultados' : 'Todavía no hay clientes'}
          description={
            search
              ? 'Probá con otro nombre o documento.'
              : 'Cargá tus clientes recurrentes para emitir Factura A con un click. Los clientes esporádicos podés cargarlos directo al cobrar en el POS.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nombre / Razón social</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Condición IVA</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Saldo</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => {
                const balance = creditByCustomer[c.id] ?? 0;
                return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-navy">{c.legalName}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {docTypeLabel(c.docType)} {c.docType === 80 || c.docType === 86 ? formatCuit(c.docNumber) : c.docNumber}
                  </td>
                  <td className="px-3 py-2">{ivaLabel(c.ivaCondition)}</td>
                  <td className="px-3 py-2 text-slate-600">{c.email ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {balance > 0 ? (
                      <span className="font-semibold text-emerald-700">{formatARS(balance)}</span>
                    ) : balance < 0 ? (
                      <span className="font-semibold text-red-700">{formatARS(balance)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openEdit(c)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-navy"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      className="ml-1 rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700"
                      title="Desactivar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Editar cliente' : 'Nuevo cliente'}
        widthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Panel de historial de compras: solo en edit (necesita customerId). */}
          {form.id && (
            <CustomerSalesPanel customerId={form.id} businessMode={businessMode} />
          )}
          {form.id && <CustomerCreditPanel customerId={form.id} />}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de documento">
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={form.docType}
                onChange={(e) => update('docType', Number(e.target.value) as CustomerDocType)}
              >
                {CUSTOMER_DOC_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Número"
              hint={form.docType === 80 || form.docType === 86 ? '11 dígitos' : '7-8 dígitos'}
              required={requiredFields.docNumber}
            >
              <Input
                value={form.docNumber}
                onChange={(e) => update('docNumber', e.target.value.replace(/\D/g, ''))}
                maxLength={11}
              />
            </Field>
          </div>
          {form.docType === 80 && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleConsultPadron}
                disabled={!canConsultPadron || padronLoading}
                title={
                  canConsultPadron
                    ? 'Autocompletar razón social y condición IVA desde el padrón AFIP'
                    : 'Cargá un CUIT de 11 dígitos para consultar el padrón'
                }
              >
                <Building2 className="h-4 w-4" />
                {padronLoading ? 'Consultando…' : 'Buscar en AFIP'}
              </Button>
            </div>
          )}
          <Field label="Razón social / Nombre" required>
            <Input
              value={form.legalName}
              onChange={(e) => update('legalName', e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Condición frente al IVA" required={requiredFields.ivaCondition}>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              value={form.ivaCondition}
              onChange={(e) => update('ivaCondition', e.target.value as CustomerIvaCondition)}
            >
              {CUSTOMER_IVA_CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Email" required={requiredFields.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </Field>
            <Field label="Teléfono" required={requiredFields.phone}>
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="Ej: +54 11 1234-5678"
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Domicilio" required={requiredFields.address}>
              <Input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder="Calle y número"
              />
            </Field>
            <Field label="Fecha de nacimiento" required={requiredFields.birthdate}>
              <Input
                type="date"
                value={form.birthdate}
                onChange={(e) => update('birthdate', e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ciudad">
              <Input
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
              />
            </Field>
            <Field label="Provincia">
              <Input
                value={form.stateProvince}
                onChange={(e) => update('stateProvince', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notas (opcional)">
            <Input
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </Field>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={form.marketingOptIn}
              onChange={(e) => update('marketingOptIn', e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <strong>Acepta recibir comunicaciones de marketing</strong>
              <span className="block text-xs text-slate-500">
                Tildalo solo si el cliente te dio consentimiento explícito (Ley 25.326).
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  /** Si true, muestra asterisco rojo al lado del label (campo obligatorio). */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-label="obligatorio">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </label>
  );
}
