import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  Wallet,
  X,
} from 'lucide-react';
import { ReceiverSelectorModal } from '@/components/pos/ReceiverSelectorModal';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { VariantPickerModal } from '@/components/pos/VariantPickerModal';
import { determineCbteLetter } from '@/lib/afipLetter';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { data } from '@/data';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { useCart, cartTotals } from '@/stores/cart';
import { confirmDialog } from '@/lib/dialog';
import { formatARS } from '@/lib/currency';
import { lineSubtotal, roundMoney, applyDiscount, type DiscountMode } from '@/lib/money';
import { cn } from '@/lib/utils';
import { buildSaleFromCart, summarizeSale } from '@/lib/sales';
import { beepError, beepSuccess, primeAudio } from '@/lib/sound';
import { toast } from '@/stores/toast';
import { PAYMENT_METHODS, type BusinessMode, type PaymentMethod, type PaymentMethodConfig, type Product, type ProductVariant, type Sale, type SaleReceiver, type TaxCondition, type Tenant } from '@/types';
import { QRPaymentModal } from '@/components/ui/QRPaymentModal';

export default function Pos() {
  const { session, activeBranchId } = useAuth();
  const {
    lines,
    discount,
    addProduct,
    updateQty,
    updatePrice,
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

  // Stock por variantId (cuando el driver lo populé). Para el VariantPickerModal.
  const stockByVariant = useMemo(() => {
    const map = new Map<string, number>();
    (stock ?? []).forEach((s) => {
      if (s.variantId) map.set(s.variantId, s.qty);
    });
    return map;
  }, [stock]);

  // --- Cache de variantes por sesión (Sprint VAR) ---
  // Mapa productId -> variantes. Se llena bajo demanda en addProductFlow.
  const variantsByProduct = useRef<Map<string, ProductVariant[]>>(new Map());
  // Mapa productId -> variantId elegida para esa línea del carrito. Lo
  // mantenemos paralelo al store del carrito (que sigue indexando por
  // productId) para poder mandar el variantId correcto en createSale.
  // LIMITACIÓN: como el cart deduplica por productId, no podemos tener
  // dos variantes distintas del mismo producto en líneas separadas. Un
  // segundo "add" de otra variante pisa la primera. TODO: revisar tras
  // adaptación del cart store en sprint posterior.
  const [variantIdByProduct, setVariantIdByProduct] = useState<Record<string, string>>({});

  // Estado del modal de selección de variante.
  const [variantPicker, setVariantPicker] = useState<{
    product: Product;
    variants: ProductVariant[];
  } | null>(null);

  // --- Sprint PRC: lista de precios activa ---
  // Receiver compartido entre Pos y PaymentModal. Lo levantamos acá para poder
  // determinar la lista de precios efectiva al agregar productos al carrito
  // (antes de abrir el modal de cobro).
  const [receiver, setReceiver] = useState<SaleReceiver | null>(null);
  // priceListId que el sistema usa para resolver precios. Cae por cascada:
  // customer.priceListId -> tenant default -> null (cascada del backend).
  const [activePriceListId, setActivePriceListId] = useState<string | null>(null);
  // Nombre de la lista activa (para mostrar en UI). Cargado cuando cambia.
  const [activePriceListName, setActivePriceListName] = useState<string | null>(null);

  // Carga la lista default del tenant si todavía no hay receiver.
  useEffect(() => {
    if (!session || receiver?.customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const lists = await data.listPriceLists({ activeOnly: true });
        if (cancelled) return;
        const def = lists.find((l) => l.isDefault) ?? null;
        setActivePriceListId(def?.id ?? null);
        setActivePriceListName(def?.name ?? null);
      } catch {
        // No bloqueamos: el backend resuelve cascada igualmente si pasamos null.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, receiver?.customerId]);

  // Cuando el receiver tiene customerId, leemos su lista asignada (puede ser null
  // si usa la default del comercio).
  useEffect(() => {
    if (!receiver?.customerId) return;
    let cancelled = false;
    const customerId = receiver.customerId;
    (async () => {
      try {
        const [customer, lists] = await Promise.all([
          data.getCustomer(customerId),
          data.listPriceLists({ activeOnly: true }),
        ]);
        if (cancelled) return;
        const target = customer?.priceListId
          ? lists.find((l) => l.id === customer.priceListId) ?? null
          : lists.find((l) => l.isDefault) ?? null;
        setActivePriceListId(target?.id ?? null);
        setActivePriceListName(target?.name ?? null);
      } catch {
        // Silencioso: el POS sigue funcionando con cascada del backend.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receiver?.customerId]);

  /**
   * Recalcula los precios de todas las líneas del carrito según la lista
   * activa. Lo usamos cuando el cajero cambia el cliente mid-cart.
   */
  const recalcCartPrices = useCallback(
    async (priceListId: string | null) => {
      if (lines.length === 0) return;
      try {
        const updates = await Promise.all(
          lines.map(async (line) => {
            const variantId = variantIdByProduct[line.productId];
            const newPrice = await data.getEffectivePrice({
              productId: line.productId,
              variantId: variantId ?? null,
              priceListId,
            });
            return { productId: line.productId, price: newPrice };
          }),
        );
        for (const u of updates) {
          updatePrice(u.productId, u.price);
        }
        toast.success('Precios recalculados');
      } catch (err) {
        toast.error(`No se pudieron recalcular los precios: ${(err as Error).message}`);
      }
    },
    [lines, updatePrice],
    // variantIdByProduct se lee de cierre pero no lo pongo en deps porque
    // los precios se recalculan justo después de cambiar el receiver y
    // las líneas siempre traen su variantId ya bindeado.
  );

  // Cuando cambia el receiver (y por ende activePriceListId), si ya hay items
  // en el carrito, ofrecer recalcular. NO recalculamos automático porque puede
  // ser una decisión del cajero (el cliente puede haber acordado un precio
  // distinto al de la lista).
  const lastReceiverCustomerId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentCustomerId = receiver?.customerId ?? null;
    // Skip primera ejecución (cuando todavía no se "cambió" nada).
    if (lastReceiverCustomerId.current === undefined) {
      lastReceiverCustomerId.current = currentCustomerId;
      return;
    }
    if (lastReceiverCustomerId.current === currentCustomerId) return;
    lastReceiverCustomerId.current = currentCustomerId;
    if (lines.length === 0) return;
    // Pregunta async: no podemos await directo en el effect, lo encapsulamos.
    (async () => {
      const ok = await confirmDialog('Cambió la lista de precios del carrito', {
        text:
          'El cliente que seleccionaste puede tener precios distintos. ¿Querés recalcular los ' +
          'precios del carrito con la lista activa?',
        confirmText: 'Recalcular',
        cancelText: 'Mantener precios',
        icon: 'question',
      });
      if (ok) {
        await recalcCartPrices(activePriceListId);
      }
    })();
    // recalcCartPrices y activePriceListId cambian juntos; quedamos pegados al
    // customerId que es la fuente real del cambio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiver?.customerId]);

  const [receiverModalOpen, setReceiverModalOpen] = useState(false);

  /** Agrega una variante concreta al carrito y registra el mapping.
   *  Sprint PRC: resuelve el precio efectivo según la lista activa (cliente o
   *  default del tenant). Si la llamada falla, hace fallback a la cascada local
   *  (variant.priceOverride > product.price) para no bloquear la venta. */
  const addVariantToCart = useCallback(
    async (product: Product, variant: ProductVariant) => {
      let effectivePrice: number = variant.priceOverride ?? product.price;
      try {
        effectivePrice = await data.getEffectivePrice({
          productId: product.id,
          variantId: variant.id,
          priceListId: activePriceListId,
        });
      } catch {
        // Fallback silencioso al precio local. El cajero puede ajustar a mano.
      }
      const productForCart: Product = {
        ...product,
        price: effectivePrice,
      };
      // El display name incluye los atributos para distinguir en el carrito.
      const attrs = Object.entries(variant.attributes)
        .map(([, v]) => v)
        .join(' ');
      if (attrs) {
        productForCart.name = `${product.name} — ${attrs}`;
      }
      addProduct(productForCart);
      setVariantIdByProduct((prev) => ({ ...prev, [product.id]: variant.id }));
      beepSuccess();
    },
    [addProduct, activePriceListId],
  );

  /**
   * Flow de agregar producto al carrito.
   * - Si el producto es "simple" (1 sola variante con attributes={}) →
   *   se agrega directo, sin modal (caso 99% de kioscos).
   * - Sino → abre VariantPickerModal.
   */
  const addProductFlow = useCallback(
    async (product: Product) => {
      try {
        // Cache hit / miss.
        let variants = variantsByProduct.current.get(product.id);
        if (!variants) {
          variants = await data.listVariants(product.id);
          variantsByProduct.current.set(product.id, variants);
        }
        const activeVariants = variants.filter((v) => v.active);
        if (activeVariants.length === 0) {
          beepError();
          toast.error(`"${product.name}" no tiene variantes activas`);
          return;
        }
        // Bypass del modal para el caso simple.
        if (
          activeVariants.length === 1 &&
          Object.keys(activeVariants[0].attributes).length === 0
        ) {
          await addVariantToCart(product, activeVariants[0]);
          return;
        }
        setVariantPicker({ product, variants });
      } catch (err) {
        beepError();
        toast.error((err as Error).message);
      }
    },
    [addVariantToCart],
  );

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
      // Sprint VAR: el código puede identificar una variante específica.
      // Si matchea, agregamos esa variante directo (no abrimos el picker).
      const match = await data.findVariantByCode(code);
      if (!match) {
        beepError();
        toast.error(`Sin resultado para "${code}"`);
        return;
      }
      const { product, variant } = match;
      // Cacheamos en caliente: si después se busca el mismo product, no
      // re-pegamos al backend.
      const cached = variantsByProduct.current.get(product.id);
      if (!cached || !cached.some((v) => v.id === variant.id)) {
        // Refrescamos las variantes del producto para mantener el cache sano.
        try {
          const fresh = await data.listVariants(product.id);
          variantsByProduct.current.set(product.id, fresh);
        } catch {
          // Si falla, al menos guardamos la que vino del match.
          variantsByProduct.current.set(product.id, cached ?? [variant]);
        }
      }
      const stockQty = variant.id
        ? stockByVariant.get(variant.id) ?? stockByProduct.get(product.id) ?? 0
        : stockByProduct.get(product.id) ?? 0;
      if (stockQty <= 0) {
        beepError();
        toast.error(`Sin stock de "${product.name}"`);
        return;
      }
      addVariantToCart(product, variant);
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clear();
                setVariantIdByProduct({});
              }}
            >
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
                      // Sprint VAR: abre picker si tiene variantes; sino, bypass.
                      void addProductFlow(p);
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
        businessMode={tenant?.businessMode ?? 'kiosk'}
        creditSalesEnabled={tenant?.creditSalesEnabled ?? false}
        variantIdByProduct={variantIdByProduct}
        receiver={receiver}
        onReceiverChange={setReceiver}
        receiverModalOpen={receiverModalOpen}
        onReceiverModalChange={setReceiverModalOpen}
        activePriceListName={activePriceListName}
        onCompleted={(sale) => {
          setPayModal(false);
          clear();
          setVariantIdByProduct({});
          setReceiver(null);
          setLastSale(sale);
          setRefreshKey((k) => k + 1);
          toast.success('Venta registrada');
        }}
        onPayWithQR={(items, globalDiscount, amount) => {
          setPayModal(false);
          setQrCharge({ items, discount: globalDiscount, amount });
        }}
      />
      <VariantPickerModal
        open={variantPicker !== null}
        product={variantPicker?.product ?? null}
        variants={variantPicker?.variants ?? []}
        stockByVariant={stockByVariant}
        onClose={() => setVariantPicker(null)}
        onPick={(variant) => {
          if (!variantPicker) return;
          void addVariantToCart(variantPicker.product, variant);
          setVariantPicker(null);
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
            setVariantIdByProduct({});
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
  /** Modo del negocio. En retail mostramos un CTA prominente de "Identificar cliente". */
  businessMode: BusinessMode;
  /** Sprint FIA: si está habilitado, ofrecemos pago "Cuenta corriente". */
  creditSalesEnabled: boolean;
  /** Map productId -> variantId elegida (Sprint VAR). */
  variantIdByProduct: Record<string, string>;
  /** Sprint PRC: receiver compartido con Pos para resolver lista de precios. */
  receiver: SaleReceiver | null;
  onReceiverChange: (r: SaleReceiver | null) => void;
  receiverModalOpen: boolean;
  onReceiverModalChange: (open: boolean) => void;
  /** Sprint PRC: nombre de la lista de precios activa, para mostrar como hint. */
  activePriceListName: string | null;
  onCompleted: (sale: Sale) => void;
  /** Se llama cuando se elige cobrar 100% por QR con MP conectado. */
  onPayWithQR?: (
    items: { productId: string; qty: number; price: number; discount: number; name?: string }[],
    discount: number,
    amount: number,
  ) => void;
}

/**
 * Sprint PMP: una fila de pago dentro del PaymentModal.
 *
 * - `amount` ya incluye el recargo. Es lo que el cajero cobra al cliente.
 * - `surchargeAmount` es la parte del amount que corresponde al recargo del
 *   medio configurado. Se manda explícito al backend; el server valida que
 *   `sum(amount) == subtotal - discount + sum(surchargeAmount)`.
 * - `methodConfigId` apunta al PaymentMethodConfig (si el cajero eligió uno).
 *   Cuando es null, el pago va sin recargo (usa el método base).
 */
interface PaymentRow {
  method: PaymentMethod;
  amount: number;
  surchargeAmount: number;
  methodConfigId: string | null;
}

/**
 * Calcula el recargo en pesos para un base dado y un % de recargo.
 * Redondea a centavos para que la suma cuadre con la validación del backend.
 */
function calcSurcharge(baseAmount: number, pct: number): number {
  if (!Number.isFinite(baseAmount) || !Number.isFinite(pct) || pct === 0) return 0;
  return roundMoney((baseAmount * pct) / 100);
}

function PaymentModal({ open, onClose, total, mpReady, tenantTaxCondition, businessMode, creditSalesEnabled, variantIdByProduct, receiver, onReceiverChange, receiverModalOpen, onReceiverModalChange, activePriceListName, onCompleted, onPayWithQR }: PayProps) {
  const { session, activeBranchId } = useAuth();
  const { lines, discount } = useCart();
  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: 'cash', amount: total, surchargeAmount: 0, methodConfigId: null },
  ]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sprint PMP — medios configurados (cargados al abrir el modal). Si está
  // vacío, el select muestra solo los métodos base sin recargo.
  const [methodConfigs, setMethodConfigs] = useState<PaymentMethodConfig[]>([]);

  // Saldo a favor del cliente seleccionado (Sprint DEV). Solo se carga si el
  // receiver tiene customerId (los receptores inline / ad-hoc no tienen fila
  // en customers, entonces no tienen saldo). Por ahora SOLO se muestra como
  // info — aplicar el saldo desde el POS requiere un endpoint server-side
  // atómico (descontar credit + crear sale en una sola RPC). Queda pendiente
  // para un sprint posterior.
  // DEV Pieza C: aplicar saldo desde el POS requiere integración server-side,
  // queda para sprint siguiente.
  const [customerCreditBalance, setCustomerCreditBalance] = useState<number>(0);

  useEffect(() => {
    if (open) {
      setPayments([{ method: 'cash', amount: total, surchargeAmount: 0, methodConfigId: null }]);
      setPartial(false);
      setCustomerCreditBalance(0);
      // Sprint PRC: NO reseteamos el receiver al abrir el modal. El receiver
      // ahora vive en Pos para que la lista de precios siga activa al agregar
      // productos. Se limpia desde Pos cuando se concreta la venta.
    }
  }, [open, total]);

  // Sprint PMP — cargar la lista de medios configurados al abrir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await data.listPaymentMethods({ activeOnly: true });
        if (!cancelled) setMethodConfigs(list);
      } catch {
        // Silencioso: si falla, caemos al comportamiento original (solo base).
        if (!cancelled) setMethodConfigs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Refrescar saldo cuando cambia el receiver seleccionado.
  useEffect(() => {
    if (!open || !receiver?.customerId) {
      setCustomerCreditBalance(0);
      return;
    }
    let cancelled = false;
    const customerId = receiver.customerId;
    (async () => {
      try {
        const credit = await data.getCustomerCredit(customerId);
        if (!cancelled) setCustomerCreditBalance(credit?.balance ?? 0);
      } catch {
        // No bloqueamos el cobro si falla el lookup del saldo.
        if (!cancelled) setCustomerCreditBalance(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, receiver?.customerId]);

  // Previsualización de la letra de factura para el cajero.
  const letterPreview = tenantTaxCondition
    ? determineCbteLetter(tenantTaxCondition, receiver)
    : null;

  // Sprint PMP — el total que el cajero cobra incluye los recargos por medio
  // de pago. summarizeSale calcula el total "limpio" (subtotal-discount) y
  // valida exact match con paid; nosotros validamos contra totalWithSurcharge.
  // Mantenemos la llamada para reusar summary.subtotal en el breakdown.
  const summary = summarizeSale(lines, discount, payments.map((p) => ({ method: p.method, amount: p.amount })));
  const surchargeTotal = roundMoney(
    payments.reduce((acc, p) => acc + (p.surchargeAmount || 0), 0),
  );
  const totalWithSurcharge = roundMoney(total + surchargeTotal);

  // paid en este modal = suma de payments.amount (que ya incluyen recargo).
  const paid = roundMoney(payments.reduce((acc, p) => acc + (p.amount || 0), 0));
  const diff = roundMoney(totalWithSurcharge - paid);
  const exact = Math.abs(diff) < 0.005;
  // En modo seña, "OK para confirmar" es: paid > 0 y paid <= totalWithSurcharge.
  const canConfirmPartial = paid > 0 && paid <= totalWithSurcharge + 0.005;
  const canConfirm = partial ? canConfirmPartial : exact;
  const remaining = Math.max(roundMoney(totalWithSurcharge - paid), 0);

  /**
   * Sprint PMP — cambia el método base del pago (efectivo, débito, crédito, etc).
   * Si la base cambia y el config asignado no pertenece a la nueva base, se
   * limpia el config + surcharge. El amount queda en su valor base.
   */
  function setRowBase(i: number, value: PaymentMethod) {
    setPayments((ps) =>
      ps.map((p, idx) => {
        if (idx !== i) return p;
        const baseAmount = roundMoney(p.amount - (p.surchargeAmount || 0));
        // Si el config actual coincide con la nueva base, lo mantenemos.
        const currentCfg = p.methodConfigId
          ? methodConfigs.find((m) => m.id === p.methodConfigId)
          : null;
        if (currentCfg && currentCfg.paymentMethodBase === value) {
          return { ...p, method: value };
        }
        return {
          method: value,
          amount: baseAmount,
          surchargeAmount: 0,
          methodConfigId: null,
        };
      }),
    );
  }

  /**
   * Sprint PMP — asigna o limpia un plan/terminal (PaymentMethodConfig) sobre
   * el método base actual. Si `cfgId` es null, vuelve al precio sin recargo.
   * Si es un id válido y la base coincide, aplica el recargo del config.
   */
  function setRowConfig(i: number, cfgId: string | null) {
    setPayments((ps) =>
      ps.map((p, idx) => {
        if (idx !== i) return p;
        const baseAmount = roundMoney(p.amount - (p.surchargeAmount || 0));
        if (cfgId == null) {
          return { ...p, amount: baseAmount, surchargeAmount: 0, methodConfigId: null };
        }
        const cfg = methodConfigs.find((m) => m.id === cfgId);
        if (!cfg || cfg.paymentMethodBase !== p.method) return p;
        const newSurcharge = calcSurcharge(baseAmount, cfg.surchargePct);
        return {
          ...p,
          amount: roundMoney(baseAmount + newSurcharge),
          surchargeAmount: newSurcharge,
          methodConfigId: cfg.id,
        };
      }),
    );
  }

  /**
   * Sprint PMP — el cajero edita el monto. Interpretamos lo que escribe como
   * el "amount con recargo" (lo que cobra). Recalculamos el surcharge desde
   * el config asignado a esa fila (si lo hubiere) para que la suma cuadre.
   *
   * Edge case: si el config tiene recargo y el cajero edita el monto, mantenemos
   * el % del recargo aplicado sobre la nueva base. La base se infiere del amount
   * editado: base = amount / (1 + pct/100).
   */
  function setRowAmount(i: number, value: string) {
    const newAmount = roundMoney(Number(value) || 0);
    setPayments((ps) =>
      ps.map((p, idx) => {
        if (idx !== i) return p;
        if (p.methodConfigId == null) {
          return { ...p, amount: newAmount, surchargeAmount: 0 };
        }
        const cfg = methodConfigs.find((m) => m.id === p.methodConfigId);
        if (!cfg || cfg.surchargePct === 0) {
          return { ...p, amount: newAmount, surchargeAmount: 0 };
        }
        // Invertir: amount = base + base * pct/100 → base = amount / (1 + pct/100).
        const base = roundMoney(newAmount / (1 + cfg.surchargePct / 100));
        const surcharge = roundMoney(newAmount - base);
        return { ...p, amount: newAmount, surchargeAmount: surcharge };
      }),
    );
  }

  // Si todos los pagos son QR base + MP conectado + no es seña + sin recargo →
  // redirigimos al flow de QRPaymentModal en lugar de crear la sale localmente.
  // Si hay surcharge, el QR flow server-side no lo soporta — caemos al
  // createSale local.
  const isFullQR =
    !partial &&
    mpReady &&
    surchargeTotal === 0 &&
    payments.length > 0 &&
    payments.every((p) => p.method === 'qr' && p.methodConfigId == null);

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
      // buildSaleFromCart valida que sum(payments.amount) == subtotal - discount.
      // Con recargos, payments.amount incluye surcharge → la validación falla.
      // Truco: pasamos los "base amounts" (sin surcharge) para que la validación
      // pase, y después re-inyectamos surchargeAmount + methodConfigId + amount
      // real antes de mandar al backend.
      const paymentsBase = payments.map((p) => ({
        method: p.method,
        amount: roundMoney(p.amount - (p.surchargeAmount || 0)),
      }));
      const saleInput = buildSaleFromCart({
        branchId: activeBranchId,
        registerId: reg?.id ?? null,
        lines,
        globalDiscount: discount,
        payments: paymentsBase,
        partial,
        receiver,
      });
      // Sprint VAR: enriquecer items con variantId desde el lookup local.
      // buildSaleFromCart no lo conoce, así que lo inyectamos acá.
      saleInput.items = saleInput.items.map((it) => ({
        ...it,
        variantId: variantIdByProduct[it.productId],
      }));
      // Sprint PMP — re-inyectar amount (con surcharge) + surchargeAmount +
      // methodConfigId. El backend valida sum(amount) = subtotal - discount + surchargeTotal.
      saleInput.payments = payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        surchargeAmount: p.surchargeAmount || 0,
        methodConfigId: p.methodConfigId,
      }));
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
        <div className="font-display text-3xl font-bold tabular-nums text-navy">
          {formatARS(totalWithSurcharge)}
        </div>
        {surchargeTotal !== 0 && (
          <div className="mt-1 text-[11px] text-slate-600">
            Incluye{' '}
            {surchargeTotal > 0 ? 'recargo' : 'descuento'} de{' '}
            <strong>{formatARS(Math.abs(surchargeTotal))}</strong> por medio de pago
          </div>
        )}
        {letterPreview?.letter && (
          <div className="mt-1 text-[11px] text-slate-600">
            Se va a emitir <strong>Factura {letterPreview.letter}</strong>
          </div>
        )}
      </div>

      {/* Receptor (opcional). Si no se selecciona, queda como consumidor final anónimo.
          Sprint CRM-RETAIL: en modo retail mostramos el CTA prominente con colores
          brand para empujar al cajero a identificar al cliente (lo necesita para
          historial, fidelidad, etc.). En kiosco queda discreto. */}
      <div
        className={
          'mb-3 rounded-lg text-sm ' +
          (!receiver && businessMode === 'retail'
            ? 'border-2 border-brand-300 bg-brand-50 p-3'
            : 'border border-slate-200 p-2.5')
        }
      >
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
              onClick={() => onReceiverChange(null)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
              title="Quitar cliente"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : businessMode === 'retail' ? (
          <button
            type="button"
            onClick={() => onReceiverModalChange(true)}
            className="flex w-full items-center gap-2 text-left font-semibold text-brand-700 hover:text-brand-800"
          >
            <UserPlus className="h-5 w-5 shrink-0" />
            <span className="flex-1">
              Identificar cliente
              <span className="block text-[11px] font-normal text-brand-600">
                Sumá la venta a su historial.
              </span>
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onReceiverModalChange(true)}
            className="flex w-full items-center gap-2 text-left text-slate-600 hover:text-navy"
          >
            <UserPlus className="h-4 w-4" />
            <span>Identificar cliente (opcional)</span>
          </button>
        )}
      </div>

      {/* Sprint PRC: hint de la lista de precios activa, para que el cajero sepa
          con qué tabla estamos cobrando. */}
      {activePriceListName && (
        <div className="mb-3 text-[11px] text-slate-500">
          Lista de precios activa: <strong>{activePriceListName}</strong>
        </div>
      )}

      {/* Saldo a favor del cliente — solo informativo por ahora (Sprint DEV).
          TODO Sprint DEV.fix: cuando el backend exponga una RPC atómica que
          descuente el customer_credit y cree la sale en la misma transacción,
          agregar un checkbox "Aplicar $X de saldo" que descuente del total y
          quede registrado como pago. Hoy lo mostramos solo como info para que
          el cajero ofrezca compensar manualmente con efectivo o esperar al
          fix. */}
      {receiver?.customerId && customerCreditBalance > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm">
          <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-emerald-800">
              Saldo a favor disponible:{' '}
              <span className="tabular-nums">{formatARS(customerCreditBalance)}</span>
            </div>
            <div className="text-[11px] text-emerald-700">
              Este cliente tiene saldo a favor. Por ahora se aplica desde Devoluciones; aplicar
              al cobro en el POS se habilita en una próxima versión.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {payments.map((p, i) => {
          const cfg = p.methodConfigId
            ? methodConfigs.find((m) => m.id === p.methodConfigId)
            : null;
          // Sprint PMP — configs disponibles para la base elegida. Si hay al
          // menos uno, mostramos el segundo dropdown "Plan / Terminal".
          const configsForBase = methodConfigs.filter(
            (m) => m.paymentMethodBase === p.method,
          );
          // Cuota: si el config tiene installments > 1, mostramos N×$Y c/u.
          const installments = cfg?.installments ?? null;
          const perInstallment =
            installments && installments > 1
              ? roundMoney(p.amount / installments)
              : null;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <select
                  className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  value={p.method}
                  onChange={(e) => setRowBase(i, e.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.filter((m) => {
                    // on_account solo si la feature está habilitada Y hay cliente identificado.
                    if (m.value === 'on_account') {
                      return creditSalesEnabled && Boolean(receiver?.customerId);
                    }
                    return true;
                  }).map((m) => (
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
                  onChange={(e) => setRowAmount(i, e.target.value)}
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
              {/* Sprint PMP — segundo dropdown: planes/terminales para la base
                  elegida. Solo aparece si hay configs activas para esa base. */}
              {configsForBase.length > 0 && (
                <select
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700"
                  value={cfg?.id ?? ''}
                  onChange={(e) => setRowConfig(i, e.target.value || null)}
                >
                  <option value="">Sin plan (precio normal)</option>
                  {configsForBase.map((m) => {
                    const tag =
                      m.surchargePct === 0
                        ? ''
                        : m.surchargePct > 0
                          ? ` (+${m.surchargePct}%)`
                          : ` (${m.surchargePct}%)`;
                    return (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {tag}
                      </option>
                    );
                  })}
                </select>
              )}
              {/* Sprint PMP — desglose: cuotas + recargo aplicado. */}
              {perInstallment !== null && (
                <div className="ml-1 text-[11px] text-slate-600">
                  {installments} cuotas de <strong>{formatARS(perInstallment)}</strong>{' '}
                  c/u
                </div>
              )}
              {p.surchargeAmount > 0 && (
                <div className="ml-1 text-[11px] text-amber-700">
                  Recargo aplicado: <strong>{formatARS(p.surchargeAmount)}</strong>
                  {cfg && cfg.surchargePct !== 0 && <span> ({cfg.surchargePct}%)</span>}
                </div>
              )}
              {p.surchargeAmount < 0 && (
                <div className="ml-1 text-[11px] text-emerald-700">
                  Descuento aplicado: <strong>{formatARS(Math.abs(p.surchargeAmount))}</strong>
                  {cfg && cfg.surchargePct !== 0 && <span> ({cfg.surchargePct}%)</span>}
                </div>
              )}
            </div>
          );
        })}
        <button
          className="text-xs text-brand-600 hover:underline"
          onClick={() =>
            setPayments((ps) => [
              ...ps,
              {
                method: 'cash',
                amount: Math.max(0, diff),
                surchargeAmount: 0,
                methodConfigId: null,
              },
            ])
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

      <div className="my-4 space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatARS(summary.subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Descuento</span>
            <span className="tabular-nums">-{formatARS(discount)}</span>
          </div>
        )}
        {surchargeTotal !== 0 && (
          <div
            className={
              'flex justify-between ' +
              (surchargeTotal > 0 ? 'text-amber-700' : 'text-emerald-700')
            }
          >
            <span>{surchargeTotal > 0 ? 'Recargo' : 'Descuento por medio'}</span>
            <span className="tabular-nums">
              {surchargeTotal > 0 ? '+' : '-'}
              {formatARS(Math.abs(surchargeTotal))}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-display font-bold text-navy">
          <span>Total</span>
          <span className="tabular-nums">{formatARS(totalWithSurcharge)}</span>
        </div>
        <div className="flex justify-between pt-1">
          <span>Pagado</span>
          <span className="font-semibold tabular-nums">{formatARS(paid)}</span>
        </div>
        {partial ? (
          <div className="flex justify-between text-amber-700">
            <span>Saldo pendiente</span>
            <span className="font-semibold tabular-nums">{formatARS(remaining)}</span>
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
            <span className="font-semibold tabular-nums">{formatARS(Math.abs(diff))}</span>
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
        onClose={() => onReceiverModalChange(false)}
        onConfirm={(r) => onReceiverChange(r)}
      />
    </Modal>
  );
}
