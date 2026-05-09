import { useEffect, useState } from 'react';
import { differenceInDays } from 'date-fns';
import { Crown, Check, X, Sparkles, ArrowRight, AlertTriangle } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';
import { formatARS } from '@/lib/currency';
import type { Plan, PlanUsage, Subscription, SubscriptionStatus } from '@/types';

const STATUS_LABEL: Record<
  SubscriptionStatus,
  { text: string; color: string; dot?: string }
> = {
  trialing: { text: 'En prueba', color: 'bg-ice text-navy', dot: 'status-dot--blue' },
  active: { text: 'Activa', color: 'bg-emerald-50 text-emerald-700', dot: 'status-dot--green' },
  past_due: {
    text: 'Pago vencido',
    color: 'bg-accent/10 text-accent-dark',
    dot: 'status-dot--orange',
  },
  canceled: { text: 'Cancelada', color: 'bg-red-50 text-red-700' },
};

const FEATURE_LABELS: Record<string, string> = {
  scanner_camera: 'Scanner por cámara (mobile)',
  csv_import: 'Importar CSV de productos',
  csv_export: 'Exportar CSV (ventas/stock)',
  advanced_reports: 'Reportes avanzados',
  transfers: 'Transferencias entre depósitos',
  customers: 'Clientes / cuenta corriente',
  multi_cash: 'Múltiples cajas simultáneas',
  variants: 'Variantes (talle/color) y combos',
  purchases: 'Compras a proveedores',
  audit_log: 'Auditoría / log de cambios',
  granular_perms: 'Permisos granulares por rol',
  api: 'Acceso a API',
  webhooks: 'Webhooks',
  custom_branding: 'Branding propio en ticket',
  central_warehouse: 'Depósito central',
};

