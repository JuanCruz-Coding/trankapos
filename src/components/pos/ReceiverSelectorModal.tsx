import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Building2, Plus, Search, UserCircle2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatCuit, validateDocument } from '@/lib/cuitValidator';
import {
  CUSTOMER_DOC_TYPES,
  CUSTOMER_IVA_CONDITIONS,
  type Customer,
  type CustomerDocType,
  type CustomerIvaCondition,
  type CustomerRequiredFields,
  type SaleReceiver,
} from '@/types';

type View = 'search' | 'new' | 'inline' | 'complete';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Llamado al confirmar un receptor (sea de la tabla o inline). */
  onConfirm: (receiver: SaleReceiver) => void;
}

interface FormState {
  docType: CustomerDocType;
  docNumber: string;
  legalName: string;
  ivaCondition: CustomerIvaCondition;
  email: string;
}

const emptyForm: FormState = {
  docType: 80,
  docNumber: '',
  legalName: '',
  ivaCondition: 'consumidor_final',
  email: '',
};

/** Defaults conservadores si el tenant no setteó required_fields. */
const DEFAULT_REQUIRED: CustomerRequiredFields = {
  docNumber: true,
  ivaCondition: true,
  phone: false,
  email: false,
  address: false,
  birthdate: false,
};

/** Solo subset relevante al ReceiverSelector. Excluye doc/iva (que siempre se piden en el form fiscal). */
type ExtraRequiredField = 'phone' | 'email' | 'address' | 'birthdate';

const EXTRA_REQUIRED_LABELS: Record<ExtraRequiredField, string> = {
  phone: 'Teléfono',
  email: 'Email',
  address: 'Domicilio',
  birthdate: 'Fecha de nacimiento',
};

/** Estado del mini-form "completar datos faltantes". */
interface CompleteFormState {
  phone: string;
  email: string;
  address: string;
  birthdate: string;
}

/**
 * Detecta qué campos requeridos del tenant le faltan al customer.
 * Solo evalúa los campos extra (phone/email/address/birthdate) — docNumber e
 * ivaCondition siempre vienen poblados desde la tabla customers (no pueden
 * estar vacíos por constraint).
 */
function detectMissingFields(
  c: Customer,
  required: CustomerRequiredFields,
): ExtraRequiredField[] {
  const missing: ExtraRequiredField[] = [];
  if (required.phone && !c.phone?.trim()) missing.push('phone');
  if (required.email && !c.email?.trim()) missing.push('email');
  if (required.address && !c.address?.trim()) missing.push('address');
  if (required.birthdate && !c.birthdate?.trim()) missing.push('birthdate');
  return missing;
}

