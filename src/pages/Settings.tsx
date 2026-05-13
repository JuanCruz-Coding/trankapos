import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2,
  Receipt,
  ShoppingCart,
  Boxes,
  Save,
  Upload,
  Trash2,
  ImageOff,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { data } from '@/data';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { TAX_CONDITIONS, type TaxCondition, type Tenant, type TenantSettingsInput } from '@/types';
import { cn } from '@/lib/utils';
import { LOGO_REQUIREMENTS_TEXT, validateLogoFile } from '@/lib/imageUpload';

type Tab = 'empresa' | 'ticket' | 'pos' | 'stock' | 'pagos';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'ticket', label: 'Ticket', icon: Receipt },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'stock', label: 'Stock', icon: Boxes },
  { id: 'pagos', label: 'Pagos', icon: CreditCard },
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
  posPartialReservesStock: boolean;
  skuAutoEnabled: boolean;
  skuPrefix: string;
  stockAlertsEnabled: boolean;
  logoUrl: string | null;
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
    posPartialReservesStock: t.posPartialReservesStock,
    skuAutoEnabled: t.skuAutoEnabled,
    skuPrefix: t.skuPrefix,
    stockAlertsEnabled: t.stockAlertsEnabled,
    logoUrl: t.logoUrl,
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

    if (!/^[A-Za-z0-9_-]+$/.test(form.skuPrefix) || form.skuPrefix.length === 0) {
      return toast.error('Prefijo SKU: solo letras, números, - o _');
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
        posPartialReservesStock: form.posPartialReservesStock,
        skuAutoEnabled: form.skuAutoEnabled,
        skuPrefix: form.skuPrefix,
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

      {tab === 'pagos' ? (
        <Card>
          <CardBody>
            <PagosTab />
          </CardBody>
        </Card>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardBody className="space-y-4">
              {tab === 'empresa' && (
                <EmpresaTab
                  form={form}
                  update={update}
                  onLogoChange={(url) => setForm((f) => (f ? { ...f, logoUrl: url } : f))}
                />
              )}
              {tab === 'ticket' && <TicketTab form={form} update={update} />}
              {tab === 'pos' && <PosTab form={form} update={update} />}
              {tab === 'stock' && <StockTab form={form} update={update} />}
            </CardBody>
          </Card>
        </form>
      )}
    </div>
  );
}

// =====================================================================
// Tab Pagos — integración Mercado Pago Connect
// =====================================================================
interface MpIntegrationStatus {
  connected: boolean;
  mpUserId?: string;
  liveMode?: boolean;
  connectedAt?: string;
  expiresAt?: string;
  // posReady=false significa que los tokens están guardados pero la caja MP
  // (store + pos) no se creó — el cobro con QR va a fallar hasta reconectar.
  posReady?: boolean;
}