export default function Plan() {
  const { session } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [changeModal, setChangeModal] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [payerEmail, setPayerEmail] = useState(session?.email ?? '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, u, p] = await Promise.all([
          data.getSubscription(),
          data.getUsage(),
          data.listPlans(),
        ]);
        if (!cancelled) {
          setSub(s);
          setUsage(u);
          setPlans(p);
        }
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubscribe(planCode: string) {
    if (!payerEmail || !payerEmail.includes('@')) {
      toast.error('Ingresá un email válido de tu cuenta de Mercado Pago');
      return;
    }
    const ok = await confirmDialog('Cambio de plan', {
      text: 'Te vamos a redirigir a Mercado Pago para autorizar el cobro mensual con tu tarjeta.',
      confirmText: 'Continuar',
      icon: 'question',
    });
    if (!ok) return;
    setSubmitting(planCode);
    try {
      const backUrl = `${window.location.origin}/plan/return`;
      const { initPoint } = await data.subscribeToPlan(planCode, backUrl, payerEmail);
      if (!initPoint) {
        throw new Error('Mercado Pago no devolvió la URL de pago. Probá de nuevo.');
      }
      toast.info('Redirigiendo a Mercado Pago…');
      // Redirige al user a la URL de MP — ahí ingresa la tarjeta y autoriza.
      window.location.href = initPoint;
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(null);
    }
  }

  async function handleCancel() {
    const ok = await confirmDialog('¿Cancelar tu suscripción?', {
      text: 'Vas a perder acceso a las features del plan al final del período actual.',
      confirmText: 'Sí, cancelar',
      cancelText: 'No',
      danger: true,
    });
    if (!ok) return;
    try {
      await data.cancelSubscription();
      // Si había un pending_plan_id residual (ej. intento de upgrade que
      // nunca se completó), limpiarlo: el tenant ya no quiere upgrade.
      await data.clearPendingPlan().catch(() => {});
      toast.success('Suscripción cancelada');
      const s = await data.getSubscription();
      setSub(s);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }
  if (!sub || !usage) {
    return <div className="p-6 text-sm text-slate-500">No se pudo cargar la suscripción.</div>;
  }

  const status = STATUS_LABEL[sub.status];
  const trialDays =
    sub.status === 'trialing' && sub.trialEndsAt
      ? Math.max(0, differenceInDays(new Date(sub.trialEndsAt), new Date()))
      : null;

  return (
    <div>
      <PageHeader
        title="Mi plan"
        subtitle="Información de tu suscripción y uso actual"
      />

      {sub.status === 'past_due' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1 text-sm text-red-900">
            <strong className="block text-base">Pago vencido</strong>
            <p className="mt-1">
              No pudimos cobrar tu última cuota. Para mantener tu plan activo, actualizá la
              tarjeta o el medio de pago en tu cuenta de Mercado Pago.
            </p>
            <a
              href="https://www.mercadopago.com.ar/subscriptions"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-semibold text-red-700 underline hover:text-red-800"
            >
              Actualizar medio de pago en MP
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Plan {sub.plan.name}</CardTitle>
                <div className="text-sm text-slate-500">
                  {sub.plan.priceMonthly > 0
                    ? `${formatARS(sub.plan.priceMonthly)} / mes`
                    : 'Gratis'}
                </div>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                status.color,
              )}
            >
              {status.dot && <span className={cn('status-dot', status.dot)} />}
              {status.text}
            </span>
          </CardHeader>
          <CardBody className="space-y-3">
            {trialDays !== null && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <strong>
                    {trialDays === 0
                      ? 'Tu prueba termina hoy'
                      : `${trialDays} día(s) de prueba restantes`}
                  </strong>
                </div>
                <div className="mt-1 text-xs text-sky-700">
                  Cuando termine la prueba, vas a cambiar al plan Básico salvo que actives otro.
                </div>
              </div>
            )}

            <UsageBar label="Sucursales" used={usage.branches} max={sub.plan.maxBranches} />
            <UsageBar label="Depósitos" used={usage.warehouses} max={null} />
            <UsageBar label="Usuarios" used={usage.users} max={sub.plan.maxUsers} />
            <UsageBar label="Productos" used={usage.products} max={sub.plan.maxProducts} />

            <div className="flex gap-2 pt-2">
              <Button onClick={() => setChangeModal(true)}>Cambiar de plan</Button>
              {sub.plan.code !== 'free' && sub.status !== 'canceled' && (
                <Button variant="outline" onClick={handleCancel}>
                  Cancelar suscripción
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funciones incluidas</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                const enabled = !!sub.plan.features[key];
                return (
                  <li key={key} className="flex items-center gap-2">
                    {enabled ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="h-4 w-4 text-slate-300" />
                    )}
                    <span className={enabled ? 'text-slate-900' : 'text-slate-400'}>{label}</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={changeModal}
        onClose={() => setChangeModal(false)}
        title="Cambiar de plan"
        widthClass="max-w-3xl"
      >
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Email de tu cuenta de Mercado Pago
          </label>
          <Input
            type="email"
            value={payerEmail}
            onChange={(e) => setPayerEmail(e.target.value)}
            placeholder="kiosco@ejemplo.com"
          />
          <p className="mt-1 text-xs text-slate-500">
            Acá vas a recibir las notificaciones de cobro. En sandbox, usá el email
            del usuario comprador de prueba.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {plans
            .filter((p) => p.code !== 'free')
            .map((p) => {
              const isCurrent = p.code === sub.plan.code;
              return (
                <PlanCard
                  key={p.id}
                  plan={p}
                  isCurrent={isCurrent}
                  loading={submitting === p.code}
                  disabled={submitting !== null && submitting !== p.code}
                  onSubscribe={() => handleSubscribe(p.code)}
                />
              );
            })}
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <strong>¿Qué pasa al cambiar?</strong> Te vamos a redirigir a Mercado Pago para que
          autorices el cobro mensual. Cuando autorices, tu plan se actualiza automáticamente.
          Estás en <strong>modo de prueba</strong>, así que el cobro es simulado y no se mueve
          plata real.
        </div>
      </Modal>
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  loading,
  disabled,
  onSubscribe,
}: {
  plan: Plan;
  isCurrent: boolean;
  loading: boolean;
  disabled: boolean;
  onSubscribe: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        isCurrent ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white',
      )}
    >
      <div>
        <div className="text-xs uppercase text-slate-500">Plan</div>
        <div className="text-lg font-bold text-slate-900">{plan.name}</div>
        <div className="text-xl font-semibold text-brand-700">
          {formatARS(plan.priceMonthly)}
          <span className="ml-1 text-xs font-normal text-slate-500">/ mes</span>
        </div>
      </div>

      <ul className="space-y-1 text-sm text-slate-600">
        <li>
          <strong>{plan.maxBranches ?? 'Ilimitadas'}</strong> sucursal(es)
        </li>
        <li>
          <strong>{plan.maxWarehousesPerBranch ?? 'Ilimitados'}</strong> depósito(s) por sucursal
        </li>
        <li>
          <strong>{plan.maxUsers ?? 'Ilimitados'}</strong> usuario(s)
        </li>
        <li>
          <strong>{plan.maxProducts ?? 'Ilimitados'}</strong> producto(s)
        </li>
        {plan.features.scanner_camera && <li>Scanner por cámara</li>}
        {plan.features.transfers && <li>Transferencias entre depósitos</li>}
        {plan.features.advanced_reports && <li>Reportes avanzados</li>}
        {plan.features.customers && <li>Clientes / cuenta corriente</li>}
        {plan.features.variants && <li>Variantes y combos</li>}
        {plan.features.purchases && <li>Compras a proveedores</li>}
        {plan.features.api && <li>API + webhooks</li>}
        {plan.features.central_warehouse && <li>Depósito central</li>}
      </ul>

      <div className="mt-auto pt-2">
        {isCurrent ? (
          <div className="rounded-md bg-brand-100 py-2 text-center text-xs font-medium text-brand-700">
            Tu plan actual
          </div>
        ) : (
          <Button onClick={onSubscribe} disabled={disabled || loading} className="w-full">
            {loading ? 'Redirigiendo…' : (
              <>
                Suscribirme <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number | null;
}) {
  const isUnlimited = max === null;
  const pct = isUnlimited ? 0 : Math.min((used / max) * 100, 100);
  const overLimit = !isUnlimited && used >= max;
  const nearLimit = !isUnlimited && pct >= 80;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className={cn('text-slate-500', overLimit && 'font-semibold text-red-600')}>
          {used} / {isUnlimited ? '∞' : max}
        </span>
      </div>
      {isUnlimited ? (
        <div className="text-xs text-slate-400">Sin límite</div>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              overLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-500' : 'bg-emerald-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
