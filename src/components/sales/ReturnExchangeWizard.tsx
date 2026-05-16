import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Minus,
  Package,
  Plus,
  Scan,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import { VariantPickerModal } from '@/components/pos/VariantPickerModal';
import { data } from '@/data';
import { formatARS } from '@/lib/currency';
import { addMoney, lineSubtotal, subMoney, toCents, fromCents } from '@/lib/money';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';
import {
  CUSTOMER_DOC_TYPES,
  CUSTOMER_IVA_CONDITIONS,
  PAYMENT_METHODS,
  type CustomerDocType,
  type CustomerIvaCondition,
  type PaymentMethod,
  type Product,
  type ProductVariant,
  type ReturnReason,
  type Sale,
} from '@/types';
import { getSupabase } from '@/lib/supabase';

/** Operación elegida en paso 1. */
type OpType = 'return' | 'exchange';

/** Modo de devolución del dinero al cliente. */
type RefundMode = 'cash' | 'credit';

/** Una línea del carrito de "items nuevos" (paso 3). */
interface NewCartLine {
  /** Key local para la lista (no se manda al backend). */
  key: string;
  productId: string;
  variantId: string;
  name: string;
  /** Atributos de la variante (para mostrar). */
  attrLabel: string;
  qty: number;
  price: number;
  discount: number;
}

interface Props {
  open: boolean;
  /** Si null, el modal queda cerrado. */
  sale: Sale | null;
  onClose: () => void;
  /** Se llama después de confirmar la operación con éxito. */
  onCompleted: () => void;
}

const STEPS_RETURN = ['Tipo', 'Items a devolver', 'Motivo y cierre'] as const;
const STEPS_EXCHANGE = ['Tipo', 'Items a devolver', 'Items nuevos', 'Motivo y cierre'] as const;

/**
 * Wizard de devoluciones / cambios sobre una venta facturada.
 *
 * Pasos:
 *   1) Tipo de operación (return | exchange).
 *   2) Cantidades a devolver por línea de la venta original.
 *   3) Sólo si exchange: mini-carrito de items nuevos (búsqueda + EAN + variantes).
 *   4) Motivo de devolución + cómo se cierra la diferencia (cash/credit/pagos).
 *
 * Al confirmar dispara `data.returnSaleItems` o `data.exchangeSale`.
 */
