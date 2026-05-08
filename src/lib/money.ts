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
