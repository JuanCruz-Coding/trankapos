import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BusinessTypeStep } from '@/components/onboarding/BusinessTypeStep';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';
import type { BusinessMode, BusinessSubtype } from '@/types';

type Step = 1 | 2;

export default function Signup() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState({
    tenantName: '',
    branchName: 'Sucursal Principal',
    ownerName: '',
    email: '',
    password: '',
  });
  const [biz, setBiz] = useState<{
    businessMode: BusinessMode;
    businessSubtype: BusinessSubtype | null;
  }>({ businessMode: 'kiosk', businessSubtype: null });
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleStep1Submit(e: FormEvent) {
    e.preventDefault();
    // Validación mínima: el resto la maneja required del input.
    if (form.password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setStep(2);
  }

  async function handleFinalSubmit() {
    setLoading(true);
    try {
      const s = await data.signup({
        ...form,
        businessMode: biz.businessMode,
        businessSubtype: biz.businessSubtype,
      });
      setSession(s);
      toast.success('Cuenta creada. ¡Bienvenido!');
      navigate('/pos');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-4">
      <div className="dots-light absolute inset-0" />
      <div className="halo-cyan pointer-events-none absolute -right-24 -top-24 h-80 w-80" />
      <div className="halo-blue pointer-events-none absolute -bottom-24 -left-24 h-72 w-72" />

      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-xl backdrop-blur-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/brand/isotipo.png" alt="TrankaSoft" className="h-12 w-12" />
          <div className="min-w-0">
            <div className="font-display text-xl font-bold leading-tight text-navy">TrankaPOS</div>
            <div className="marker text-slate-400">Software con calma</div>
          </div>
        </div>

        {/* Indicador de pasos */}
        <div className="mb-5 flex items-center gap-2 text-xs">
          <StepBadge n={1} active={step === 1} done={step > 1} label="Tu cuenta" />
          <div className="h-px flex-1 bg-slate-200" />
          <StepBadge n={2} active={step === 2} done={false} label="Tu negocio" />
        </div>

        {step === 1 && (
          <>
            <div className="eyebrow mb-2 text-cyan">Empezá hoy</div>
            <h1 className="mb-1 font-display text-2xl font-bold text-navy">Creá tu cuenta</h1>
            <p className="mb-6 text-sm text-slate-500">
              14 días de prueba gratis. Sin tarjeta.
            </p>
            <form onSubmit={handleStep1Submit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Nombre del negocio
                </label>
                <Input
                  required
                  placeholder="Kiosko Don José"
                  value={form.tenantName}
                  onChange={(e) => update('tenantName', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Nombre de tu primera sucursal
                </label>
                <Input
                  required
                  value={form.branchName}
                  onChange={(e) => update('branchName', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Tu nombre</label>
                <Input
                  required
                  value={form.ownerName}
                  onChange={(e) => update('ownerName', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Contraseña</label>
                <Input
                  type="password"
                  required
                  minLength={6}
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" className="mt-2 w-full">
                Siguiente
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-center text-xs text-slate-500">
                Al crear la cuenta aceptás nuestros{' '}
                <Link to="/terms" className="text-brand-600 hover:underline">
                  Términos
                </Link>{' '}
                y{' '}
                <Link to="/privacy" className="text-brand-600 hover:underline">
                  Política de privacidad
                </Link>
                .
              </p>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <BusinessTypeStep
              value={biz}
              onChange={setBiz}
              onNext={handleFinalSubmit}
              onBack={() => setStep(1)}
            />
            {loading && (
              <p className="mt-3 text-center text-xs text-slate-500">Creando cuenta…</p>
            )}
          </>
        )}

        <div className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Ingresá
          </Link>
        </div>
      </div>
    </div>
  );
}

function StepBadge({
  n,
  active,
  done,
  label,
}: {
  n: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={
          done
            ? 'flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white'
            : active
              ? 'flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 ring-2 ring-brand-400'
              : 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500'
        }
      >
        {n}
      </span>
      <span
        className={
          active || done
            ? 'text-xs font-medium text-slate-700'
            : 'text-xs font-medium text-slate-400'
        }
      >
        {label}
      </span>
    </div>
  );
}