export function ReturnExchangeWizard({ open, sale, onClose, onCompleted }: Props) {
  if (!sale) return null;
  return (
    <ReturnExchangeWizardInner
      open={open}
      sale={sale}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

function ReturnExchangeWizardInner({
  open,
  sale,
  onClose,
  onCompleted,
}: {
  open: boolean;
  sale: Sale;
  onClose: () => void;
  onCompleted: () => void;
}) {
  // --- Paso 1: tipo ---
  const [opType, setOpType] = useState<OpType>('return');
  // --- Paso 2: cantidades a devolver por saleItem.id ---
  const [returnQtyById, setReturnQtyById] = useState<Record<string, number>>({});
  // --- Paso 3: items nuevos (carrito) ---
  const [newCart, setNewCart] = useState<NewCartLine[]>([]);
  // --- Paso 4: motivo + cierre ---
  const [reasons, setReasons] = useState<ReturnReason[]>([]);
  const [reasonId, setReasonId] = useState<string>('');
  /** Si reasonId === '__other__', usamos texto libre. */
  const [reasonText, setReasonText] = useState<string>('');
  const [refundMode, setRefundMode] = useState<RefundMode>('cash');
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([
    { method: 'cash', amount: 0 },
  ]);
  // --- Step machine ---
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);

  // Sprint DEV.fix: policy del tenant + cliente registrado al vuelo en el wizard.
  const [refundPolicy, setRefundPolicy] = useState<
    'cash_or_credit' | 'credit_only' | 'cash_only'
  >('cash_or_credit');
  const [attachedCustomerId, setAttachedCustomerId] = useState<string | null>(null);
  const [registerCustomerOpen, setRegisterCustomerOpen] = useState(false);

  const hasCustomer = Boolean(sale.customerId || attachedCustomerId);
  const selectedReason = useMemo(
    () => reasons.find((r) => r.id === reasonId) ?? null,
    [reasons, reasonId],
  );
  const cashAllowed =
    refundPolicy !== 'credit_only' || !!selectedReason?.allowsCashRefund;
  const creditAllowed = refundPolicy !== 'cash_only' && hasCustomer;

  // Reset al abrir/cerrar.
  useEffect(() => {
    if (!open) return;
    setOpType('return');
    setReturnQtyById({});
    setNewCart([]);
    setReasonId('');
    setReasonText('');
    setRefundMode('cash');
    setPayments([{ method: 'cash', amount: 0 }]);
    setStep(1);
    setLoading(false);
    setAttachedCustomerId(null);
    setRegisterCustomerOpen(false);
  }, [open, sale.id]);

  // Cargar policy del tenant al abrir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const t = await data.getTenant();
        if (!cancelled) setRefundPolicy(t.refundPolicy ?? 'cash_or_credit');
      } catch {
        if (!cancelled) setRefundPolicy('cash_or_credit');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cargar motivos al abrir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await data.listReturnReasons({ activeOnly: true });
        if (!cancelled) setReasons(list);
      } catch {
        // Si el backend no tiene motivos cargados, el usuario igual puede usar "Otro".
        if (!cancelled) setReasons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Forzar refundMode válido según policy + motivo + cliente.
  useEffect(() => {
    if (refundMode === 'credit' && !creditAllowed) setRefundMode('cash');
    if (refundMode === 'cash' && !cashAllowed && creditAllowed) setRefundMode('credit');
  }, [cashAllowed, creditAllowed, refundMode]);

  // --- Cálculos derivados ---

  /** Subtotal bruto de los items devueltos (sin prorrateo de descuento). */
  const returnedGross = useMemo(() => {
    return sale.items.reduce((acc, it) => {
      const q = returnQtyById[it.id] ?? 0;
      if (q <= 0) return acc;
      return addMoney(acc, lineSubtotal(it.price, q, 0));
    }, 0);
  }, [sale.items, returnQtyById]);

  /**
   * Total que se devuelve al cliente (NC).
   * Si la venta tuvo descuento global, prorrateamos en proporción al subtotal devuelto.
   *   ncTotal = returnedGross - (sale.discount * returnedGross / sale.subtotal)
   */
  const ncTotal = useMemo(() => {
    if (returnedGross <= 0) return 0;
    if (sale.discount <= 0 || sale.subtotal <= 0) return returnedGross;
    const proratedDiscountCents = Math.round(
      (toCents(sale.discount) * toCents(returnedGross)) / toCents(sale.subtotal),
    );
    return Math.max(subMoney(returnedGross, fromCents(proratedDiscountCents)), 0);
  }, [returnedGross, sale.discount, sale.subtotal]);

  /** Total de los items nuevos del carrito. */
  const newTotal = useMemo(() => {
    return newCart.reduce(
      (acc, l) => addMoney(acc, lineSubtotal(l.price, l.qty, l.discount)),
      0,
    );
  }, [newCart]);

  /**
   * Diferencia desde el punto de vista del cliente:
   *  > 0 → al cliente le sobra plata (devolvemos algo o le acreditamos)
   *  < 0 → al cliente le falta plata (tiene que pagar la diferencia)
   *  = 0 → cambio parejo
   */
  const difference = useMemo(() => {
    if (opType === 'return') return ncTotal; // todo el ncTotal es a favor del cliente
    return subMoney(ncTotal, newTotal);
  }, [opType, ncTotal, newTotal]);

  const customerOwesUs = opType === 'exchange' && difference < 0;
  const weOweCustomer = difference > 0;

  // Inicializar el pago a la diferencia cuando se entra al step 4 (si corresponde).
  useEffect(() => {
    if (step !== 4) return;
    if (!customerOwesUs) return;
    setPayments([{ method: 'cash', amount: Math.abs(difference) }]);
  }, [step, customerOwesUs, difference]);

  // --- Helpers UI ---

  function setReturnQty(saleItemId: string, qty: number, max: number) {
    const clamped = Math.max(0, Math.min(qty, max));
    setReturnQtyById((prev) => ({ ...prev, [saleItemId]: clamped }));
  }

  const paidNew = addMoney(...payments.map((p) => p.amount));
  const paymentsExact = !customerOwesUs || Math.abs(paidNew - Math.abs(difference)) <= 0.005;

  // Indica si hay datos suficientes para considerar "el wizard tiene cambios sin guardar".
  function hasDirtyData(): boolean {
    if (returnedGross > 0) return true;
    if (newCart.length > 0) return true;
    if (reasonId || reasonText.trim()) return true;
    return false;
  }

  async function handleClose() {
    if (hasDirtyData()) {
      const ok = await confirmDialog('¿Descartar la operación?', {
        text: 'Vas a perder los cambios cargados en el wizard.',
        confirmText: 'Descartar',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  // --- Navegación ---

  function canAdvanceFromStep2(): boolean {
    return returnedGross > 0;
  }

  function canAdvanceFromStep3(): boolean {
    return newCart.length > 0;
  }

  function canConfirm(): boolean {
    if (loading) return false;
    if (returnedGross <= 0) return false;
    if (opType === 'exchange' && newCart.length === 0) return false;
    if (customerOwesUs && !paymentsExact) return false;
    // Motivo: o un reason del listado, o un texto libre cuando es "otro".
    if (!reasonId) return false;
    if (reasonId === '__other__' && !reasonText.trim()) return false;
    return true;
  }

  function goNext() {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      // Si es return puro, saltamos el paso 3.
      setStep(opType === 'exchange' ? 3 : 4);
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
  }

  function goBack() {
    if (step === 4) {
      setStep(opType === 'exchange' ? 3 : 2);
      return;
    }
    if (step === 3) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(1);
      return;
    }
  }

  // --- Confirm ---

  async function handleConfirm() {
    if (!canConfirm()) return;
    setLoading(true);
    try {
      // Si el cajero registró un cliente inline (saldo a favor sin customer),
      // asociarlo a la venta original ANTES de emitir la NC para que el backend
      // pueda acreditar el saldo al cliente correcto.
      if (attachedCustomerId && !sale.customerId) {
        const { error: attachErr } = await getSupabase()
          .from('sales')
          .update({ customer_id: attachedCustomerId })
          .eq('id', sale.id);
        if (attachErr) {
          toast.error('No se pudo asociar el cliente a la venta: ' + attachErr.message);
          return;
        }
      }

      // Mapear items a devolver al shape del backend.
      const itemsToReturn = sale.items
        .map((it) => ({ saleItemId: it.id, qty: returnQtyById[it.id] ?? 0 }))
        .filter((it) => it.qty > 0);

      const finalReasonId = reasonId === '__other__' ? null : reasonId || null;
      const finalReasonText = reasonId === '__other__' ? reasonText.trim() : null;

      if (opType === 'return') {
        // Si no nos debe nada el cliente (caso normal), refundMode efectivo.
        // 'cash' o 'credit'. Nunca 'none' desde la UI.
        const result = await data.returnSaleItems({
          saleId: sale.id,
          items: itemsToReturn,
          reasonId: finalReasonId,
          reasonText: finalReasonText,
          refundMode: weOweCustomer ? refundMode : 'none',
        });
        if (result.ok) {
          toast.success('Devolución registrada. NC emitida.');
          onCompleted();
          onClose();
        } else {
          toast.error(result.error ?? 'No se pudo procesar la devolución');
        }
        return;
      }

      // Exchange.
      const newItemsInput = newCart.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        qty: l.qty,
        price: l.price,
        discount: l.discount,
      }));
      const result = await data.exchangeSale({
        originalSaleId: sale.id,
        returnedItems: itemsToReturn,
        newItems: newItemsInput,
        payments: customerOwesUs ? payments : [],
        refundMode: weOweCustomer ? refundMode : 'cash', // valor formal, no se usa si diff <= 0
        reasonId: finalReasonId,
        reasonText: finalReasonText,
        receiver: sale.customerId
          ? {
              customerId: sale.customerId,
              docType: sale.customerDocType!,
              docNumber: sale.customerDocNumber!,
              legalName: sale.customerLegalName!,
              ivaCondition: sale.customerIvaCondition!,
            }
          : null,
      });
      if (result.ok) {
        const diff = result.difference ?? difference;
        let detail = '';
        if (Math.abs(diff) < 0.01) detail = 'Cambio parejo.';
        else if (diff > 0)
          detail = `A favor del cliente: ${formatARS(diff)} (${refundMode === 'credit' ? 'saldo' : 'efectivo'}).`;
        else detail = `Cobrado al cliente: ${formatARS(Math.abs(diff))}.`;
        toast.success(`Cambio completado. ${detail}`);
        onCompleted();
        onClose();
      } else {
        toast.error(result.error ?? 'No se pudo procesar el cambio');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // --- Render ---

  const steps = opType === 'exchange' ? STEPS_EXCHANGE : STEPS_RETURN;
  // Índice visual del progress: en return saltamos el "Items nuevos".
  const visualStep = step === 4 ? steps.length : step;

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      title={`Devolver / Cambiar — Venta ${sale.id.slice(0, 8)}`}
      widthClass="max-w-3xl"
    >
      <ProgressBar steps={steps as unknown as string[]} current={visualStep} />

      <div className="mt-4">
        {step === 1 && (
          <Step1
            opType={opType}
            setOpType={setOpType}
            hasCustomer={hasCustomer}
          />
        )}
        {step === 2 && (
          <Step2
            sale={sale}
            returnQtyById={returnQtyById}
            setReturnQty={setReturnQty}
            returnedGross={returnedGross}
            ncTotal={ncTotal}
          />
        )}
        {step === 3 && (
          <Step3
            newCart={newCart}
            setNewCart={setNewCart}
            newTotal={newTotal}
            ncTotal={ncTotal}
            difference={difference}
          />
        )}
        {step === 4 && (
          <Step4
            sale={sale}
            opType={opType}
            ncTotal={ncTotal}
            newTotal={newTotal}
            difference={difference}
            customerOwesUs={customerOwesUs}
            weOweCustomer={weOweCustomer}
            reasons={reasons}
            reasonId={reasonId}
            setReasonId={setReasonId}
            reasonText={reasonText}
            setReasonText={setReasonText}
            refundMode={refundMode}
            setRefundMode={setRefundMode}
            hasCustomer={hasCustomer}
            refundPolicy={refundPolicy}
            cashAllowed={cashAllowed}
            creditAllowed={creditAllowed}
            onRegisterCustomerClick={() => setRegisterCustomerOpen(true)}
            payments={payments}
            setPayments={setPayments}
            paidNew={paidNew}
            paymentsExact={paymentsExact}
            returnedItems={sale.items
              .map((it) => ({
                ...it,
                returningQty: returnQtyById[it.id] ?? 0,
              }))
              .filter((it) => it.returningQty > 0)}
            newCart={newCart}
          />
        )}
      </div>

      {/* Nav buttons */}
      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
        <div>
          {step > 1 && (
            <Button variant="outline" onClick={goBack} disabled={loading}>
              <ArrowLeft className="h-4 w-4" /> Atrás
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          {step < 4 ? (
            <Button
              onClick={goNext}
              disabled={
                (step === 2 && !canAdvanceFromStep2()) ||
                (step === 3 && !canAdvanceFromStep3())
              }
            >
              Siguiente <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleConfirm} disabled={!canConfirm()}>
              {loading ? (
                'Procesando…'
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {opType === 'return' ? 'Confirmar devolución' : 'Confirmar cambio'}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
    <RegisterCustomerInlineModal
      open={registerCustomerOpen}
      onClose={() => setRegisterCustomerOpen(false)}
      onCreated={(c) => {
        setAttachedCustomerId(c.id);
        setRegisterCustomerOpen(false);
        toast.success('Cliente registrado. Va a quedar asociado al confirmar.');
      }}
    />
    </>
  );
}

// --- Subcomponentes ---

function ProgressBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((label, idx) => {
        const n = idx + 1;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done
                  ? 'bg-emerald-600 text-white'
                  : active
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-200 text-slate-500',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span
              className={cn(
                'whitespace-nowrap text-xs',
                active ? 'font-semibold text-navy' : 'text-slate-500',
              )}
            >
              {label}
            </span>
            {idx < steps.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200" />}
          </li>
        );
      })}
    </ol>
  );
}

// --- Step 1: tipo de operación ---

function Step1({
  opType,
  setOpType,
  hasCustomer,
}: {
  opType: OpType;
  setOpType: (t: OpType) => void;
  hasCustomer: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Elegí qué querés hacer con esta venta.
      </p>
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
          opType === 'return'
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-200 hover:border-slate-300',
        )}
      >
        <input
          type="radio"
          name="opType"
          className="mt-1 h-4 w-4"
          checked={opType === 'return'}
          onChange={() => setOpType('return')}
        />
        <div>
          <div className="text-sm font-semibold text-navy">Devolución (sin cambio)</div>
          <div className="text-xs text-slate-500">
            El cliente devuelve uno o más items. Se emite Nota de Crédito y se devuelve
            el dinero (efectivo o saldo a favor).
          </div>
        </div>
      </label>
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
          opType === 'exchange'
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-200 hover:border-slate-300',
        )}
      >
        <input
          type="radio"
          name="opType"
          className="mt-1 h-4 w-4"
          checked={opType === 'exchange'}
          onChange={() => setOpType('exchange')}
        />
        <div>
          <div className="text-sm font-semibold text-navy">
            Cambio (devuelve algo y se lleva otro)
          </div>
          <div className="text-xs text-slate-500">
            Devolución + nueva factura por los items nuevos. La diferencia se cobra o
            se devuelve según el caso.
          </div>
        </div>
      </label>

      {!hasCustomer && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Sin cliente identificado.</strong> No se puede usar "saldo a favor"
            como devolución — solo efectivo.
          </div>
        </div>
      )}
    </div>
  );
}

