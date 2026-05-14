import { useEffect, useRef } from 'react';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';

/** Antes de reintentar algo, esperamos al menos 10 min desde el último intento. */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Al montar (una vez por sesión de app), reintenta silenciosamente los
 * comprobantes AFIP que quedaron 'rejected'. No muestra toast — el banner
 * de estado ya comunica el resultado. Cuando termina, llama a `onDone`
 * para que el banner refresque su summary.
 */
export function useAfipAutoRetry(opts: { onDone?: () => void }): void {
  const { session } = useAuth();
  const tenantId = session?.tenantId ?? null;
  // Guarda el tenantId ya procesado: evita re-correr en cada navegación.
  const ranForTenant = useRef<string | null>(null);
  // onDone en ref para no incluirlo en las deps del effect.
  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;

  useEffect(() => {
    if (!tenantId) return;
    if (ranForTenant.current === tenantId) return;
    ranForTenant.current = tenantId;

    let cancelled = false;

    (async () => {
      try {
        const rejected = await data.listAfipDocuments({ status: 'rejected', limit: 5 });
        if (cancelled) return;

        const now = Date.now();
        const toRetry = rejected.filter((doc) => {
          if (!doc.lastRetryAt) return true;
          return now - new Date(doc.lastRetryAt).getTime() > RETRY_COOLDOWN_MS;
        });

        // Secuencial: un fallo no frena los demás.
        for (const doc of toRetry) {
          if (cancelled) return;
          try {
            await data.retryAfipDocument({ documentId: doc.id });
          } catch {
            // Silencioso: el banner reflejará el estado final.
          }
        }

        if (!cancelled) onDoneRef.current?.();
      } catch {
        // Sin sesión válida o falló el listado: no hacemos nada.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);
}
