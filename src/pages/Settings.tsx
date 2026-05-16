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
  FileText,
  Loader2,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  RotateCcw,
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
import { ProductionToggleModal } from '@/components/afip/ProductionToggleModal';
import { AfipOnboardingWizard } from '@/components/afip/AfipOnboardingWizard';
import { ReturnReasonsEditor } from '@/components/settings/ReturnReasonsEditor';
import { RefundPolicyPanel } from '@/components/settings/RefundPolicyPanel';

type Tab = 'empresa' | 'ticket' | 'pos' | 'stock' | 'pagos' | 'facturacion' | 'devoluciones';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'ticket', label: 'Ticket', icon: Receipt },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'stock', label: 'Stock', icon: Boxes },
  { id: 'pagos', label: 'Pagos', icon: CreditCard },
  { id: 'facturacion', label: 'Facturación', icon: FileText },
  { id: 'devoluciones', label: 'Devoluciones', icon: RotateCcw },
];

interface FormState {
  legalName: string;
  taxId: string;
  taxCondition: TaxCondition;
  legalAddress: string;
  city: string;
  stateProvince: string;
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
  refundPolicy: 'cash_or_credit' | 'credit_only' | 'cash_only';
  storeCreditValidityMonths: number | null;
  logoUrl: string | null;
}

