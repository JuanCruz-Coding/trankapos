import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Receipt, ShoppingCart, Boxes, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { TAX_CONDITIONS, type TaxCondition, type Tenant, type TenantSettingsInput } from '@/types';
import { cn } from '@/lib/utils';

type Tab = 'empresa' | 'ticket' | 'pos' | 'stock';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'ticket', label: 'Ticket', icon: Receipt },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'stock', label: 'Stock', icon: Boxes },
];

interface FormState {
  legalName: string;
  taxId: string;
  taxCondition: TaxCondition;
  legalAddress: string;
  phone: string;
  email: string;
  ticketTitle: string;
  ticketFooter: string;
  ticketShowLogo: boolean;
  ticketShowTaxId: boolean;
  ticketWidthMm: 58 | 80;
  posAllowNegativeStock: boolean;
  posMaxDiscountPercent: string;
  posRoundTo: string;
  posRequireCustomer: boolean;
  stockAlertsEnabled: boolean;
}

function tenantToForm(t: Tenant): FormState {
  return {
    legalName: t.legalName,
    taxId: t.taxId,
    taxCondition: t.taxCondition,
    legalAddress: t.legalAddress,
    phone: t.phone,
    email: t.email,
    ticketTitle: t.ticketTitle,
    ticketFooter: t.ticketFooter,
    ticketShowLogo: t.ticketShowLogo,
    ticketShowTaxId: t.ticketShowTaxId,
    ticketWidthMm: t.ticketWidthMm,
    posAllowNegativeStock: t.posAllowNegativeStock,
    posMaxDiscountPercent: String(t.posMaxDiscountPercent),
    posRoundTo: String(t.posRoundTo),
    posRequireCustomer: t.posRequireCustomer,
    stockAlertsEnabled: t.stockAlertsEnabled,
  };
}

export default function Settings() {
  const { refreshSubscription } = useAuth();
  const [tab, setTab] = useState<Tab>('empresa');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await data.getTenant();
        if (!cancelled) setForm(tenantToForm(t));
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const maxPct = Number(form.posMaxDiscountPercent);
    const round = Number(form.posRoundTo);
    if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) {
      return toast.error('Descuento máximo debe estar entre 0 y 100');
    }
    if (!Number.isFinite(round) || round <= 0) {
      return toast.error('Redondeo debe ser mayor a 0');
    }

    setSaving(true);
    try {
      const input: TenantSettingsInput = {
        legalName: form.legalName,
        taxId: form.taxId,
        taxCondition: form.taxCondition,
        legalAddress: form.legalAddress,
        phone: form.phone,
        email: form.email,
        ticketTitle: form.ticketTitle,
        ticketFooter: form.ticketFooter,
        ticketShowLogo: form.ticketShowLogo,
        ticketShowTaxId: form.ticketShowTaxId,
        ticketWidthMm: form.ticketWidthMm,
        posAllowNegativeStock: form.posAllowNegativeStock,
        posMaxDiscountPercent: maxPct,
        posRoundTo: round,
        posRequireCustomer: form.posRequireCustomer,
        stockAlertsEnabled: form.stockAlertsEnabled,
      };
      const updated = await data.updateTenantSettings(input);
      setForm(tenantToForm(updated));
      setDirty(false);
      toast.success('Configuración guardada');
      void refreshSubscription();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return <div className="p-6 text-sm text-slate-500">Cargando configuración…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Configuración"
        subtitle="Ajustes generales del comercio"
        actions={
          <Button onClick={handleSubmit} disabled={saving || !dirty}>
            <Save className="h-4 w-4" />
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardBody className="space-y-4">
            {tab === 'empresa' && <EmpresaTab form={form} update={update} />}
            {tab === 'ticket' && <TicketTab form={form} update={update} />}
            {tab === 'pos' && <PosTab form={form} update={update} />}
            {tab === 'stock' && <StockTab form={form} update={update} />}
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

interface TabProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}

function EmpresaTab({ form, update }: TabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Razón social" hint="Nombre legal que aparece en comprobantes">
        <Input value={form.legalName} onChange={(e) => update('legalName', e.target.value)} />
      </Field>
      <Field label="Condición frente al IVA">
        <select
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={form.taxCondition}
          onChange={(e) => update('taxCondition', e.target.value as TaxCondition)}
        >
          {TAX_CONDITIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="CUIT / CUIL">
        <Input
          value={form.taxId}
          onChange={(e) => update('taxId', e.target.value)}
          placeholder="20-12345678-9"
        />
      </Field>
      <Field label="Teléfono">
        <Input value={form.phone} onChange={(e) => update('phone', e.target.value)} />
      </Field>
      <Field label="Email" className="md:col-span-2">
        <Input
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
        />
      </Field>
      <Field label="Dirección legal" className="md:col-span-2">
        <Input
          value={form.legalAddress}
          onChange={(e) => update('legalAddress', e.target.value)}
        />
      </Field>
    </div>
  );
}

function TicketTab({ form, update }: TabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Título del comprobante">
        <Input
          value={form.ticketTitle}
          onChange={(e) => update('ticketTitle', e.target.value)}
        />
      </Field>
      <Field label="Ancho del papel">
        <select
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={form.ticketWidthMm}
          onChange={(e) => update('ticketWidthMm', Number(e.target.value) === 58 ? 58 : 80)}
        >
          <option value={80}>80 mm (default)</option>
          <option value={58}>58 mm (mini)</option>
        </select>
      </Field>
      <Field label="Texto al pie del ticket" className="md:col-span-2">
        <textarea
          className="min-h-[80px] w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
          value={form.ticketFooter}
          onChange={(e) => update('ticketFooter', e.target.value)}
          maxLength={200}
        />
      </Field>
      <CheckRow
        checked={form.ticketShowLogo}
        onChange={(v) => update('ticketShowLogo', v)}
        label="Mostrar logo en el ticket"
      />
      <CheckRow
        checked={form.ticketShowTaxId}
        onChange={(v) => update('ticketShowTaxId', v)}
        label="Mostrar CUIT en el ticket"
      />
    </div>
  );
}

function PosTab({ form, update }: TabProps) {
  return (
    <div className="space-y-4">
      <CheckRow
        checked={form.posAllowNegativeStock}
        onChange={(v) => update('posAllowNegativeStock', v)}
        label="Permitir vender en negativo (sin stock disponible)"
        hint="Por producto se puede afinar con el toggle 'Permite venta en cero'."
      />
      <CheckRow
        checked={form.posRequireCustomer}
        onChange={(v) => update('posRequireCustomer', v)}
        label="Requerir cliente para registrar la venta"
        hint="Útil para comercios con cuenta corriente. Cuando se active la feature de Clientes."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Descuento máximo (%)"
          hint="Tope global del descuento que un cajero puede aplicar. 100 = sin tope."
        >
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.posMaxDiscountPercent}
            onChange={(e) => update('posMaxDiscountPercent', e.target.value)}
          />
        </Field>
        <Field
          label="Redondeo del total"
          hint="Múltiplo al que se redondea el total. 1 = sin redondeo, 10 = al múltiplo de $10."
        >
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={form.posRoundTo}
            onChange={(e) => update('posRoundTo', e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function StockTab({ form, update }: TabProps) {
  return (
    <div className="space-y-4">
      <CheckRow
        checked={form.stockAlertsEnabled}
        onChange={(v) => update('stockAlertsEnabled', v)}
        label="Alertas de stock mínimo activadas"
        hint="Se aplican a los depósitos con su propio toggle 'Aplicar alertas de stock mínimo'."
      />
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
    </label>
  );
}
