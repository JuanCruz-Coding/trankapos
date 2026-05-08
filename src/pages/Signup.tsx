import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';

export default function Signup() {
  const [form, setForm] = useState({
    tenantName: '',
    depotName: 'Sucursal Principal',
    ownerName: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await data.signup(form);
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
        <div className="eyebrow mb-2 text-cyan">Empezá hoy</div>
        <h1 className="mb-1 font-display text-2xl font-bold text-navy">Creá tu cuenta</h1>
        <p className="mb-6 text-sm text-slate-500">
          14 días de prueba gratis. Sin tarjeta.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
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
              Nombre del primer depósito
            </label>
            <Input
              required
              value={form.depotName}
              onChange={(e) => update('depotName', e.target.value)}
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
          <Button type="submit" size="lg" className="mt-2 w-full" disabled={loading}>
            {loading ? 'Creando…' : 'Crear cuenta'}
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
