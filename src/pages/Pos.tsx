import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  Camera,
  Minus,
  Package,
  Plus,
  Scan,
  Search,
  Trash2,
  UserCircle2,
  UserPlus,
  X,
} from 'lucide-react';
import { ReceiverSelectorModal } from '@/components/pos/ReceiverSelectorModal';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { determineCbteLetter } from '@/lib/afipLetter';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { data } from '@/data';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { useCart, cartTotals } from '@/stores/cart';
import { formatARS } from '@/lib/currency';
import { lineSubtotal, subMoney, applyDiscount, type DiscountMode } from '@/lib/money';
import { cn } from '@/lib/utils';
import { buildSaleFromCart, summarizeSale } from '@/lib/sales';
import { beepError, beepSuccess, primeAudio } from '@/lib/sound';
import { toast } from '@/stores/toast';
import { PAYMENT_METHODS, type PaymentMethod, type Sale, type SaleReceiver, type TaxCondition, type Tenant } from '@/types';
import { QRPaymentModal } from '@/components/ui/QRPaymentModal';

export default function Pos() {
  const { session, activeBranchId } = useAuth();
  const {
    lines,
    discount,
    addProduct,
    updateQty,
    updateLineDiscount,
    removeLine,
    setGlobalDiscount,
    clear,
  } = useCart();

  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [payModal, setPayModal] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  // Toggle $/% por línea de descuento. El monto en pesos se sigue guardando
  // en el store del carrito; estos states solo controlan cómo se interpreta
  // el input del usuario.
  const [lineDiscountModes, setLineDiscountModes] = useState<Record<string, DiscountMode>>({});
  const [lineDiscountInputs, setLineDiscountInputs] = useState<Record<string, string>>({});
  const [globalDiscountMode, setGlobalDiscountMode] = useState<DiscountMode>('amount');
  const [globalDiscountInput, setGlobalDiscountInput] = useState('');

  // Tenant: para los settings de ticket en el ReceiptModal.
  const [tenant, setTenant] = useState<Tenant | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!session) return;
    (async () => {
      try {
        const t = await data.getTenant();
        if (!cancelled) setTenant(t);
      } catch {
        // No bloquea: el ReceiptModal usa fallbacks si tenant es null.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId]);

  // ¿El tenant tiene MP Connect listo para cobrar con QR?
  const [mpReady, setMpReady] = useState(false);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabase();
        const { data: integ } = await sb
          .from('tenant_payment_integrations')
          .select('mp_pos_id')
          .eq('provider', 'mp')
          .maybeSingle();
        if (!cancelled) setMpReady(Boolean(integ?.mp_pos_id));
      } catch {
        if (!cancelled) setMpReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId]);

  // QR charge en curso (cobro MP)
  const [qrCharge, setQrCharge] = useState<{
    items: { productId: string; qty: number; price: number; discount: number; name?: string }[];
    discount: number;
    amount: number;
  } | null>(null);

  // refreshKey: bump después de cada venta para forzar refetch de stock/products
  // (useLiveQuery solo se entera de cambios en Dexie local, no de cambios remotos
  // en Supabase. Sin esto, después de cobrar el stock visible queda desactualizado
  // hasta refrescar la página).
  const [refreshKey, setRefreshKey] = useState(0);

  const products = useLiveQuery(async () => {
    if (!session) return [];
    return data.listProducts();
  }, [session?.tenantId, refreshKey]);

  // El POS resta del warehouse default de la branch activa.
  const defaultWarehouse = useLiveQuery(async () => {
    if (!activeBranchId) return null;
    return data.getDefaultWarehouse(activeBranchId);
  }, [activeBranchId]);

  const stock = useLiveQuery(async () => {
    if (!defaultWarehouse) return [];
    return data.listStock(defaultWarehouse.id);
  }, [defaultWarehouse?.id, refreshKey]);

  const openRegister = useLiveQuery(async () => {
    if (!activeBranchId) return null;
    return data.currentOpenRegister(activeBranchId);
  }, [activeBranchId, lines.length, refreshKey]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    (stock ?? []).forEach((s) => map.set(s.productId, s.qty));
    return map;
  }, [stock]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const active = products.filter((p) => p.active);
    if (!search.trim()) return active.slice(0, 60);
    const q = search.toLowerCase();
    return active
      .filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q))
      .slice(0, 60);
  }, [products, search]);

  const { subtotal, total } = cartTotals(lines, discount);

  // Recalcula el monto del descuento de una línea desde el input crudo + modo.
  function applyLineDiscount(productId: string, raw: string, mode: DiscountMode) {
    setLineDiscountInputs((prev) => ({ ...prev, [productId]: raw }));
    setLineDiscountModes((prev) => ({ ...prev, [productId]: mode }));
    const line = lines.find((l) => l.productId === productId);
    if (!line) return;
    const value = Number(raw) || 0;
    const base = line.price * line.qty;
    const amount = applyDiscount(value, mode, base);
    updateLineDiscount(productId, amount);
  }

  function applyGlobalDiscount(raw: string, mode: DiscountMode) {
    setGlobalDiscountInput(raw);
    setGlobalDiscountMode(mode);
    const value = Number(raw) || 0;
    // Base = subtotal de líneas (antes del descuento global) — recalcular acá
    // sin usar `subtotal` cacheado para evitar dependencias circulares de useMemo.
    const base = lines.reduce(
      (acc, l) => acc + lineSubtotal(l.price, l.qty, l.discount),
      0,
    );
    const amount = applyDiscount(value, mode, base);
    setGlobalDiscount(amount);
  }

  useEffect(() => {
    barcodeRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeRef.current?.focus();
      }
      if (e.key === 'F4' && lines.length > 0) {
        e.preventDefault();
        setPayModal(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lines.length]);

  async function processCode(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    try {
      const product = await data.findProductByCode(code);
      if (!product) {
        beepError();
        toast.error(`Sin resultado para "${code}"`);
        return;
      }
      const stockQty = stockByProduct.get(product.id) ?? 0;
      if (stockQty <= 0) {
        beepError();
        toast.error(`Sin stock de "${product.name}"`);
        return;
      }
      addProduct(product);
      beepSuccess();
    } catch (err) {
      beepError();
      toast.error((err as Error).message);
    }
  }

  async function handleBarcode(e: FormEvent) {
    e.preventDefault();
    primeAudio();
    setBarcode('');
    await processCode(barcode);
  }

  async function handleScannerDetected(code: string) {
    setScannerOpen(false);
    await processCode(code);
  }

  if (!session || !activeBranchId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-500">
        Seleccioná una sucursal activa en la barra lateral.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Cart (left on desktop, bottom on mobile) */}
      <section className="order-2 flex min-h-0 flex-1 flex-col border-t border-slate-200 bg-white lg:order-1 lg:w-[420px] lg:shrink-0 lg:border-r lg:border-t-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Carrito</h2>
            <p className="text-xs text-slate-500">{lines.length} items</p>
          </div>
          {lines.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clear}>
              <Trash2 className="h-4 w-4" /> Limpiar
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center p-6 text-center text-sm text-slate-400">
              <Scan className="mb-2 h-8 w-8" />
              Escaneá un código de barras o buscá un producto.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((line) => (
                <li key={line.productId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{line.name}</div>
                      <div className="text-xs text-slate-500">{formatARS(line.price)} c/u</div>
                    </div>
                    <button
                      onClick={() => removeLine(line.productId)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                        onClick={() => updateQty(line.productId, line.qty - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="999999"
                        className="h-8 w-16 rounded-md border border-slate-200 text-center text-sm"
                        value={line.qty}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          if (v > 999999) {
                            toast.error('Cantidad máxima: 999.999');
                            return;
                          }
                          updateQty(line.productId, v);
                        }}
                      />
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"
                        onClick={() => {
                          if (line.qty >= 999999) return;
                          updateQty(line.productId, line.qty + 1);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex-1" />
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {formatARS(lineSubtotal(line.price, line.qty, line.discount))}
                      </div>
                      {line.discount > 0 && (
                        <div className="text-xs text-red-600">-{formatARS(line.discount)}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="text-[10px] uppercase text-slate-400">
                      Descuento línea
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-7 flex-1 rounded-md border border-slate-200 px-2 text-xs"
                        value={
                          lineDiscountInputs[line.productId] ??
                          (line.discount > 0 ? String(line.discount) : '')
                        }
                        onChange={(e) =>
                          applyLineDiscount(
                            line.productId,
                            e.target.value,
                            lineDiscountModes[line.productId] ?? 'amount',
                          )
                        }
                      />
                      <DiscountModeToggle
                        mode={lineDiscountModes[line.productId] ?? 'amount'}
                        onChange={(mode) =>
                          applyLineDiscount(
                            line.productId,
                            lineDiscountInputs[line.productId] ?? '',
                            mode,
                          )
                        }
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs text-slate-600">Desc. global</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="h-8 w-28 text-sm"
              value={globalDiscountInput || (discount > 0 ? String(discount) : '')}
              onChange={(e) => applyGlobalDiscount(e.target.value, globalDiscountMode)}
            />
            <DiscountModeToggle
              mode={globalDiscountMode}
              onChange={(mode) => applyGlobalDiscount(globalDiscountInput, mode)}
            />
          </div>
          <div className="mb-1 flex items-center justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{formatARS(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="mb-1 flex items-center justify-between text-sm text-red-600">
              <span>Descuento</span>
              <span>-{formatARS(discount)}</span>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between font-display text-lg font-bold text-navy">
            <span>Total</span>
            <span className="tabular-nums">{formatARS(total)}</span>
          </div>
          {!openRegister && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Caja cerrada — abrila desde <strong>Caja</strong> para registrar la venta.
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={lines.length === 0 || !openRegister}
            onClick={() => setPayModal(true)}
          >
            Cobrar {formatARS(total)}  <span className="opacity-60 text-xs">F4</span>
          </Button>
        </div>
      </section>

      {/* Product picker */}
      <section className="order-1 flex min-h-0 flex-1 flex-col p-3 sm:p-4 lg:order-2">
        <form onSubmit={handleBarcode} className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Scan className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              ref={barcodeRef}
              placeholder="Escaneá o escribí código de barras y Enter…"
              className="pl-9"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="lg:hidden"
            onClick={() => {
              primeAudio();
              setScannerOpen(true);
            }}
            aria-label="Escanear con cámara"
          >
            <Camera className="h-4 w-4" />
          </Button>
          <Button type="submit">Agregar</Button>
        </form>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por nombre o código…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-slate-400">
              <Package className="mb-2 h-8 w-8" />
              {search ? 'No hay productos que coincidan.' : 'Cargá productos en la pestaña Productos.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((p) => {
                const qty = stockByProduct.get(p.id) ?? 0;
                const low = qty <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      primeAudio();
                      if (low) {
                        beepError();
                        toast.error(`Sin stock de "${p.name}"`);
                        return;
                      }
                      addProduct(p);
                      beepSuccess();
                    }}
                    disabled={low}
                    className="group flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:shadow-sm"
                  >
                    <div className="mb-2 flex h-20 items-center justify-center rounded-md bg-slate-50 text-slate-300">
                      <Package className="h-8 w-8" />
                    </div>
                    <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-900">
                      {p.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <div className="font-bold tabular-nums text-brand-700">{formatARS(p.price)}</div>
                      <div
                        className={
                          'text-xs tabular-nums ' +
                          (low ? 'text-red-600' : qty < 5 ? 'text-amber-600' : 'text-slate-500')
                        }
                      >
                        {qty} u.
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <PaymentModal
        open={payModal}
        onClose={() => setPayModal(false)}
        total={total}
        mpReady={mpReady}
        tenantTaxCondition={tenant?.taxCondition ?? null}
        onCompleted={(sale) => {
          setPayModal(false);
          clear();
          setLastSale(sale);
          setRefreshKey((k) => k + 1);
          toast.success('Venta registrada');
        }}
        onPayWithQR={(items, globalDiscount, amount) => {
          setPayModal(false);
          setQrCharge({ items, discount: globalDiscount, amount });
        }}
      />
      {qrCharge && activeBranchId && (
        <QRPaymentModal
          open
          branchId={activeBranchId}
          registerId={openRegister?.id ?? null}
          items={qrCharge.items}
          discount={qrCharge.discount}
          amount={qrCharge.amount}
          onClose={() => setQrCharge(null)}
          onPaid={(sale) => {
            setQrCharge(null);
            clear();
            setLastSale(sale);
            setRefreshKey((k) => k + 1);
            toast.success('Cobro QR confirmado');
          }}
        />
      )}
      <ReceiptModal sale={lastSale} tenant={tenant} onClose={() => setLastSale(null)} />
      <BarcodeScanner
        open={scannerOpen}
        onDetected={handleScannerDetected}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}

function DiscountModeToggle({
  mode,
  onChange,
}: {
  mode: DiscountMode;
  onChange: (mode: DiscountMode) => void;
}) {
  return (
    <div className="inline-flex h-7 overflow-hidden rounded-md border border-slate-300 bg-white text-[11px]">
      <button
        type="button"
        onClick={() => onChange('amount')}
        className={cn(
          'px-2 font-semibold transition',
          mode === 'amount' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100',
        )}
        title="Monto en pesos"
      >
        $
      </button>
      <button
        type="button"
        onClick={() => onChange('percent')}
        className={cn(
          'px-2 font-semibold transition',
          mode === 'percent' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100',
        )}
        title="Porcentaje"
      >
        %
      </button>
    </div>
  );
}

interface PayProps {
  open: boolean;
  onClose: () => void;
  total: number;
  /** Si true, ofrecemos cobrar con QR cuando el único método es 'qr'. */
  mpReady?: boolean;
  /** Condición IVA del tenant emisor para previsualizar la letra de factura. */
  tenantTaxCondition: TaxCondition | null;
  onCompleted: (sale: Sale) => void;
  /** Se llama cuando se elige cobrar 100% por QR con MP conectado. */
  onPayWithQR?: (
    items: { productId: string; qty: number; price: number; discount: number; name?: string }[],
    discount: number,
    amount: number,
  ) => void;
}

function PaymentModal({ open, onClose, total, mpReady, tenantTaxCondition, onCompleted, onPayWithQR }: PayProps) {
  const { session, activeBranchId } = useAuth();
  const { lines, discount } = useCart();
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([
    { method: 'cash', amount: total },
  ]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receiver, setReceiver] = useState<SaleReceiver | null>(null);
  const [receiverModalOpen, setReceiverModalOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setPayments([{ method: 'cash', amount: total }]);
      setPartial(false);
      setReceiver(null);
    }
  }, [open, total]);

  // Previsualización de la letra de factura para el cajero.
  const letterPreview = tenantTaxCondition
    ? determineCbteLetter(tenantTaxCondition, receiver)
    : null;

  const summary = summarizeSale(lines, discount, payments);
  const paid = summary.paid;
  const diff = summary.diff;
  const exact = summary.exact;
  // En modo seña, "OK para confirmar" es: paid > 0 y paid <= total.
  const canConfirmPartial = paid > 0 && paid <= total;
  const canConfirm = partial ? canConfirmPartial : exact;
  const remaining = Math.max(total - paid, 0);

  function setRow(i: number, field: 'method' | 'amount', value: string) {
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

  // Si todos los pagos son QR + MP conectado + no es seña → redirigimos
  // al flow de QRPaymentModal en lugar de crear la sale localmente.
  const isFullQR =
    !partial &&
    mpReady &&
    payments.length > 0 &&
    payments.every((p) => p.method === 'qr');

  async function handleConfirm() {
    if (!session || !activeBranchId) return;

    if (isFullQR && onPayWithQR) {
      onPayWithQR(
        lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          price: l.price,
          discount: l.discount,
          name: l.name,
        })),
        discount,
        total,
      );
      return;
    }

    setLoading(true);
    try {
      const reg = await data.currentOpenRegister(activeBranchId);
      const saleInput = buildSaleFromCart({
        branchId: activeBranchId,
        registerId: reg?.id ?? null,
        lines,
        globalDiscount: discount,
        payments,
        partial,
        receiver,
      });
      const sale = await data.createSale(saleInput);
      onCompleted(sale);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cobrar" widthClass="max-w-md">
      <div className="mb-3 rounded-lg bg-ice p-4 text-center">
        <div className="eyebrow text-cyan">Total a cobrar</div>
        <div className="font-display text-3xl font-bold tabular-nums text-navy">{formatARS(total)}</div>
        {letterPreview?.letter && (
          <div className="mt-1 text-[11px] text-slate-600">
            Se va a emitir <strong>Factura {letterPreview.letter}</strong>
          </div>
        )}
      </div>

      {/* Receptor (opcional). Si no se selecciona, queda como consumidor final anónimo. */}
      <div className="mb-3 rounded-lg border border-slate-200 p-2.5 text-sm">
        {receiver ? (
          <div className="flex items-start gap-2">
            <UserCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-navy">{receiver.legalName}</div>
              <div className="text-[11px] text-slate-500">
                {receiver.docType === 80 ? 'CUIT' : receiver.docType === 86 ? 'CUIL' : 'DNI'}{' '}
                {receiver.docNumber}
              </div>
            </div>
            <button
              onClick={() => setReceiver(null)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
              title="Quitar cliente"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReceiverModalOpen(true)}
            className="flex w-full items-center gap-2 text-left text-slate-600 hover:text-navy"
          >
            <UserPlus className="h-4 w-4" />
            <span>Identificar cliente (opcional)</span>
          </button>
        )}
      </div>

      <div className="space-y-2">
        {payments.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={p.method}
              onChange={(e) => setRow(i, 'method', e.target.value)}
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
              className="h-10 w-32 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm"
              value={p.amount}
              onChange={(e) => setRow(i, 'amount', e.target.value)}
            />
            {payments.length > 1 && (
              <button
                className="text-slate-400 hover:text-red-600"
                onClick={() => setPayments((ps) => ps.filter((_, idx) => idx !== i))}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          className="text-xs text-brand-600 hover:underline"
          onClick={() =>
            setPayments((ps) => [...ps, { method: 'cash', amount: Math.max(0, diff) }])
          }
        >
          + Agregar pago
        </button>
      </div>

      <label className="my-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) => setPartial(e.target.checked)}
          className="h-4 w-4"
        />
        <span>
          <strong>Es seña</strong>
          <span className="block text-xs text-slate-500">
            El cliente paga una parte ahora y el resto queda como saldo pendiente.
          </span>
        </span>
      </label>

      <div className="my-4 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>Pagado</span>
          <span className="font-semibold">{formatARS(paid)}</span>
        </div>
        {partial ? (
          <div className="flex justify-between text-amber-700">
            <span>Saldo pendiente</span>
            <span className="font-semibold">{formatARS(remaining)}</span>
          </div>
        ) : (
          <div
            className={
              'flex justify-between ' +
              (exact
                ? 'text-emerald-700'
                : diff > 0
                  ? 'text-red-700'
                  : 'text-amber-700')
            }
          >
            <span>{exact ? 'Exacto' : diff > 0 ? 'Falta' : 'Vuelto'}</span>
            <span className="font-semibold">{formatARS(Math.abs(diff))}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={loading || !canConfirm}
        >
          {loading ? 'Procesando…' : partial ? `Cobrar seña ${formatARS(paid)}` : 'Confirmar'}
        </Button>
      </div>

      <ReceiverSelectorModal
        open={receiverModalOpen}
        onClose={() => setReceiverModalOpen(false)}
        onConfirm={(r) => setReceiver(r)}
      />
    </Modal>
  );
}
