import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { toast } from '@/stores/toast';

/**
 * Página que recibe el ?code= de Mercado Pago tras autorizar.
 * Llama a la edge function mp-oauth-callback y redirige a /settings.
 */
export default function MpCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode dispara useEffect 2x en dev
    ranRef.current = true;

    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      setStatus('error');
      setErrorMsg(`Mercado Pago devolvió: ${error}`);
      return;
    }
    if (!code) {
      setStatus('error');
      setErrorMsg('No llegó el código de autorización.');
      return;
    }

    (async () => {
      try {
        const sb = getSupabase();
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('No autenticado. Volvé a loguearte.');

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-oauth-callback`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify({ code }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);

        setStatus('success');
        toast.success('Mercado Pago conectado');
        setTimeout(() => navigate('/settings', { replace: true }), 1500);
      } catch (err) {
        setStatus('error');
        setErrorMsg((err as Error).message);
      }
    })();
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {status === 'processing' && (
          <>
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-brand-600" />
            <h1 className="font-display text-lg font-bold text-navy">
              Conectando con Mercado Pago…
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Estamos guardando los tokens. No cierres esta pestaña.
            </p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
            <h1 className="font-display text-lg font-bold text-navy">¡Listo!</h1>
            <p className="mt-1 text-sm text-slate-500">Te llevamos a la configuración…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
            <h1 className="font-display text-lg font-bold text-navy">No pudimos conectar</h1>
            <p className="mt-2 text-sm text-slate-600">{errorMsg}</p>
            <button
              onClick={() => navigate('/settings', { replace: true })}
              className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Volver a configuración
            </button>
          </>
        )}
      </div>
    </div>
  );
}
