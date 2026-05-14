import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Search, UserCircle2, UserPlus } from 'lucide-react';
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
  type SaleReceiver,
} from '@/types';

type View = 'search' | 'new' | 'inline';

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

export function ReceiverSelectorModal({ open, onClose, onConfirm }: Props) {
  const [view, setView] = useState<View>('search');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setView('search');
      setSearch('');
      setResults([]);
      setForm(emptyForm);
    }
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

  function pickCustomer(c: Customer) {
    onConfirm({
      customerId: c.id,
      docType: c.docType,
      docNumber: c.docNumber,
      legalName: c.legalName,
      ivaCondition: c.ivaCondition,
    });
    onClose();
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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
      pickCustomer(created);
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
      {/* Tabs */}
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
        />
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
}: {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  submitDisabled: boolean;
  docHint: string;
  helpText: string;
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

function labelIva(v: CustomerIvaCondition): string {
  return CUSTOMER_IVA_CONDITIONS.find((c) => c.value === v)?.label ?? v;
}