function tenantToForm(t: Tenant): FormState {
  return {
    legalName: t.legalName,
    taxId: t.taxId,
    taxCondition: t.taxCondition,
    legalAddress: t.legalAddress,
    city: t.city,
    stateProvince: t.stateProvince,
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
    refundPolicy: t.refundPolicy,
    storeCreditValidityMonths: t.storeCreditValidityMonths,
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
        city: form.city,
        stateProvince: form.stateProvince,
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
        refundPolicy: form.refundPolicy,
        storeCreditValidityMonths: form.storeCreditValidityMonths,
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
      ) : tab === 'facturacion' ? (
        <Card>
          <CardBody>
            <FacturacionTab />
          </CardBody>
        </Card>
      ) : tab === 'devoluciones' ? (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <RefundPolicyPanel
                refundPolicy={form.refundPolicy}
                storeCreditValidityMonths={form.storeCreditValidityMonths}
                onPolicyChange={(p) => update('refundPolicy', p)}
                onValidityChange={(m) => update('storeCreditValidityMonths', m)}
              />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <ReturnReasonsEditor />
            </CardBody>
          </Card>
        </div>
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
      <Field label="Provincia" hint="Requerida para conectar Mercado Pago">
        <select
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={form.stateProvince}
          onChange={(e) => update('stateProvince', e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {AR_PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ciudad / Localidad" hint="Tal como aparece en el catálogo MP (ej. Palermo, La Plata)">
        <Input
          value={form.city}
          onChange={(e) => update('city', e.target.value)}
        />
      </Field>
      </div>
    </div>
  );
}

// 24 provincias AR oficiales — coincide con catálogo MP para crear sucursal.
const AR_PROVINCES = [
  'Capital Federal',
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;

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

// =====================================================================
// Tab Facturación — integración AFIP (homologación / producción)
// =====================================================================
interface AfipStatus {
  configured: boolean;
  cuit?: string;
  salesPoint?: number;
  environment?: 'homologation' | 'production';
  isActive?: boolean;
  alias?: string | null;
  csrPem?: string | null;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
}

function FacturacionTab() {
  const [status, setStatus] = useState<AfipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Form para subir nuevas credenciales del ambiente ACTUAL.
  // El cambio de ambiente ya no es un campo del form: pasar a producción
  // es un flujo aparte (ProductionToggleModal). Acá `environment` solo
  // refleja el ambiente vigente de las credenciales guardadas, y se manda
  // tal cual al guardar para no cambiarlo silenciosamente.
  const [cuit, setCuit] = useState('');
  const [salesPoint, setSalesPoint] = useState('1');
  const [environment, setEnvironment] = useState<'homologation' | 'production'>('homologation');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [showProductionModal, setShowProductionModal] = useState(false);

  // A6 — wizard de onboarding
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState<1 | 3>(1);
  // Si el wizard arranca en paso 3, le pasamos el CSR que está guardado.
  const [wizardExistingCsr, setWizardExistingCsr] = useState<{
    csrPem: string;
    alias: string;
    environment: 'homologation' | 'production';
  } | undefined>(undefined);

  // "Modo experto" colapsable (BYO: ya tengo .crt y .key)
  const [expertOpen, setExpertOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const sb = getSupabase();
      const { data: row, error } = await sb
        .from('tenant_afip_credentials')
        .select('cuit, sales_point, environment, is_active, alias, csr_pem, last_test_at, last_test_ok, last_test_error')
        .maybeSingle();
      if (error) throw error;
      if (row) {
        setStatus({
          configured: true,
          cuit: row.cuit,
          salesPoint: row.sales_point,
          environment: row.environment,
          isActive: row.is_active,
          alias: row.alias ?? null,
          csrPem: row.csr_pem ?? null,
          lastTestAt: row.last_test_at,
          lastTestOk: row.last_test_ok,
          lastTestError: row.last_test_error,
        });
        setCuit(row.cuit);
        setSalesPoint(String(row.sales_point));
        setEnvironment(row.environment);
      } else {
        setStatus({ configured: false });
      }
    } catch (err) {
      toast.error((err as Error).message);
      setStatus({ configured: false });
    } finally {
      setLoading(false);
    }
  }

  function openWizardFromScratch() {
    setWizardExistingCsr(undefined);
    setWizardInitialStep(1);
    setWizardOpen(true);
  }

  function openWizardResume() {
    if (!status?.csrPem || !status.alias || !status.environment) {
      toast.error('No se encontró el CSR pendiente. Empezá el asistente desde el principio.');
      return;
    }
    setWizardExistingCsr({
      csrPem: status.csrPem,
      alias: status.alias,
      environment: status.environment,
    });
    setWizardInitialStep(3);
    setWizardOpen(true);
  }

  async function readFileAsText(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function handleCertFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await readFileAsText(file);
      if (!text.includes('-----BEGIN CERTIFICATE-----')) {
        toast.error('El archivo no parece un certificado PEM.');
        return;
      }
      setCertPem(text);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleKeyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await readFileAsText(file);
      if (!text.includes('PRIVATE KEY')) {
        toast.error('El archivo no parece una clave privada PEM.');
        return;
      }
      setKeyPem(text);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSave() {
    if (!/^[0-9]{11}$/.test(cuit)) {
      toast.error('CUIT inválido. Deben ser 11 dígitos sin guiones.');
      return;
    }
    const sp = Number(salesPoint);
    if (!Number.isInteger(sp) || sp <= 0) {
      toast.error('Punto de venta inválido.');
      return;
    }
    if (!certPem || !keyPem) {
      toast.error('Subí el certificado y la clave privada.');
      return;
    }

    setSaving(true);
    try {
      const sb = getSupabase();
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('No autenticado');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-set-credentials`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({
          cuit,
          salesPoint: sp,
          environment,
          certPem,
          keyPem,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);
      toast.success('Credenciales AFIP guardadas');
      // Limpiamos los inputs sensibles para no dejarlos en memoria del browser
      setCertPem('');
      setKeyPem('');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const sb = getSupabase();
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('No autenticado');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-test-connection`;
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
      if (body.ok) {
        toast.success(`Conexión AFIP OK (token vence ${new Date(body.tokenExpiresAt).toLocaleString('es-AR')})`);
      } else {
        toast.error(`AFIP rechazó: ${body.error}`);
      }
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Cargando estado AFIP…</div>;
  }

  // Estado derivado A6
  const noConfig = !status?.configured;
  // awaitingCert: hay row pero todavía no está activo y hay CSR generado.
  const awaitingCert =
    Boolean(status?.configured) &&
    status?.isActive === false &&
    Boolean(status?.csrPem);
  const active = Boolean(status?.configured) && status?.isActive === true;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-bold text-navy">AFIP — Factura Electrónica</h3>
              {active ? (
                status?.lastTestOk === true ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Conexión OK
                  </span>
                ) : status?.lastTestOk === false ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    <XCircle className="h-3 w-3" />
                    Conexión falló
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    Sin probar
                  </span>
                )
              ) : awaitingCert ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  Falta certificado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  <XCircle className="h-3 w-3" />
                  Sin configurar
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Conectá tu CUIT y certificado AFIP para emitir comprobantes fiscales (Factura A/B/C,
              Notas de Crédito/Débito) directo desde el POS.
            </p>

            {active && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <div><strong>CUIT:</strong> {status?.cuit ?? '—'}</div>
                <div><strong>Punto de venta:</strong> {status?.salesPoint ?? '—'}</div>
                {status?.lastTestAt && (
                  <div>
                    <strong>Último test:</strong>{' '}
                    {new Date(status.lastTestAt).toLocaleString('es-AR')}
                    {status.lastTestOk === false && status.lastTestError && (
                      <div className="mt-1 break-words text-red-700">
                        {status.lastTestError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
           Estado 1: SIN CONFIGURAR — wizard recomendado + modo experto
         ============================================================ */}
      {noConfig && (
        <>
          <div className="rounded-lg border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-display text-base font-bold text-navy">
                  Configurá AFIP con el asistente
                </h4>
                <p className="mt-1 text-sm text-slate-600">
                  Te guiamos paso a paso. Nosotros generamos el certificado, vos solo lo pegás en AFIP.
                  No hace falta OpenSSL ni nada técnico.
                </p>
                <div className="mt-3">
                  <Button onClick={openWizardFromScratch}>
                    <Sparkles className="h-4 w-4" />
                    Empezar asistente
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Modo experto colapsable */}
          <ExpertSection
            open={expertOpen}
            onToggle={() => setExpertOpen((v) => !v)}
            title="Modo experto: ya tengo mi .crt y .key"
            subtitle="Si generaste el certificado vos mismo con OpenSSL, podés subirlo acá."
          >
            <ManualUploadForm
              cuit={cuit}
              setCuit={setCuit}
              salesPoint={salesPoint}
              setSalesPoint={setSalesPoint}
              environment={environment}
              setEnvironment={setEnvironment}
              certPem={certPem}
              keyPem={keyPem}
              onCertFile={handleCertFile}
              onKeyFile={handleKeyFile}
              onSave={handleSave}
              saving={saving}
              configured={false}
              onTest={handleTest}
              testing={testing}
              showEnvironmentSelector
            />
          </ExpertSection>
        </>
      )}

      {/* ============================================================
           Estado 2: AWAITING CERT — key+CSR generados, falta el .crt
         ============================================================ */}
      {awaitingCert && (
        <>
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-display text-base font-bold text-amber-900">
                  Falta subir el certificado firmado por AFIP
                </h4>
                <p className="mt-1 text-sm text-amber-800">
                  Ya generamos tu clave y tu solicitud (CSR). Solo falta que pegues el CSR en AFIP,
                  descargues el <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">.crt</code>{' '}
                  y lo subas acá.
                </p>
                <div className="mt-3 grid gap-1 rounded-lg bg-white/60 p-3 text-xs text-amber-900">
                  {status?.alias && (
                    <div><strong>Alias:</strong> {status.alias}</div>
                  )}
                  {status?.environment && (
                    <div><strong>Ambiente:</strong> {ENV_LABEL_ES[status.environment]}</div>
                  )}
                  {status?.cuit && (
                    <div><strong>CUIT:</strong> {status.cuit}</div>
                  )}
                </div>
                <div className="mt-3">
                  <Button onClick={openWizardResume}>
                    Continuar onboarding
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <ExpertSection
            open={expertOpen}
            onToggle={() => setExpertOpen((v) => !v)}
            title="Modo experto: subir .crt + .key manualmente"
            subtitle="Si ya tenés ambos archivos generados por fuera, podés sobrescribir lo del asistente."
          >
            <ManualUploadForm
              cuit={cuit}
              setCuit={setCuit}
              salesPoint={salesPoint}
              setSalesPoint={setSalesPoint}
              environment={environment}
              setEnvironment={setEnvironment}
              certPem={certPem}
              keyPem={keyPem}
              onCertFile={handleCertFile}
              onKeyFile={handleKeyFile}
              onSave={handleSave}
              saving={saving}
              configured={false}
              onTest={handleTest}
              testing={testing}
              showEnvironmentSelector={false}
            />
          </ExpertSection>
        </>
      )}

      {/* ============================================================
           Estado 3: ACTIVO — bloque original (badge homo/prod + datos + test)
         ============================================================ */}
      {active && status?.environment && (
        <>
          {/* Ambiente actual — estado destacado + flujo de paso a producción */}
          <div
            className={cn(
              'rounded-lg border p-4',
              status.environment === 'production'
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                {status.environment === 'production' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div>
                  <div
                    className={cn(
                      'text-sm font-bold',
                      status.environment === 'production'
                        ? 'text-emerald-800'
                        : 'text-amber-800',
                    )}
                  >
                    {status.environment === 'production'
                      ? 'Modo PRODUCCIÓN — comprobantes con validez fiscal'
                      : 'Modo HOMOLOGACIÓN — los comprobantes son de prueba'}
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 text-xs',
                      status.environment === 'production'
                        ? 'text-emerald-700'
                        : 'text-amber-700',
                    )}
                  >
                    {status.environment === 'production'
                      ? 'Ya estás emitiendo comprobantes reales ante AFIP.'
                      : 'Cuando tengas el certificado de producción de AFIP, pasá a producción para emitir comprobantes con validez fiscal.'}
                  </p>
                </div>
              </div>
              {status.environment === 'homologation' && (
                <Button onClick={() => setShowProductionModal(true)}>
                  Pasar a producción
                </Button>
              )}
            </div>
          </div>

          {/* Form de actualización de credenciales (modo experto sobre activo) */}
          <div className="rounded-lg border border-slate-200 p-4">
            <h4 className="mb-3 font-display text-sm font-bold text-navy">
              Actualizar credenciales
            </h4>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="CUIT" hint="11 dígitos sin guiones (ej. 20123456789)">
                <Input value={cuit} onChange={(e) => setCuit(e.target.value.replace(/\D/g, ''))} maxLength={11} />
              </Field>
              <Field label="Punto de venta" hint="El que diste de alta en AFIP">
                <Input
                  type="number"
                  min="1"
                  value={salesPoint}
                  onChange={(e) => setSalesPoint(e.target.value)}
                />
              </Field>
              <Field label="Certificado (.crt / .pem)" hint="Archivo PEM generado en AFIP">
                <div className="space-y-1">
                  <input
                    type="file"
                    accept=".crt,.pem,.cer,application/x-x509-ca-cert,application/x-pem-file"
                    onChange={handleCertFile}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />
                  {certPem && (
                    <div className="text-xs text-emerald-700">
                      ✓ Certificado cargado ({certPem.length} bytes)
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Clave privada (.key)" hint="Archivo PEM de tu clave privada">
                <div className="space-y-1">
                  <input
                    type="file"
                    accept=".key,.pem"
                    onChange={handleKeyFile}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />
                  {keyPem && (
                    <div className="text-xs text-emerald-700">
                      ✓ Clave cargada ({keyPem.length} bytes)
                    </div>
                  )}
                </div>
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving || !certPem || !keyPem}>
                <Save className="h-4 w-4" />
                {saving ? 'Guardando…' : 'Guardar credenciales'}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {testing ? 'Probando…' : 'Probar conexión'}
              </Button>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              🔒 El certificado y la clave se guardan <strong>encriptados</strong> en nuestra base.
              La clave de cifrado vive solo en el servidor, no en la base. Solo el owner puede
              configurar AFIP.
            </p>
          </div>

          {/* Regenerar certificado (con el wizard) */}
          <ExpertSection
            open={expertOpen}
            onToggle={() => setExpertOpen((v) => !v)}
            title="Regenerar certificado con el asistente"
            subtitle="Esto reemplaza tu certificado actual. Vas a tener que volver a pasar por AFIP."
          >
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-900">
                  Esto va a generar una nueva clave y un nuevo CSR. Mientras no subas el .crt nuevo,
                  vas a quedar en estado "Falta certificado" y no vas a poder facturar.
                </p>
              </div>
              <Button variant="outline" onClick={openWizardFromScratch}>
                <Sparkles className="h-4 w-4" />
                Iniciar regeneración
              </Button>
            </div>
          </ExpertSection>
        </>
      )}

      <ProductionToggleModal
        open={showProductionModal}
        onClose={() => setShowProductionModal(false)}
        onConfirmed={() => {
          void refresh();
        }}
      />

      <AfipOnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialStep={wizardInitialStep}
        existingCsr={wizardExistingCsr}
        onCompleted={() => {
          void refresh();
        }}
      />
    </div>
  );
}

const ENV_LABEL_ES: Record<'homologation' | 'production', string> = {
  homologation: 'Homologación',
  production: 'Producción',
};

// =====================================================================
// Sección colapsable (modo experto / regenerar)
// =====================================================================
function ExpertSection({
  open,
  onToggle,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-start gap-3">
          <ChevronRight
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform',
              open && 'rotate-90',
            )}
          />
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <div className="text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>
      </button>
      {open && <div className="border-t border-slate-200 p-4">{children}</div>}
    </div>
  );
}

// =====================================================================
// Form BYO de subida manual (modo experto)
// =====================================================================
function ManualUploadForm({
  cuit,
  setCuit,
  salesPoint,
  setSalesPoint,
  environment,
  setEnvironment,
  certPem,
  keyPem,
  onCertFile,
  onKeyFile,
  onSave,
  saving,
  configured,
  onTest,
  testing,
  showEnvironmentSelector,
}: {
  cuit: string;
  setCuit: (v: string) => void;
  salesPoint: string;
  setSalesPoint: (v: string) => void;
  environment: 'homologation' | 'production';
  setEnvironment: (v: 'homologation' | 'production') => void;
  certPem: string;
  keyPem: string;
  onCertFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  saving: boolean;
  configured: boolean;
  onTest: () => void;
  testing: boolean;
  showEnvironmentSelector: boolean;
}) {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="CUIT" hint="11 dígitos sin guiones (ej. 20123456789)">
          <Input value={cuit} onChange={(e) => setCuit(e.target.value.replace(/\D/g, ''))} maxLength={11} />
        </Field>
        <Field label="Punto de venta" hint="El que diste de alta en AFIP">
          <Input
            type="number"
            min="1"
            value={salesPoint}
            onChange={(e) => setSalesPoint(e.target.value)}
          />
        </Field>
        {showEnvironmentSelector && (
          <Field label="Ambiente" className="md:col-span-2" hint="Empezá por Homologación para probar sin riesgo">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm',
                environment === 'homologation' ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50',
              )}>
                <input
                  type="radio"
                  name="byoEnv"
                  checked={environment === 'homologation'}
                  onChange={() => setEnvironment('homologation')}
                />
                Homologación
              </label>
              <label className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm',
                environment === 'production' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50',
              )}>
                <input
                  type="radio"
                  name="byoEnv"
                  checked={environment === 'production'}
                  onChange={() => setEnvironment('production')}
                />
                Producción
              </label>
            </div>
          </Field>
        )}
        <Field label="Certificado (.crt / .pem)" hint="Archivo PEM generado por AFIP">
          <div className="space-y-1">
            <input
              type="file"
              accept=".crt,.pem,.cer,application/x-x509-ca-cert,application/x-pem-file"
              onChange={onCertFile}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {certPem && (
              <div className="text-xs text-emerald-700">
                ✓ Certificado cargado ({certPem.length} bytes)
              </div>
            )}
          </div>
        </Field>
        <Field label="Clave privada (.key)" hint="Archivo PEM de tu clave privada">
          <div className="space-y-1">
            <input
              type="file"
              accept=".key,.pem"
              onChange={onKeyFile}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {keyPem && (
              <div className="text-xs text-emerald-700">
                ✓ Clave cargada ({keyPem.length} bytes)
              </div>
            )}
          </div>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={saving || !certPem || !keyPem}>
          <Save className="h-4 w-4" />
          {saving ? 'Guardando…' : 'Guardar credenciales'}
        </Button>
        {configured && (
          <Button variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {testing ? 'Probando…' : 'Probar conexión'}
          </Button>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        🔒 El certificado y la clave se guardan <strong>encriptados</strong> en nuestra base.
      </p>
    </div>
  );
}
