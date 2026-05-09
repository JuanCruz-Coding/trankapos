import { describe, it, expect } from 'vitest';
import { buildSaleFromCart, summarizeSale } from './sales';
import type { CartLine } from '@/stores/cart';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  name: 'Producto',
  barcode: null,
  price: 100,
  qty: 1,
  discount: 0,
  ...overrides,
});

describe('summarizeSale', () => {
  it('total = subtotal - descuento global', () => {
    const lines = [line({ price: 100, qty: 2 })];
    const r = summarizeSale(lines, 50, [{ method: 'cash', amount: 150 }]);
    expect(r.subtotal).toBe(200);
    expect(r.total).toBe(150);
    expect(r.paid).toBe(150);
    expect(r.exact).toBe(true);
    expect(r.diff).toBe(0);
  });

  it('detecta pagos insuficientes', () => {
    const r = summarizeSale([line({ price: 100, qty: 1 })], 0, [{ method: 'cash', amount: 50 }]);
    expect(r.exact).toBe(false);
    expect(r.diff).toBe(50);
  });

  it('detecta pagos en exceso (vuelto)', () => {
    const r = summarizeSale([line({ price: 100, qty: 1 })], 0, [{ method: 'cash', amount: 150 }]);
    expect(r.exact).toBe(false);
    expect(r.diff).toBe(-50);
  });

  it('total nunca baja de 0 con descuento abusivo', () => {
    const r = summarizeSale([line({ price: 50 })], 200, []);
    expect(r.total).toBe(0);
  });
});

describe('buildSaleFromCart', () => {
  const args = (overrides: Partial<Parameters<typeof buildSaleFromCart>[0]> = {}) => ({
    branchId: 'b1',
    registerId: 'r1',
    lines: [line({ price: 100, qty: 1 })],
    globalDiscount: 0,
    payments: [{ method: 'cash' as const, amount: 100 }],
    ...overrides,
  });

  it('feliz: retorna SaleInput correcto', () => {
    const r = buildSaleFromCart(args());
    expect(r.branchId).toBe('b1');
    expect(r.registerId).toBe('r1');
    expect(r.items).toHaveLength(1);
    expect(r.payments).toEqual([{ method: 'cash', amount: 100 }]);
    expect(r.discount).toBe(0);
  });

  it('falla si no hay sucursal', () => {
    expect(() => buildSaleFromCart(args({ branchId: '' }))).toThrow(/sucursal/i);
  });

  it('falla si el carrito está vacío', () => {
    expect(() => buildSaleFromCart(args({ lines: [] }))).toThrow(/vacío/i);
  });

  it('falla si los pagos no cubren el total', () => {
    expect(() =>
      buildSaleFromCart(args({ payments: [{ method: 'cash', amount: 50 }] })),
    ).toThrow(/pagos/i);
  });

  it('falla con cantidad inválida', () => {
    expect(() => buildSaleFromCart(args({ lines: [line({ qty: 0 })] }))).toThrow(/cantidad/i);
  });

  it('falla con precio negativo', () => {
    expect(() =>
      buildSaleFromCart(args({ lines: [line({ price: -10 })] })),
    ).toThrow(/precio/i);
  });

  it('falla con descuento de línea mayor al subtotal', () => {
    expect(() =>
      buildSaleFromCart(args({ lines: [line({ price: 100, qty: 1, discount: 200 })] })),
    ).toThrow(/descuento/i);
  });

  it('falla con descuento global mayor al subtotal', () => {
    expect(() =>
      buildSaleFromCart(args({ globalDiscount: 200, payments: [{ method: 'cash', amount: 0 }] })),
    ).toThrow(/descuento global/i);
  });

  it('soporta multipago exacto', () => {
    const r = buildSaleFromCart(
      args({
        payments: [
          { method: 'cash', amount: 60 },
          { method: 'debit', amount: 40 },
        ],
      }),
    );
    expect(r.payments).toHaveLength(2);
  });
});

describe('buildSaleFromCart — modo seña (partial)', () => {
  const args = (overrides: Partial<Parameters<typeof buildSaleFromCart>[0]> = {}) => ({
    branchId: 'b1',
    registerId: 'r1',
    lines: [line({ price: 100, qty: 1 })],
    globalDiscount: 0,
    payments: [{ method: 'cash' as const, amount: 100 }],
    ...overrides,
  });

  it('partial=true acepta paid<total y devuelve partial=true', () => {
    const r = buildSaleFromCart(
      args({ partial: true, payments: [{ method: 'cash', amount: 30 }] }),
    );
    expect(r.partial).toBe(true);
    expect(r.payments[0].amount).toBe(30);
  });

  it('partial=true rechaza paid=0', () => {
    expect(() =>
      buildSaleFromCart(args({ partial: true, payments: [{ method: 'cash', amount: 0 }] })),
    ).toThrow(/seña/i);
  });

  it('partial=true rechaza paid>total', () => {
    expect(() =>
      buildSaleFromCart(args({ partial: true, payments: [{ method: 'cash', amount: 200 }] })),
    ).toThrow(/superar el total/i);
  });

  it('partial=true acepta paid==total (se registra como paid normal)', () => {
    const r = buildSaleFromCart(
      args({ partial: true, payments: [{ method: 'cash', amount: 100 }] }),
    );
    // El builder igual devuelve partial=true; el SQL/Local resuelve que termine
    // siendo status=paid si paid==total. Acá solo verificamos que no tira.
    expect(r.partial).toBe(true);
  });

  it('partial=false (default) sigue exigiendo exact', () => {
    expect(() =>
      buildSaleFromCart(args({ payments: [{ method: 'cash', amount: 30 }] })),
    ).toThrow(/exactamente/i);
  });
});
