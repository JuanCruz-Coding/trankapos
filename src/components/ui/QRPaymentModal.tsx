import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, CheckCircle2, XCircle, Smartphone, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';
import { formatARS } from '@/lib/currency';
import { toast } from '@/stores/toast';
import type { Sale } from '@/types';

interface ChargeItem {
  productId: string;
  qty: number;
  price: number;
  discount: number;
  name?: string;
}

interface Props {
  open: boolean;
  branchId: string;
  registerId: string | null;
  items: ChargeItem[];
  discount: number;
  amount: number;
  onClose: () => void;
  /** Llamado cuando MP confirma y se creó la sale. */
  onPaid: (sale: Sale) => void;
}

type Status = 'creating' | 'waiting' | 'paid' | 'expired' | 'rejected' | 'cancelled' | 'error';

const POLL_MS = 2500;

export function QRPaymentModal({
  open,
  branchId,
  registerId,
  items,
  discount,
  amount,
  onClose,
  onPaid,
}: Props) {
  const [status, setStatus] = useState<Status>('creating');
  const [qrData, setQrData] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [errMsg, setErrMsg] = useState<string>('');
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const ranRef = useRef(false);

  // Generar el cobro al abrir
  useEffect(() => {
    if (!open) {
      // reset state al cerrar
      setStatus('creating');
      setQrData(null);
      setIntentId(null);
      setExpiresAt(null);
      setErrMsg('');
      ranRef.current = false;
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const sb = getSupabase();
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('No autenticado');

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-create-charge`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify({
            branchId,
            registerId,
            items,
            discount,
            amount,
            title: 'Venta TrankaPos',
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);

        setQrData(body.qrData);
        setIntentId(body.intentId);
        if (body.expiresAt) setExpiresAt(new Date(body.expiresAt));
        setStatus('waiting');
      } catch (err) {
        setErrMsg((err as Error).message);
        setStatus('error');
      }
    })();
  }, [open, branchId, registerId, items, discount, amount]);

  // Countdown
  useEffect(() => {
    if (!expiresAt) return;
    const iv = setInterval(() => {
      const sec = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setRemainingSec(sec);
      if (sec <= 0) setStatus((s) => (s === 'waiting' ? 'expired' : s));
    }, 500);
    return () => clearInterval(iv);
  }, [expiresAt]);

  // Polling de estado del intent
  useEffect(() => {
    if (status !== 'waiting' || !intentId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const sb = getSupabase();
        const { data: intent, error } = await sb
          .from('mp_payment_intents')
          .select('status, sale_id')
          .eq('id', intentId)
          .single();
        if (cancelled) return;
        if (error) return; // intermitente, reintentar en próximo tick
        if (intent.status === 'approved' && intent.sale_id) {
          // Cargar la sale completa y emitir onPaid
          const { data: sale, error: saleErr } = await sb
            .from('sales')
            .select('*, sale_items(*), sale_payments(method, amount)')
            .eq('id', intent.sale_id)
            .single();
          if (!saleErr && sale && !cancelled) {
            setStatus('paid');
            // Mapeo mínimo del row de Supabase al tipo Sale del front.
            // El POS solo usa estos campos del Sale post-cobro.
            const mapped: Sale = {
              id: sale.id,
              tenantId: sale.tenant_id,
              branchId: sale.branch_id,
              registerId: sale.register_id,
              cashierId: sale.cashier_id,
              subtotal: Number(sale.subtotal),
              discount: Number(sale.discount),
              total: Number(sale.total),
              status: sale.status,
              stockReservedMode: sale.stock_reserved_mode,
              voided: sale.voided,
              createdAt: sale.created_at,
              items: (sale.sale_items ?? []).map((it: {
                id: string;
                product_id: string;
                name: string;
                barcode: string | null;
                price: string;
                qty: string;
                discount: string;
                subtotal: string;
              }) => ({
                id: it.id,
                productId: it.product_id,
                name: it.name,
                barcode: it.barcode,
                price: Number(it.price),
                qty: Number(it.qty),
                discount: Number(it.discount),
                subtotal: Number(it.subtotal),
              })),
              payments: (sale.sale_payments ?? []).map((p: {
                method: string;
                amount: string;
              }) => ({
                method: p.method as Sale['payments'][number]['method'],
                amount: Number(p.amount),
              })),
            };
            setTimeout(() => onPaid(mapped), 1200); // mini pause para mostrar el tick
          }
        } else if (intent.status === 'rejected') {
          setStatus('rejected');
        } else if (intent.status === 'cancelled') {
          setStatus('cancelled');
        } else if (intent.status === 'expired') {
          setStatus('expired');
        }
      } catch {
        // ignore
      }
    };

    void poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [status, intentId, onPaid]);

  async function handleCancel() {
    if (intentId) {
      // Best-effort: marcar intent como cancelado para que el webhook no lo procese
      try {
        const sb = getSupabase();
        await sb
          .from('mp_payment_intents')
          .update({ status: 'cancelled' })
          .eq('id', intentId);
      } catch {
        // silent
      }
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={handleCancel} title="Cobrar con QR" widthClass="max-w-md">
      <div className="text-center">
        <div className="mb-2 text-xs text-slate-500">Mostrale este QR al cliente</div>
        <div className="mb-3 font-display text-3xl font-bold tabular-nums text-navy">
          {formatARS(amount)}
        </div>

        {status === 'creating' && (
          <div className="flex h-64 flex-col items-center justify-center">
            <Loader2 className="mb-3 h-10 w-10 animate-spin text-brand-600" />
            <p className="text-sm text-slate-500">Generando código QR…</p>
          </div>
        )}

        {status === 'waiting' && qrData && (
          <>
            <div className="mx-auto mb-3 inline-block rounded-xl border-2 border-slate-200 bg-white p-4">
              <QRCodeSVG value={qrData} size={220} level="M" />
            </div>
            <div className="flex items-center justify-center gap-1.5 text-sm text-amber-700">
              <Smartphone className="h-4 w-4" />
              Esperando pago…
            </div>
            {remainingSec > 0 && (
              <div className="mt-1 text-xs text-slate-500">
                El QR expira en {Math.floor(remainingSec / 60)}:
                {String(remainingSec % 60).padStart(2, '0')}
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-400">
              Tu cliente abre Mercado Pago en su celu, toca "Pagar" y escanea este código.
            </div>
          </>
        )}

        {status === 'paid' && (
          <div className="flex h-64 flex-col items-center justify-center">
            <CheckCircle2 className="mb-3 h-14 w-14 text-emerald-500" />
            <p className="font-display text-lg font-bold text-navy">¡Pago recibido!</p>
            <p className="text-sm text-slate-500">Cerrando…</p>
          </div>
        )}

        {(status === 'expired' || status === 'rejected' || status === 'cancelled') && (
          <div className="flex h-64 flex-col items-center justify-center">
            <XCircle className="mb-3 h-10 w-10 text-red-500" />
            <p className="font-display text-lg font-bold text-navy">
              {status === 'expired'
                ? 'El QR expiró'
                : status === 'rejected'
                  ? 'El pago fue rechazado'
                  : 'Cobro cancelado'}
            </p>
            <p className="text-xs text-slate-500">Podés volver al carrito y cobrar de nuevo.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex h-64 flex-col items-center justify-center">
            <XCircle className="mb-3 h-10 w-10 text-red-500" />
            <p className="font-display text-lg font-bold text-navy">No se pudo generar el QR</p>
            <p className="mt-1 px-4 text-xs text-slate-600">{errMsg}</p>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleCancel}>
            <X className="h-4 w-4" />
            {status === 'paid' ? 'Cerrar' : 'Cancelar cobro'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