function PagosTab() {
  const [status, setStatus] = useState<MpIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const sb = getSupabase();
      // Solo seleccionamos columnas no sensibles. Los tokens viven en la
      // misma tabla pero NO se piden — la edge function los usa con
      // service_role.
      const { data: row, error } = await sb
        .from('tenant_payment_integrations')
        .select('mp_user_id, mp_pos_id, live_mode, connected_at, expires_at, provider')
        .eq('provider', 'mp')
        .maybeSingle();
      if (error) throw error;
      if (row) {
        setStatus({
          connected: true,
          mpUserId: row.mp_user_id ?? undefined,
          liveMode: row.live_mode,
          connectedAt: row.connected_at,
          expiresAt: row.expires_at ?? undefined,
          posReady: Boolean(row.mp_pos_id),
        });
      } else {
        setStatus({ connected: false });
      }
    } catch (err) {
      toast.error((err as Error).message);
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  function handleConnect() {
    const clientId = import.meta.env.VITE_MP_OAUTH_CLIENT_ID;
    const redirectUri =
      import.meta.env.VITE_MP_OAUTH_REDIRECT_URI ??
      `${window.location.origin}/settings/integrations/mp/callback`;
    if (!clientId) {
      toast.error('Falta VITE_MP_OAUTH_CLIENT_ID en el frontend.');
      return;
    }
    // CSRF protection: guardamos un state random y lo verificamos al volver.
    const state = crypto.randomUUID();
    sessionStorage.setItem('mp_oauth_state', state);
    const url = new URL('https://auth.mercadopago.com.ar/authorization');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    window.location.href = url.toString();
  }

  async function handleDisconnect() {
    const ok = await confirmDialog('¿Desconectar Mercado Pago?', {
      text: 'Vas a dejar de poder cobrar con QR. Las ventas pasadas no se afectan.',
      confirmText: 'Desconectar',
      danger: true,
    });
    if (!ok) return;

    setWorking(true);
    try {
      const sb = getSupabase();
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('No autenticado');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-disconnect`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);
      toast.success('Mercado Pago desconectado');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Cargando estado de integraciones…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-bold text-navy">Mercado Pago</h3>
              {status?.connected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Conectado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  <XCircle className="h-3 w-3" />
                  Sin conectar
                </span>
              )}
              {status?.connected && status.liveMode === false && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Modo prueba
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Conectá tu cuenta de Mercado Pago para cobrar con QR a tus clientes.
              Las suscripciones a TrankaPos se siguen cobrando aparte; esto es para los
              cobros que vos le hacés a quien te compra.
            </p>

            {status?.connected && status.posReady === false && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Caja MP no sincronizada.</strong> Los tokens están guardados pero
                no se creó la caja en tu cuenta de Mercado Pago, así que el cobro con QR
                va a fallar. Reconectá para reintentar la creación.
              </div>
            )}

            {status?.connected && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <div>
                  <strong>Cuenta MP:</strong> {status.mpUserId ?? '—'}
                </div>
                {status.connectedAt && (
                  <div>
                    <strong>Conectado el:</strong>{' '}
                    {new Date(status.connectedAt).toLocaleString('es-AR')}
                  </div>
                )}
                {status.expiresAt && (
                  <div>
                    <strong>Token vence:</strong>{' '}
                    {new Date(status.expiresAt).toLocaleString('es-AR')} (se refresca solo)
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {!status?.connected ? (
                <Button onClick={handleConnect}>
                  <ExternalLink className="h-4 w-4" />
                  Conectar Mercado Pago
                </Button>
              ) : (
                <>
                  {status.posReady === false && (
                    <Button onClick={handleConnect}>
                      <ExternalLink className="h-4 w-4" />
                      Reconectar Mercado Pago
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleDisconnect} disabled={working}>
                    <XCircle className="h-4 w-4" />
                    {working ? 'Desconectando…' : 'Desconectar'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Próximamente vas a poder elegir <strong>QR / MP</strong> al cobrar y el
        sistema generará un QR dinámico que tu cliente escanea con su app.
      </p>
    </div>
  );
}

interface TabProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}

function EmpresaTab({
  form,
  update,
  onLogoChange,
}: TabProps & { onLogoChange: (url: string | null) => void }) {
  return (
    <div className="space-y-4">
      <LogoUploader logoUrl={form.logoUrl} onChange={onLogoChange} />
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
    </div>
  );
}

function LogoUploader({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const validation = await validateLogoFile(file);
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }

    setUploading(true);
    try {
      const url = await data.uploadTenantLogo(file);
      onChange(url);
      toast.success('Logo actualizado');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    const ok = await confirmDialog('¿Eliminar el logo del comercio?', {
      text: 'Vas a volver a usar el logo por default en los tickets.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    setUploading(true);
    try {
      await data.removeTenantLogo();
      onChange(null);
      toast.success('Logo eliminado');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 text-xs font-medium text-slate-700">Logo del comercio</div>
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-full w-full rounded-lg object-contain p-1"
            />
          ) : (
            <ImageOff className="h-8 w-8 text-slate-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs text-slate-500">{LOGO_REQUIREMENTS_TEXT}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="h-4 w-4" />
              {logoUrl ? 'Cambiar' : 'Subir logo'}
            </Button>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                disabled={uploading}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar
              </Button>
            )}
            {uploading && <span className="self-center text-xs text-slate-500">Procesando…</span>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </div>
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
      <CheckRow
        checked={form.posPartialReservesStock}
        onChange={(v) => update('posPartialReservesStock', v)}
        label="Las señas reservan stock (no se descuenta hasta cobrar el saldo)"
        hint="Si está apagado, al cobrar una seña el stock se descuenta al instante (modelo 'el cliente se lleva el producto'). Si está encendido, el stock queda apartado y se descuenta cuando se completa el pago."
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

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">SKU automático</div>
        <CheckRow
          checked={form.skuAutoEnabled}
          onChange={(v) => update('skuAutoEnabled', v)}
          label="Generar SKU automático para productos sin código de barras"
          hint="Cuando creás un producto a granel o servicio (sin EAN), el sistema le asigna un código interno {prefijo}-{NNNNN}. Lo podés editar manualmente."
        />
        <div className="mt-3 max-w-xs">
          <Field label="Prefijo del SKU" hint="Default 200 (rango GS1 reservado para uso interno).">
            <Input
              value={form.skuPrefix}
              onChange={(e) => update('skuPrefix', e.target.value.toUpperCase())}
              maxLength={10}
            />
          </Field>
        </div>
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
