/**
 * Utilidades de dinero. Para evitar errores de redondeo con floats
 * (ej. 0.1 + 0.2 = 0.30000000000000004), las operaciones críticas se
 * hacen con centavos enteros y luego se vuelven a pesos.
 *
 * Convención: las APIs públicas reciben/devuelven pesos (number con decimales),
 * pero las sumas, restas y comparaciones se hacen vía toCents.
 */

export function toCents(pesos: number): number {
  if (!Number.isFinite(pesos)) return 0;
  return Math.round(pesos * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundMoney(pesos: number): number {
  return fromCents(toCents(pesos));
}

export function addMoney(...values: number[]): number {
  const total = values.reduce((acc, v) => acc + toCents(v), 0);
  return fromCents(total);
}

export function subMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

export function mulMoney(price: number, qty: number): number {
  // Multiplicar centavos enteros por una cantidad (que puede ser fraccional, ej. 1.5 kg)
  // y volver a redondear al entero más cercano para mantener precisión.
  return fromCents(Math.round(toCents(price) * qty));
}

export function eqMoney(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

export function gtMoney(a: number, b: number): boolean {
  return toCents(a) > toCents(b);
}

export function ltMoney(a: number, b: number): boolean {
  return toCents(a) < toCents(b);
}

/**
 * Calcula el subtotal de una línea: precio * cantidad - descuento.
 * Toda la matemática pasa por centavos enteros.
 */
export function lineSubtotal(price: number, qty: number, discount: number): number {
  const gross = Math.round(toCents(price) * qty);
  return fromCents(gross - toCents(discount));
}

export type DiscountMode = 'amount' | 'percent';

/**
 * Convierte un valor de descuento ingresado por el usuario en monto en pesos.
 * - mode 'amount': el valor YA es pesos, lo redondea a centavos.
 * - mode 'percent': el valor es un porcentaje (0..100) sobre `base`. Devuelve base * pct / 100 redondeado.
 *
 * Si el resultado supera `base`, lo recorta a `base` (no permite descuentos negativos en total).
 * Si el valor es negativo, devuelve 0.
 *
 * Esta función es la fuente única de verdad para "qué monto en pesos
 * representa un descuento del usuario", tanto en línea como en global.
 */
export function applyDiscount(value: number, mode: DiscountMode, base: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;
  let amount: number;
  if (mode === 'percent') {
    const pct = Math.min(value, 100);
    amount = fromCents(Math.round((toCents(base) * pct) / 100));
  } else {
    amount = roundMoney(value);
  }
  if (gtMoney(amount, base)) return base;
  return amount;
}
