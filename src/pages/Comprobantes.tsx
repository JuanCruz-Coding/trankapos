import { useEffect, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tooltip } from '@/components/ui/Tooltip';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatDateTime } from '@/lib/dates';
import { toast } from '@/stores/toast';
import type { AfipDocumentDetail, AfipDocumentsQuery } from '@/data/driver';
import type { Sale, Tenant } from '@/types';
import { ReceiptModal } from '@/components/pos/ReceiptModal';

const PAGE_SIZE = 50;

type StatusFilter = 'all' | AfipDocumentDetail['status'];
type TypeFilter = 'all' | AfipDocumentDetail['docType'];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'authorized', label: 'Autorizado' },
  { value: 'rejected', label: 'Rechazado' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'cancelled', label: 'Anulado' },
];

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Todos los tipos' },
  { value: 'factura', label: 'Factura' },
  { value: 'nota_credito', label: 'Nota de Crédito' },
  { value: 'nota_debito', label: 'Nota de Débito' },
];

const DOC_TYPE_LABEL: Record<AfipDocumentDetail['docType'], string> = {
  factura: 'Factura',
  nota_credito: 'Nota de Crédito',
  nota_debito: 'Nota de Débito',
};

const STATUS_LABEL: Record<AfipDocumentDetail['status'], string> = {
  authorized: 'Autorizado',
  rejected: 'Rechazado',
  pending: 'Pendiente',
  cancelled: 'Anulado',
};

const STATUS_BADGE: Record<AfipDocumentDetail['status'], string> = {
  authorized: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

/** Número de comprobante: ptoVta(5)-voucher(8). "—" si todavía no tiene número. */
function formatVoucherNumber(doc: AfipDocumentDetail): string {
  if (doc.voucherNumber === null) return '—';
  const pv = String(doc.salesPoint).padStart(5, '0');
  const nro = String(doc.voucherNumber).padStart(8, '0');
  return `${pv}-${nro}`;
}

export default function Comprobantes() {
  const { session } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [docs, setDocs] = useState<AfipDocumentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Documentos en proceso de reintento (deshabilita el botón de esa fila).
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  // Sprint REPRINT: visor de comprobantes (reusa ReceiptModal con mode view).
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewerTenant, setViewerTenant] = useState<Tenant | null>(null);
  const [loadingView, setLoadingView] = useState<string | null>(null);

  async function handleViewDoc(doc: AfipDocumentDetail) {
    if (!doc.saleId) {
      toast.error('Este comprobante no tiene una venta asociada');
      return;
    }
    setLoadingView(doc.id);
    try {
      const [sale, t] = await Promise.all([
        data.getSale(doc.saleId),
        viewerTenant ? Promise.resolve(viewerTenant) : data.getTenant(),
      ]);
      if (!sale) {
        toast.error('No se encontró la venta del comprobante');
        return;
      }
      if (!viewerTenant) setViewerTenant(t);
      setViewingSale(sale);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingView(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: AfipDocumentsQuery = {
      status: statusFilter === 'all' ? undefined : statusFilter,
      docType: typeFilter === 'all' ? undefined : typeFilter,
      limit,
    };
    void (async () => {
      try {
        const result = await data.listAfipDocuments(query);
        if (!cancelled) setDocs(result);
      } catch (err) {
        if (!cancelled) {
          setDocs([]);
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, statusFilter, typeFilter, limit, refreshKey]);

  function setRetrying(id: string, busy: boolean) {
    setRetryingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleRetry(doc: AfipDocumentDetail) {
    setRetrying(doc.id, true);
    try {
      const result = await data.retryAfipDocument({ documentId: doc.id });
      if (result.ok) {
        toast.success('Comprobante reenviado a AFIP');
      } else {
        toast.error(result.error ?? 'No se pudo reintentar el comprobante');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRetrying(doc.id, false);
      setRefreshKey((k) => k + 1);
    }
  }

  return (
    <div>
      <PageHeader
        title="Comprobantes"
        subtitle="Historial de facturas y notas de crédito emitidas a AFIP"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setLimit(PAGE_SIZE);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as TypeFilter);
            setLimit(PAGE_SIZE);
          }}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-10 text-center text-sm text-red-600">
          No se pudo cargar el historial: {error}
        </div>
      ) : loading && docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Cargando comprobantes…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No hay comprobantes que coincidan con los filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">CAE</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((doc) => {
                const isRetrying = retryingIds.has(doc.id);
                return (
                  <tr key={doc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {formatDateTime(doc.emittedAt ?? doc.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span>
                        {DOC_TYPE_LABEL[doc.docType]} {doc.docLetter}
                      </span>
                      {doc.environment && (
                        <span
                          className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase ${
                            doc.environment === 'production'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {doc.environment === 'production' ? 'Producción' : 'Homologación'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {formatVoucherNumber(doc)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[doc.status]}`}
                      >
                        {STATUS_LABEL[doc.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{doc.cae ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {doc.status === 'rejected' && doc.errorMessage ? (
                        <Tooltip label={doc.errorMessage}>
                          <span className="block max-w-[14rem] truncate text-red-600">
                            {doc.errorMessage}
                          </span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {doc.status === 'authorized' && doc.saleId && (
                          <Tooltip label="Ver comprobante">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={loadingView === doc.id}
                              onClick={() => handleViewDoc(doc)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        )}
                        {doc.status === 'rejected' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isRetrying}
                            onClick={() => handleRetry(doc)}
                          >
                            <RefreshCw
                              className={`mr-1.5 h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`}
                            />
                            {isRetrying ? 'Reintentando…' : 'Reintentar'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {docs.length >= limit && (
            <div className="border-t border-slate-100 bg-slate-50 p-3 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                Cargar más comprobantes
              </Button>
            </div>
          )}
        </div>
      )}

      {viewingSale && viewerTenant && (
        <ReceiptModal
          sale={viewingSale}
          tenant={viewerTenant}
          mode="view"
          onClose={() => setViewingSale(null)}
        />
      )}
    </div>
  );
}
