import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  Camera,
  Minus,
  Package,
  Plus,
  Printer,
  Scan,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { useCart, cartTotals } from '@/stores/cart';
import { formatARS } from '@/lib/currency';
import { lineSubtotal, subMoney } from '@/lib/money';
import { buildSaleFromCart, summarizeSale } from '@/lib/sales';
import { beepError, beepSuccess } from '@/lib/sound';
import { toast } from '@/stores/toast';
import { PAYMENT_METHODS, type PaymentMethod, type Sale } from '@/types';

export default function Pos() {
  const { session, activeDepotId } = useAuth();
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

  const products = useLiveQuery(async () => {
    if (!session) return [];
    return data.listProducts();
  }, [session?.tenantId]);

  const stock = useLiveQuery(async () => {
    if (!activeDepotId) return [];
    return data.listStock(activeDepotId);
  }, [activeDepotId]);

  const openRegister = useLiveQuery(async () => {
    if (!activeDepotId) return null;
    return data.currentOpenRegister(activeDepotId);
  }, [activeDepotId, lines.length]);

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
      const product = await data.findProductByBarcode(code);
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
    setBarcode('');
    await processCode(barcode);
  }

  async function handleScannerDetected(code: string) {
    setScannerOpen(false);
    await processCode(code);
  }

  if (!session || !activeDepotId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-500">
        Seleccioná un depósito activo en la barra lateral.
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
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="h-7 w-full rounded-md border border-slate-200 px-2 text-xs"
                      value={line.discount || ''}
                      onChange={(e) =>
                        updateLineDiscount(line.productId, Number(e.target.value) || 0)
                      }
                    />
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
              className="h-8 w-28 text-sm"
              value={discount || ''}
              onChange={(e) => setGlobalDiscount(Number(e.target.value) || 0)}
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
            onClick={() => setScannerOpen(true)}
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
                      if (low) {
                        toast.error(`Sin stock de "${p.name}"`);
                        return;
                      }
                      addProduct(p);
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
        onCompleted={(sale) => {
          setPayModal(false);
          clear();
          setLastSale(sale);
          toast.success('Venta registrada');
        }}
      />
      <ReceiptModal sale={lastSale} onClose={() => setLastSale(null)} />
      <BarcodeScanner
        open={scannerOpen}
        onDetected={handleScannerDetected}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}

interface PayProps {
  open: boolean;
  onClose: () => void;
  total: number;
  onCompleted: (sale: Sale) => void;
}

function PaymentModal({ open, onClose, total, onCompleted }: PayProps) {
  const { session, activeDepotId } = useAuth();
  const { lines, discount } = useCart();
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([
    { method: 'cash', amount: total },
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setPayments([{ method: 'cash', amount: total }]);
    }
  }, [open, total]);

  const summary = summarizeSale(lines, discount, payments);
  const paid = summary.paid;
  const diff = summary.diff;
  const exact = summary.exact;

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

  async function handleConfirm() {
    if (!session || !activeDepotId) return;
    setLoading(true);
    try {
      const reg = await data.currentOpenRegister(activeDepotId);
      const saleInput = buildSaleFromCart({
        depotId: activeDepotId,
        registerId: reg?.id ?? null,
        lines,
        globalDiscount: discount,
        payments,
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

      <div className="my-4 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>Pagado</span>
          <span className="font-semibold">{formatARS(paid)}</span>
        </div>
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
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={loading || !exact}
        >
          {loading ? 'Procesando…' : 'Confirmar'}
        </Button>
      </div>
    </Modal>
  );
}

function ReceiptModal({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  if (!sale) return null;
  return (
    <Modal open onClose={onClose} title="Ticket" widthClass="max-w-sm">
      <div id="receipt-print" className="font-mono text-xs text-slate-800">
        <div className="text-center">
          <div className="font-bold">TrankaPOS</div>
          <div>Ticket no fiscal</div>
          <div>{new Date(sale.createdAt).toLocaleString('es-AR')}</div>
          <div>#{sale.id.slice(0, 8)}</div>
        </div>
        <hr className="my-2 border-dashed" />
        {sale.items.map((it) => (
          <div key={it.id} className="mb-1">
            <div className="flex justify-between">
              <span className="truncate pr-2">{it.name}</span>
              <span>{formatARS(it.subtotal)}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              {it.qty} × {formatARS(it.price)}
              {it.discount > 0 ? ` (-${formatARS(it.discount)})` : ''}
            </div>
          </div>
        ))}
        <hr className="my-2 border-dashed" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatARS(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>-{formatARS(sale.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatARS(sale.total)}</span>
        </div>
        <hr className="my-2 border-dashed" />
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span className="capitalize">{p.method}</span>
            <span>{formatARS(p.amount)}</span>
          </div>
        ))}
        <hr className="my-2 border-dashed" />
        <div className="text-center">¡Gracias por su compra!</div>
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cerrar
        </Button>
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>
    </Modal>
  );
}