// --- Step 2: items a devolver ---

function Step2({
  sale,
  returnQtyById,
  setReturnQty,
  returnedGross,
  ncTotal,
}: {
  sale: Sale;
  returnQtyById: Record<string, number>;
  setReturnQty: (saleItemId: string, qty: number, max: number) => void;
  returnedGross: number;
  ncTotal: number;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Indicá cuántas unidades de cada item se devuelven. No podés superar lo que ya
        no fue devuelto antes.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right">Vendido</th>
              <th className="px-3 py-2 text-right">Ya devuelto</th>
              <th className="px-3 py-2 text-right">Disponible</th>
              <th className="px-3 py-2 text-right">A devolver</th>
              <th className="px-3 py-2 text-right">Subt.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sale.items.map((it) => {
              const already = it.qtyReturned ?? 0;
              const available = Math.max(it.qty - already, 0);
              const disabled = available <= 0;
              const current = returnQtyById[it.id] ?? 0;
              const subt = lineSubtotal(it.price, current, 0);
              return (
                <tr key={it.id} className={disabled ? 'opacity-50' : ''}>
                  <td className="px-3 py-2">{it.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(it.price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{already}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{available}</td>
                  <td className="px-3 py-2 text-right">
                    {disabled ? (
                      <Tooltip label="Ya devuelta entera">
                        <span className="text-slate-400">—</span>
                      </Tooltip>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                          onClick={() => setReturnQty(it.id, current - 1, available)}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={available}
                          step={1}
                          className="h-7 w-16 rounded-md border border-slate-300 text-center text-sm tabular-nums"
                          value={current}
                          onChange={(e) =>
                            setReturnQty(it.id, Number(e.target.value) || 0, available)
                          }
                        />
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                          onClick={() => setReturnQty(it.id, current + 1, available)}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {current > 0 ? formatARS(subt) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Subtotal a devolver</span>
          <span className="tabular-nums">{formatARS(returnedGross)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between text-xs text-slate-500">
            <span>Descuento prorrateado de la venta original</span>
            <span className="tabular-nums">-{formatARS(subMoney(returnedGross, ncTotal))}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-navy">
          <span>Total a devolver (NC)</span>
          <span className="tabular-nums">{formatARS(ncTotal)}</span>
        </div>
      </div>
    </div>
  );
}

// --- Step 3: items nuevos (mini-carrito) ---

function Step3({
  newCart,
  setNewCart,
  newTotal,
  ncTotal,
  difference,
}: {
  newCart: NewCartLine[];
  setNewCart: React.Dispatch<React.SetStateAction<NewCartLine[]>>;
  newTotal: number;
  ncTotal: number;
  difference: number;
}) {
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  // Cache variantes por producto.
  const variantsCache = useRef<Map<string, ProductVariant[]>>(new Map());
  const [picker, setPicker] = useState<{
    product: Product;
    variants: ProductVariant[];
  } | null>(null);

  // Cargar productos al montar (solo una vez por sesión del wizard).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await data.listProducts();
        if (!cancelled) setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const active = products.filter((p) => p.active);
    if (!search.trim()) return active.slice(0, 30);
    const q = search.toLowerCase();
    return active
      .filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q))
      .slice(0, 30);
  }, [products, search]);

  /** Agrega una variante al carrito (o suma 1 si ya existía esa misma variante). */
  const addVariantToCart = useCallback(
    (product: Product, variant: ProductVariant) => {
      const price = variant.priceOverride ?? product.price;
      const attrs = Object.entries(variant.attributes)
        .map(([, v]) => v)
        .join(' ');
      const displayName = attrs ? `${product.name} — ${attrs}` : product.name;
      setNewCart((prev) => {
        const idx = prev.findIndex((l) => l.variantId === variant.id);
        if (idx >= 0) {
          return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
        }
        return [
          ...prev,
          {
            key: `${variant.id}-${Date.now()}`,
            productId: product.id,
            variantId: variant.id,
            name: displayName,
            attrLabel: attrs,
            qty: 1,
            price,
            discount: 0,
          },
        ];
      });
    },
    [setNewCart],
  );

  /** Flow al click-tap en una tarjeta de producto: abre picker si hay variantes. */
  const addProductFlow = useCallback(
    async (product: Product) => {
      try {
        let variants = variantsCache.current.get(product.id);
        if (!variants) {
          variants = await data.listVariants(product.id);
          variantsCache.current.set(product.id, variants);
        }
        const active = variants.filter((v) => v.active);
        if (active.length === 0) {
          toast.error(`"${product.name}" no tiene variantes activas`);
          return;
        }
        if (active.length === 1 && Object.keys(active[0].attributes).length === 0) {
          addVariantToCart(product, active[0]);
          return;
        }
        setPicker({ product, variants });
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [addVariantToCart],
  );

  async function handleBarcode(e: FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    setBarcode('');
    if (!code) return;
    try {
      const match = await data.findVariantByCode(code);
      if (!match) {
        toast.error(`Sin resultado para "${code}"`);
        return;
      }
      addVariantToCart(match.product, match.variant);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function setLineQty(key: string, qty: number) {
    const safe = Math.max(0, qty);
    setNewCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: safe } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function setLinePrice(key: string, price: number) {
    setNewCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, price: Math.max(0, price) } : l)),
    );
  }

  function setLineDiscount(key: string, disc: number) {
    setNewCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, discount: Math.max(0, disc) } : l)),
    );
  }

  function removeLine(key: string) {
    setNewCart((prev) => prev.filter((l) => l.key !== key));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Picker de productos */}
      <div className="flex min-h-0 flex-col">
        <form onSubmit={handleBarcode} className="mb-2 flex gap-2">
          <div className="relative flex-1">
            <Scan className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              ref={barcodeRef}
              placeholder="Código de barras y Enter…"
              className="pl-9"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm">
            Agregar
          </Button>
        </form>
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por nombre…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[300px] min-h-[180px] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
              <Package className="mb-1 h-6 w-6" />
              {search ? 'Sin resultados.' : 'Buscá un producto o escaneá un código.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void addProductFlow(p)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="font-semibold tabular-nums text-brand-700">
                      {formatARS(p.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Carrito */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
          Carrito ({newCart.length})
        </div>
        <div className="max-h-[300px] min-h-[180px] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {newCart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
              Agregá los items que se lleva el cliente.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {newCart.map((l) => (
                <li key={l.key} className="px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-navy">{l.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatARS(l.price)} c/u
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                      onClick={() => setLineQty(l.key, l.qty - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="h-7 w-14 rounded-md border border-slate-300 text-center text-xs tabular-nums"
                      value={l.qty}
                      onChange={(e) => setLineQty(l.key, Number(e.target.value) || 0)}
                    />
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                      onClick={() => setLineQty(l.key, l.qty + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <span className="mx-1 text-[10px] uppercase text-slate-400">precio</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-7 w-20 rounded-md border border-slate-300 px-1 text-right text-xs tabular-nums"
                      value={l.price}
                      onChange={(e) => setLinePrice(l.key, Number(e.target.value) || 0)}
                    />
                    <span className="mx-1 text-[10px] uppercase text-slate-400">desc</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-7 w-20 rounded-md border border-slate-300 px-1 text-right text-xs tabular-nums"
                      value={l.discount}
                      onChange={(e) => setLineDiscount(l.key, Number(e.target.value) || 0)}
                    />
                    <div className="ml-auto text-right text-xs font-semibold tabular-nums text-navy">
                      {formatARS(lineSubtotal(l.price, l.qty, l.discount))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Resumen diferencia */}
      <div className="rounded-lg bg-slate-50 p-3 text-sm lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">Devuelve</div>
            <div className="font-semibold tabular-nums">{formatARS(ncTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Se lleva</div>
            <div className="font-semibold tabular-nums">{formatARS(newTotal)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Diferencia</div>
            <div
              className={cn(
                'font-bold tabular-nums',
                difference > 0
                  ? 'text-emerald-700'
                  : difference < 0
                    ? 'text-red-700'
                    : 'text-slate-700',
              )}
            >
              {difference >= 0 ? formatARS(difference) : `-${formatARS(Math.abs(difference))}`}
            </div>
            <div className="text-[11px] text-slate-500">
              {difference > 0
                ? 'A favor del cliente'
                : difference < 0
                  ? 'A cobrar al cliente'
                  : 'Cambio parejo'}
            </div>
          </div>
        </div>
      </div>

      {/* Picker modal de variantes */}
      <VariantPickerModal
        open={picker !== null}
        product={picker?.product ?? null}
        variants={picker?.variants ?? []}
        onClose={() => setPicker(null)}
        onPick={(variant) => {
          if (!picker) return;
          addVariantToCart(picker.product, variant);
          setPicker(null);
        }}
      />
    </div>
  );
}

// --- Step 4: motivo + cierre ---

function Step4({
  sale,
  opType,
  ncTotal,
  newTotal,
  difference,
  customerOwesUs,
  weOweCustomer,
  reasons,
  reasonId,
  setReasonId,
  reasonText,
  setReasonText,
  refundMode,
  setRefundMode,
  hasCustomer,
  refundPolicy,
  cashAllowed,
  creditAllowed,
  onRegisterCustomerClick,
  payments,
  setPayments,
  paidNew,
  paymentsExact,
  returnedItems,
  newCart,
}: {
  sale: Sale;
  opType: OpType;
  ncTotal: number;
  newTotal: number;
  difference: number;
  customerOwesUs: boolean;
  weOweCustomer: boolean;
  reasons: ReturnReason[];
  reasonId: string;
  setReasonId: (id: string) => void;
  reasonText: string;
  setReasonText: (s: string) => void;
  refundMode: RefundMode;
  setRefundMode: (m: RefundMode) => void;
  hasCustomer: boolean;
  refundPolicy: 'cash_or_credit' | 'credit_only' | 'cash_only';
  cashAllowed: boolean;
  creditAllowed: boolean;
  onRegisterCustomerClick: () => void;
  payments: { method: PaymentMethod; amount: number }[];
  setPayments: React.Dispatch<
    React.SetStateAction<{ method: PaymentMethod; amount: number }[]>
  >;
  paidNew: number;
  paymentsExact: boolean;
  returnedItems: (Sale['items'][number] & { returningQty: number })[];
  newCart: NewCartLine[];
}) {
  function setPayRow(i: number, field: 'method' | 'amount', value: string) {
    setPayments((ps) =>
      ps.map((p, idx) =>
        idx === i
          ? {
              ...p,
              [field]: field === 'amount' ? Number(value) || 0 : (value as PaymentMethod),
            }
          : p,
      ),
    );
  }

  return (
    <div className="space-y-4">
      {/* Motivo */}
      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500">
          Motivo de la devolución
        </label>
        <select
          className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value)}
        >
          <option value="">— Elegí un motivo —</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
          <option value="__other__">Otro (escribir motivo)</option>
        </select>
        {reasonId === '__other__' && (
          <Input
            className="mt-2"
            placeholder="Describí el motivo…"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
          />
        )}
      </div>

      {/* Refund mode (sólo si nos sobra plata para el cliente) */}
      {weOweCustomer && (
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500">
            Cómo se devuelve la diferencia ({formatARS(difference)})
          </label>
          {refundPolicy === 'credit_only' && (
            <p className="mt-1 text-[11px] text-slate-500">
              Política del comercio: siempre vale.
              {!cashAllowed && ' Para devolver en efectivo elegí un motivo que lo permita (ej: Defectuoso).'}
            </p>
          )}
          {refundPolicy === 'cash_only' && (
            <p className="mt-1 text-[11px] text-slate-500">
              Política del comercio: siempre efectivo.
            </p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Tooltip
              label={cashAllowed ? '' : 'No permitido por la política del comercio'}
            >
              <label
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition',
                  refundMode === 'cash'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300',
                  !cashAllowed && 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={refundMode === 'cash'}
                  onChange={() => setRefundMode('cash')}
                  disabled={!cashAllowed}
                />
                <div>
                  <div className="font-semibold text-navy">Efectivo</div>
                  <div className="text-xs text-slate-500">Sale del cajón abierto.</div>
                </div>
              </label>
            </Tooltip>
            <Tooltip
              label={
                refundPolicy === 'cash_only'
                  ? 'No permitido por la política del comercio'
                  : !hasCustomer
                    ? 'La venta no tiene cliente identificado'
                    : 'Sumar al saldo a favor del cliente'
              }
            >
              <label
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition',
                  refundMode === 'credit'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300',
                  !creditAllowed && 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={refundMode === 'credit'}
                  onChange={() => setRefundMode('credit')}
                  disabled={!creditAllowed}
                />
                <div>
                  <div className="font-semibold text-navy">Saldo a favor</div>
                  <div className="text-xs text-slate-500">
                    Queda como crédito del cliente para usar en una compra futura.
                  </div>
                </div>
              </label>
            </Tooltip>
          </div>
          {refundPolicy !== 'cash_only' && !hasCustomer && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
              <div className="font-medium text-amber-800">
                La venta no tiene cliente identificado.
              </div>
              <div className="mt-0.5 text-amber-700">
                Para entregar saldo a favor, registrá un cliente ahora.
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={onRegisterCustomerClick}
              >
                Registrar cliente
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Pagos (sólo si el cliente nos debe plata) */}
      {customerOwesUs && (
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500">
            Pagos para cubrir la diferencia ({formatARS(Math.abs(difference))})
          </label>
          <div className="mt-2 space-y-2">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  value={p.method}
                  onChange={(e) => setPayRow(i, 'method', e.target.value)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-10 w-32 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm tabular-nums"
                  value={p.amount}
                  onChange={(e) => setPayRow(i, 'amount', e.target.value)}
                />
                {payments.length > 1 && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() =>
                      setPayments((ps) => ps.filter((_, idx) => idx !== i))
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline"
              onClick={() =>
                setPayments((ps) => [
                  ...ps,
                  { method: 'cash', amount: Math.max(Math.abs(difference) - paidNew, 0) },
                ])
              }
            >
              + Agregar pago
            </button>
            <div
              className={cn(
                'mt-1 flex justify-between rounded-md bg-slate-50 p-2 text-xs',
                paymentsExact ? 'text-emerald-700' : 'text-red-700',
              )}
            >
              <span>Total pagos</span>
              <span className="font-semibold tabular-nums">{formatARS(paidNew)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Resumen final */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
        <div className="mb-2 font-semibold text-navy">Resumen de la operación</div>
        <div className="space-y-1 text-xs text-slate-700">
          <div>
            Vas a devolver{' '}
            <strong>
              {returnedItems.reduce((acc, it) => acc + it.returningQty, 0)} items
            </strong>{' '}
            por <strong>{formatARS(ncTotal)}</strong> y emitir una Nota de Crédito.
          </div>
          {opType === 'exchange' && (
            <div>
              El cliente se lleva{' '}
              <strong>{newCart.reduce((a, l) => a + l.qty, 0)} items</strong> por{' '}
              <strong>{formatARS(newTotal)}</strong> en una nueva factura.
            </div>
          )}
          <div>
            {Math.abs(difference) < 0.01 ? (
              <span>Cambio parejo — no hay diferencia a cobrar ni devolver.</span>
            ) : weOweCustomer ? (
              <span>
                Diferencia a favor del cliente:{' '}
                <strong>{formatARS(difference)}</strong> (
                {refundMode === 'credit' ? 'saldo a favor' : 'efectivo'}).
              </span>
            ) : (
              <span>
                A cobrar al cliente: <strong>{formatARS(Math.abs(difference))}</strong>.
              </span>
            )}
          </div>
          {sale.customerLegalName && (
            <div className="text-[11px] text-slate-500">
              Cliente: {sale.customerLegalName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Mini-form para registrar un cliente desde el wizard (Sprint DEV.fix) ---

function RegisterCustomerInlineModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: { id: string; legalName: string }) => void;
}) {
  const [docType, setDocType] = useState<CustomerDocType>(80);
  const [docNumber, setDocNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [ivaCondition, setIvaCondition] = useState<CustomerIvaCondition>('consumidor_final');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDocType(80);
    setDocNumber('');
    setLegalName('');
    setIvaCondition('consumidor_final');
    setSaving(false);
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!docNumber.trim()) return toast.error('Número de documento es requerido');
    if (!legalName.trim()) return toast.error('Razón social / nombre es requerido');
    setSaving(true);
    try {
      const c = await data.createCustomer({
        docType,
        docNumber: docNumber.trim(),
        legalName: legalName.trim(),
        ivaCondition,
        email: null,
        notes: null,
      });
      onCreated({ id: c.id, legalName: c.legalName });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar cliente">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-slate-600">
          Carga rápida para asociar el saldo a favor. Después podés completar más datos
          desde Clientes.
        </p>
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Tipo doc</span>
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={docType}
              onChange={(e) => setDocType(Number(e.target.value) as CustomerDocType)}
            >
              {CUSTOMER_DOC_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Número</span>
            <Input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Razón social / Nombre
          </span>
          <Input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Ej: Juan Pérez"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Condición IVA</span>
          <select
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            value={ivaCondition}
            onChange={(e) => setIvaCondition(e.target.value as CustomerIvaCondition)}
          >
            {CUSTOMER_IVA_CONDITIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
