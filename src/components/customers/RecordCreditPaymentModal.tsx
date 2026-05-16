import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { formatARS } from '@/lib/currency';
import { PAYMENT_METHODS, type PaymentMethod } from '@/types';

interface Props {
  open: boolean;
  customerId: string;
  customerName: string;
  /** Deuda actual del cliente (valor POSITIVO de lo que adeuda). */
  currentDebt: number;
  onClose: () => void;
  onRecorded: () => void;
}

/**
 * Modal para registrar un pago de fiado del cliente. Sprint FIA.
 * Suma al balance del customer y deja el movement con reason='fiado_payment'.
 * No genera factura ni movimiento de caja por ahora (TODO sprint posterior:
 * registrar en cash_movements si hay caja abierta).
 */
export function RecordCreditPaymentModal({
  open,
  customerId,
  customerName,
  currentDebt,
  onClose,
  onRecorded,
}: Props) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'on_account'>>('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(String(currentDebt));
    setMethod('cash');
    setNotes('');
    setSaving(false);
  }, [open, currentDebt]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return toast.error('El monto debe ser mayor a 0');
    }
    if (n > currentDebt + 0.01) {
      return toast.error(
        `El pago (${formatARS(n)}) supera la deuda actual (${formatARS(currentDebt)})`,
      );
    }
    setSaving(true);
    try {
      await data.recordCreditPayment({
        customerId,
        amount: n,
        method,
        notes: notes.trim() || null,
      });
      toast.success('Pago registrado');
      onRecorded();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar pago de fiado">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-lg bg-red-50 p-3 text-sm">
          <div className="text-xs uppercase text-red-700">Cliente</div>
          <div className="font-semibold text-red-900">{customerName}</div>
          <div className="mt-1 text-xs text-red-700">
            Deuda actual: <strong className="text-red-900">{formatARS(currentDebt)}</strong>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Monto a pagar</span>
          <Input
            type="number"
            min="0.01"
            max={currentDebt}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Cómo paga</span>
          <select
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            {PAYMENT_METHODS.filter((m) => m.value !== 'on_account').map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Notas (opcional)</span>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Pago parcial / contra factura X"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar pago'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
