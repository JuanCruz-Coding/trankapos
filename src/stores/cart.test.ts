import { describe, it, expect } from 'vitest';
import { cartTotals, type CartLine } from './cart';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  name: 'Producto',
  barcode: null,
  price: 100,
  qty: 1,
  discount: 0,
  ...overrides,
});

describe('cartTotals', () => {
  it('carrito vacío da 0', () => {
    expect(cartTotals([], 0)).toEqual({ subtotal: 0, total: 0 });
  });

  it('suma líneas correctamente', () => {
    const lines = [line({ price: 100, qty: 2 }), line({ productId: 'p2', price: 50, qty: 1 })];
    expect(cartTotals(lines, 0)).toEqual({ subtotal: 250, total: 250 });
  });

  it('aplica descuento de línea', () => {
    const lines = [line({ price: 100, qty: 1, discount: 10 })];
    expect(cartTotals(lines, 0)).toEqual({ subtotal: 90, total: 90 });
  });

  it('aplica descuento global', () => {
    const lines = [line({ price: 100, qty: 1 })];
    expect(cartTotals(lines, 20)).toEqual({ subtotal: 100, total: 80 });
  });

  it('total no baja de cero si el descuento global supera el subtotal', () => {
    const lines = [line({ price: 100, qty: 1 })];
    expect(cartTotals(lines, 200)).toEqual({ subtotal: 100, total: 0 });
  });

  it('mantiene precisión con decimales (0.1 + 0.2)', () => {
    const lines = [
      line({ productId: 'a', price: 0.1, qty: 1 }),
      line({ productId: 'b', price: 0.2, qty: 1 }),
    ];
    expect(cartTotals(lines, 0).subtotal).toBe(0.3);
  });
});