export function ReceiverSelectorModal({ open, onClose, onConfirm }: Props) {
  const [view, setView] = useState<View>('search');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [padronLoading, setPadronLoading] = useState(false);

  // Required fields del tenant — se cargan al abrir el modal.
  const [requiredFields, setRequiredFields] =
    useState<CustomerRequiredFields>(DEFAULT_REQUIRED);

  // Estado del flow "completar datos faltantes" (cuando se elige un customer
  // existente al que le faltan campos requeridos por el tenant).
  const [pendingCustomer, setPendingCustomer] = useState<Customer | null>(null);
  const [missing, setMissing] = useState<ExtraRequiredField[]>([]);
  const [completeForm, setCompleteForm] = useState<CompleteFormState>({
    phone: '',
    email: '',
    address: '',
    birthdate: '',
  });
  const [completing, setCompleting] = useState(false);

  // Reset al abrir + cargar requiredFields del tenant.
  useEffect(() => {
    if (!open) return;
    setView('search');
    setSearch('');
    setResults([]);
    setForm(emptyForm);
    setPendingCustomer(null);
    setMissing([]);
    setCompleteForm({ phone: '', email: '', address: '', birthdate: '' });
    (async () => {
      try {
        const t = await data.getTenant();
        setRequiredFields(t.customerRequiredFields ?? DEFAULT_REQUIRED);
      } catch {
        // Si falla el getTenant, seguimos con defaults conservadores.
        setRequiredFields(DEFAULT_REQUIRED);
      }
    })();
  }, [open]);

  // Debounce search
  useEffect(() => {
    if (view !== 'search' || !open) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const list = search.trim()
          ? await data.searchCustomers(search.trim())
          : await data.listCustomers({ activeOnly: true });
        setResults(list);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, view, open]);

  function confirmReceiverFromCustomer(c: Customer) {
    onConfirm({
      customerId: c.id,
      docType: c.docType,
      docNumber: c.docNumber,
      legalName: c.legalName,
      ivaCondition: c.ivaCondition,
    });
    onClose();
  }

  /**
   * Al pickear un customer existente, validamos required_fields del tenant.
   * Si le faltan datos → abrimos el mini-form para completarlos in-line, lo
   * persistimos con updateCustomer y recién después aceptamos el receiver.
   * Si está completo → comportamiento original.
   */
  function pickCustomer(c: Customer) {
    const miss = detectMissingFields(c, requiredFields);
    if (miss.length === 0) {
      confirmReceiverFromCustomer(c);
      return;
    }
    // Pre-cargamos el mini-form con los datos actuales del customer (que pueden
    // ser null/'' — el cajero los completa).
    setPendingCustomer(c);
    setMissing(miss);
    setCompleteForm({
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      birthdate: c.birthdate ?? '',
    });
    setView('complete');
  }

  function updateCompleteField<K extends keyof CompleteFormState>(
    key: K,
    value: CompleteFormState[K],
  ) {
    setCompleteForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCompleteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingCustomer) return;
    // Validar que efectivamente se completaron los que faltaban.
    const stillMissing = missing.filter((field) => {
      const v = completeForm[field];
      return !v || !v.toString().trim();
    });
    if (stillMissing.length > 0) {
      toast.error(
        `Falta completar: ${stillMissing.map((f) => EXTRA_REQUIRED_LABELS[f]).join(', ')}.`,
      );
      return;
    }

    setCompleting(true);
    try {
      // Mandamos updateCustomer solo con los campos que se completaron, para
      // no pisar datos no editados.
      const patch: {
        phone?: string;
        email?: string;
        address?: string;
        birthdate?: string;
      } = {};
      for (const field of missing) {
        patch[field] = completeForm[field].trim();
      }
      const updated = await data.updateCustomer(pendingCustomer.id, patch);
      toast.success('Datos del cliente actualizados');
      confirmReceiverFromCustomer(updated);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Solo aplica a CUIT (80) con 11 dígitos exactos.
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
      setForm((f) => ({
        ...f,
        legalName: persona.legalName,
        ivaCondition: persona.ivaCondition,
      }));
      toast.success('Datos cargados desde AFIP');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPadronLoading(false);
    }
  }

  function validateForm(): string | null {
    const docErr = validateDocument(form.docType, form.docNumber);
    if (docErr) return docErr;
    if (!form.legalName.trim()) return 'Nombre o razón social es obligatorio.';
    return null;
  }

  async function handleSaveNew(e: FormEvent) {
    e.preventDefault();
    const err = validateForm();
    if (err) return toast.error(err);
    setSaving(true);
    try {
      const created = await data.createCustomer({
        docType: form.docType,
        docNumber: form.docNumber,
        legalName: form.legalName.trim(),
        ivaCondition: form.ivaCondition,
        email: form.email.trim() || null,
      });
      toast.success('Cliente creado');
      // Importante: el customer recién creado puede no tener todos los
      // required_fields (acá solo pedimos doc/legalName/iva/email). Sin
      // embargo, no le exigimos completarlos en este flow: el cajero podrá
      // completarlos después desde Customers. Si quiere bloquear, debería
      // configurar el ReceiverSelector con los campos extra (TODO).
      confirmReceiverFromCustomer(created);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleUseInline(e: FormEvent) {
    e.preventDefault();
    const err = validateForm();
    if (err) return toast.error(err);
    onConfirm({
      customerId: null, // inline = no guardamos en customers
      docType: form.docType,
      docNumber: form.docNumber,
      legalName: form.legalName.trim(),
      ivaCondition: form.ivaCondition,
    });
    onClose();
  }

  const docHint = useMemo(() => {
    if (form.docType === 96) return '7-8 dígitos';
    return '11 dígitos (con dígito verificador)';
  }, [form.docType]);

  return (
    <Modal open={open} onClose={onClose} title="Identificar cliente" widthClass="max-w-lg">
      {/* Tabs — ocultas en el flow de completar datos para evitar perder el contexto. */}
      {view !== 'complete' && (
        <div className="mb-3 flex gap-1 border-b border-slate-200">
          <TabButton active={view === 'search'} onClick={() => setView('search')}>
            <Search className="h-4 w-4" /> Buscar
          </TabButton>
          <TabButton active={view === 'new'} onClick={() => setView('new')}>
            <UserPlus className="h-4 w-4" /> Cargar nuevo
          </TabButton>
          <TabButton active={view === 'inline'} onClick={() => setView('inline')}>
            <UserCircle2 className="h-4 w-4" /> Solo esta venta
          </TabButton>
        </div>
      )}

      {view === 'search' && (
        <div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o CUIT/DNI…"
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            {searching ? (
              <div className="p-4 text-center text-sm text-slate-500">Buscando…</div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">
                {search.trim()
                  ? 'Sin resultados. Probá con otro término o usá "Cargar nuevo".'
                  : 'Todavía no hay clientes. Usá "Cargar nuevo" o "Solo esta venta".'}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => pickCustomer(c)}
                      className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <div className="font-medium text-navy">{c.legalName}</div>
                      <div className="text-xs text-slate-500">
                        {c.docType === 80 || c.docType === 86
                          ? formatCuit(c.docNumber)
                          : c.docNumber}{' '}
                        · {labelIva(c.ivaCondition)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="outline" onClick={() => setView('new')}>
              <Plus className="h-4 w-4" />
              Cargar nuevo cliente
            </Button>
          </div>
        </div>
      )}

      {view === 'new' && (
        <ReceiverForm
          form={form}
          onChange={updateForm}
          onSubmit={handleSaveNew}
          submitLabel={saving ? 'Guardando…' : 'Guardar y usar'}
          submitDisabled={saving}
          docHint={docHint}
          helpText="Se guarda en tu lista de clientes. Vas a poder reusarlo en otras ventas."
          onConsultPadron={handleConsultPadron}
          canConsultPadron={canConsultPadron}
          padronLoading={padronLoading}
        />
      )}

      {view === 'inline' && (
        <ReceiverForm
          form={form}
          onChange={updateForm}
          onSubmit={handleUseInline}
          submitLabel="Usar para esta venta"
          submitDisabled={false}
          docHint={docHint}
          helpText="No se guarda en tu lista de clientes. Solo queda en la factura."
          onConsultPadron={handleConsultPadron}
          canConsultPadron={canConsultPadron}
          padronLoading={padronLoading}
        />
      )}

      {view === 'complete' && pendingCustomer && (
        <form onSubmit={handleCompleteSubmit} className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 text-amber-900">
              <div className="font-medium">Faltan datos del cliente</div>
              <div className="text-xs">
                Según la configuración del comercio,{' '}
                <strong>{pendingCustomer.legalName}</strong> necesita completar:{' '}
                <strong>
                  {missing.map((f) => EXTRA_REQUIRED_LABELS[f]).join(', ')}
                </strong>
                . Completalos para seguir.
              </div>
            </div>
          </div>

          {missing.includes('phone') && (
            <Field label="Teléfono" required>
              <Input
                type="tel"
                value={completeForm.phone}
                onChange={(e) => updateCompleteField('phone', e.target.value)}
                placeholder="Ej: +54 11 1234-5678"
                autoFocus
              />
            </Field>
          )}
          {missing.includes('email') && (
            <Field label="Email" required>
              <Input
                type="email"
                value={completeForm.email}
                onChange={(e) => updateCompleteField('email', e.target.value)}
                autoFocus={!missing.includes('phone')}
              />
            </Field>
          )}
          {missing.includes('address') && (
            <Field label="Domicilio" required>
              <Input
                value={completeForm.address}
                onChange={(e) => updateCompleteField('address', e.target.value)}
                placeholder="Calle y número"
              />
            </Field>
          )}
          {missing.includes('birthdate') && (
            <Field label="Fecha de nacimiento" required>
              <Input
                type="date"
                value={completeForm.birthdate}
                onChange={(e) => updateCompleteField('birthdate', e.target.value)}
              />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingCustomer(null);
                setMissing([]);
                setView('search');
              }}
            >
              Volver a buscar
            </Button>
            <Button type="submit" disabled={completing}>
              {completing ? 'Guardando…' : 'Guardar y usar cliente'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ' +
        (active
          ? 'border-brand-600 text-navy'
          : 'border-transparent text-slate-500 hover:text-slate-700')
      }
    >
      {children}
    </button>
  );
}

function ReceiverForm({
  form,
  onChange,
  onSubmit,
  submitLabel,
  submitDisabled,
  docHint,
  helpText,
  onConsultPadron,
  canConsultPadron,
  padronLoading,
}: {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  submitDisabled: boolean;
  docHint: string;
  helpText: string;
  onConsultPadron: () => void;
  canConsultPadron: boolean;
  padronLoading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo de documento">
          <select
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            value={form.docType}
            onChange={(e) => onChange('docType', Number(e.target.value) as CustomerDocType)}
          >
            {CUSTOMER_DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Número" hint={docHint}>
          <Input
            value={form.docNumber}
            onChange={(e) => onChange('docNumber', e.target.value.replace(/\D/g, ''))}
            maxLength={11}
            autoFocus
          />
        </Field>
      </div>
      {form.docType === 80 && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onConsultPadron}
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
      <Field label="Razón social / Nombre">
        <Input
          value={form.legalName}
          onChange={(e) => onChange('legalName', e.target.value)}
        />
      </Field>
      <Field label="Condición frente al IVA">
        <select
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={form.ivaCondition}
          onChange={(e) => onChange('ivaCondition', e.target.value as CustomerIvaCondition)}
        >
          {CUSTOMER_IVA_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-[11px] text-slate-500">{helpText}</p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" disabled={submitDisabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
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

function labelIva(v: CustomerIvaCondition): string {
  return CUSTOMER_IVA_CONDITIONS.find((c) => c.value === v)?.label ?? v;
}
