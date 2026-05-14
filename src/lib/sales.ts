import type { CartLine } from '@/stores/cart';
import type { SaleInput } from '@/data/driver';
import type { PaymentMethod, SaleReceiver } from '@/types';
import { addMoney, eqMoney, lineSubtotal, subMoney } from './money';

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
}

export interface BuildSaleArgs {
  branchId: string;
  registerId: string | null;
  lines: CartLine[];
  globalDiscount: number;
  payments: PaymentLine[];
  /** Si true, los pagos pueden ser menores al total (seña). */
  partial?: boolean;
  /** Receptor identificado para emitir Factura A/B. null = anónimo. */
  receiver?: SaleReceiver | null;
}

export interface SaleSummary {
  subtotal: number;
  total: number;
  paid: number;
  diff: number;
  exact: boolean;
}

/**
 * Calcula los totales de una venta desde el estado del carrito.
 * Función pura — usada tanto por la UI (POS) como por buildSaleFromCart.
 */
export function summarizeSale(lines: CartLine[], globalDiscount: number, payments: PaymentLine[]): SaleSummary {
  const subtotal = addMoney(...lines.map((l) => lineSubtotal(l.price, l.qty, l.discount)));
  const afterDiscount = subMoney(subtotal, globalDiscount);
  const total = afterDiscount > 0 ? afterDiscount : 0;
  const paid = addMoney(...payments.map((p) => p.amount));
  const diff = subMoney(total, paid);
  return { subtotal, total, paid, diff, exact: eqMoney(paid, total) };
}

/**
 * Construye un SaleInput desde el carrito + valida pre-condiciones.
 * Lanza Error con mensajes en español si algo no cuadra.
 * No persiste — eso lo hace el driver.
 */
export function buildSaleFromCart(args: BuildSaleArgs): SaleInput {
  const { branchId, registerId, lines, globalDiscount, payments, partial, receiver } = args;

  if (!branchId) throw new Error('Seleccioná una sucursal antes de cobrar');
  if (lines.length === 0) throw new Error('El carrito está vacío');
  if (globalDiscount < 0) throw new Error('Descuento global inválido');

  for (const l of lines) {
    if (l.qty <= 0) throw new Error(`Cantidad inválida para "${l.name}"`);
    if (l.price < 0) throw new Error(`Precio inválido para "${l.name}"`);
    if (l.discount < 0) throw new Error(`Descuento inválido para "${l.name}"`);
    if (lineSubtotal(l.price, l.qty, l.discount) < 0) {
      throw new Error(`El descuento de "${l.name}" supera el subtotal de la línea`);
    }
  }

  const summary = summarizeSale(lines, globalDiscount, payments);
  // summary.total se clampea a 0; chequeamos el subtotal real para detectar
  // descuentos abusivos antes de validar pagos.
  if (subMoney(summary.subtotal, globalDiscount) < 0) {
    throw new Error('El descuento global supera el subtotal');
  }
  for (const p of payments) {
    if (p.amount < 0) throw new Error('Los montos de pago no pueden ser negativos');
  }

  if (partial) {
    if (summary.paid <= 0) throw new Error('Una seña requiere al menos un pago');
    if (summary.paid > summary.total) {
      throw new Error('El pago de la seña no puede superar el total');
    }
  } else {
    if (!summary.exact) {
      throw new Error('Los pagos deben cubrir exactamente el total');
    }
  }

  return {
    branchId,
    registerId,
    items: lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      price: l.price,
      discount: l.discount,
    })),
    payments,
    discount: globalDiscount,
    partial: partial ?? false,
    receiver: receiver ?? null,
  };
}
