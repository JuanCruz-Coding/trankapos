import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { useAfipAutoRetry } from '@/hooks/useAfipAutoRetry';
import { toast } from '@/stores/toast';
import type { AfipContingencySummary } from '@/data/driver';

/**
 * Barra global que avisa si hay comprobantes AFIP en estado 'rejected'.
 * Monta el auto-retry silencioso al abrir la app y se refresca cuando termina.
 * Si no hay sesión o no hay rejected, no renderiza nada.
 */
export function AfipStatusBanner(): JSX.Element | null {
  const { session } = useAuth();
  const [summary, setSummary] = useState<AfipContingencySummary | null>(null);
  const [retrying, setRetrying] = useState(false);

  const refetchSummary = useCallback(async () => {
    try {
      const s = await data.getAfipContingencySummary();
      setSummary(s);
    } catch {
      // Silencioso: si falla, no mostramos banner.
      setSummary(null);
    }
  }, []);

  // Auto-retry al montar; cuando termina, refrescamos el summary.
  useAfipAutoRetry({ onDone: refetchSummary });

  useEffect(() => {
    if (!session) return;
    void refetchSummary();
  }, [session, refetchSummary]);

  const handleRetryNow = useCallback(async () => {
    setRetrying(true);
    let okCount = 0;
    let failCount = 0;
    try {
      const rejected = await data.listAfipDocuments({ status: 'rejected', limit: 20 });
      // Secuencial: un fallo no frena los demás.
      for (const doc of rejected) {
        try {
          const res = await data.retryAfipDocument({ documentId: doc.id });
          if (res.ok) okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }
      toast.success(`${okCount} reintentado(s), ${failCount} sigue(n) fallando`);
    } catch {
      toast.error('No se pudo reintentar los comprobantes');
    } finally {
      await refetchSummary();
      setRetrying(false);
    }
  }, [refetchSummary]);

  if (!session) return null;
  if (!summary || summary.rejectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="font-medium">
        Tenés {summary.rejectedCount} comprobante{summary.rejectedCount === 1 ? '' : 's'} sin emitir
        en AFIP.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleRetryNow}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Reintentando…' : 'Reintentar ahora'}
        </button>
        <Link
          to="/comprobantes"
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-800 underline-offset-2 transition hover:bg-amber-100 hover:underline"
        >
          Ver comprobantes
        </Link>
      </div>
    </div>
  );
}
