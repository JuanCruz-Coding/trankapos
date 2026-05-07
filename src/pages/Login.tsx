import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/toast';

const DEMO_EMAIL = 'demo@trankapos.local';
const DEMO_PASSWORD = 'demo1234';

export default function Login() {
  const [email, setEmail] = useState(import.meta.env.DEV ? DEMO_EMAIL : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? DEMO_PASSWORD : '');
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await data.login({ email, password });
      setSession(s);
      navigate('/pos');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-brand-600 p-3 text-white">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">TrankaPOS</div>
            <div className="text-xs text-slate-500">Punto de venta para kioskos</div>
          </div>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Ingresá a tu cuenta</h1>
        <p className="mb-4 text-sm text-slate-500">
          Probá la app sin registrarte usando la cuenta demo.
        </p>
        <button
          type="button"
          onClick={fillDemo}
          className="mb-6 w-full rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-sm text-brand-700 transition hover:border-brand-500 hover:bg-brand-100"
        >
          Usar cuenta demo
        </button>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Contraseña</label>
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="mt-2 w-full" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
        <div className="mt-6 text-center text-sm text-slate-500">
          ¿No tenés cuenta?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline">
            Creá una ahora
          </Link>
        </div>
      </div>
    </div>
  );
}
