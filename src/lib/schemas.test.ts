import { describe, it, expect } from 'vitest';
import {
  productSchema,
  userSchema,
  branchSchema,
  warehouseSchema,
  transferSchema,
  safeParse,
} from './schemas';

describe('productSchema', () => {
  const valid = {
    name: 'Coca Cola',
    barcode: '7790895000119',
    price: 1500,
    cost: 800,
    taxRate: 21,
    categoryId: null,
    active: true,
  };

  it('acepta producto válido', () => {
    const r = safeParse(productSchema, valid);
    expect(r.ok).toBe(true);
  });

  it('rechaza nombre vacío', () => {
    const r = safeParse(productSchema, { ...valid, name: '   ' });
    expect(r.ok).toBe(false);
  });

  it('rechaza precio negativo', () => {
    const r = safeParse(productSchema, { ...valid, price: -10 });
    expect(r.ok).toBe(false);
  });

  it('rechaza alícuota fuera de rango', () => {
    expect(safeParse(productSchema, { ...valid, taxRate: -1 }).ok).toBe(false);
    expect(safeParse(productSchema, { ...valid, taxRate: 101 }).ok).toBe(false);
  });

  it('normaliza barcode vacío a null', () => {
    const r = safeParse(productSchema, { ...valid, barcode: '   ' });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.barcode).toBeNull();
  });
});

describe('userSchema', () => {
  const valid = {
    email: 'foo@bar.com',
    password: 'secret123',
    name: 'Foo',
    role: 'cashier' as const,
    branchId: 'b1',
    active: true,
  };

  it('acepta usuario válido', () => {
    expect(safeParse(userSchema, valid).ok).toBe(true);
  });

  it('rechaza email inválido', () => {
    expect(safeParse(userSchema, { ...valid, email: 'no-es-email' }).ok).toBe(false);
  });

  it('rechaza password muy corto', () => {
    expect(safeParse(userSchema, { ...valid, password: '123' }).ok).toBe(false);
  });

  it('permite omitir password (edición)', () => {
    const { password: _password, ...rest } = valid;
    expect(safeParse(userSchema, rest).ok).toBe(true);
  });

  it('rechaza rol inválido', () => {
    expect(safeParse(userSchema, { ...valid, role: 'admin' as any }).ok).toBe(false);
  });

  it('normaliza email a lowercase', () => {
    const r = safeParse(userSchema, { ...valid, email: 'FOO@BAR.COM' });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.email).toBe('foo@bar.com');
  });
});

describe('branchSchema', () => {
  it('acepta sucursal válida', () => {
    expect(
      safeParse(branchSchema, { name: 'Sucursal Centro', address: '', active: true }).ok,
    ).toBe(true);
  });

  it('rechaza nombre vacío', () => {
    expect(safeParse(branchSchema, { name: '', address: '', active: true }).ok).toBe(false);
  });
});

describe('warehouseSchema', () => {
  it('acepta depósito válido', () => {
    expect(
      safeParse(warehouseSchema, {
        name: 'Mostrador',
        branchId: 'b1',
        isDefault: true,
        active: true,
      }).ok,
    ).toBe(true);
  });

  it('acepta depósito central (branchId null)', () => {
    expect(
      safeParse(warehouseSchema, {
        name: 'Central',
        branchId: null,
        isDefault: false,
        active: true,
      }).ok,
    ).toBe(true);
  });

  it('rechaza nombre vacío', () => {
    expect(
      safeParse(warehouseSchema, { name: '', branchId: 'b1', isDefault: true, active: true }).ok,
    ).toBe(false);
  });
});

describe('transferSchema', () => {
  const valid = {
    fromWarehouseId: 'a',
    toWarehouseId: 'b',
    notes: '',
    items: [{ productId: 'p1', qty: 5 }],
  };

  it('acepta transferencia válida', () => {
    expect(safeParse(transferSchema, valid).ok).toBe(true);
  });

  it('rechaza origen igual a destino', () => {
    expect(safeParse(transferSchema, { ...valid, toWarehouseId: 'a' }).ok).toBe(false);
  });

  it('rechaza items vacíos', () => {
    expect(safeParse(transferSchema, { ...valid, items: [] }).ok).toBe(false);
  });

  it('rechaza cantidad cero o negativa', () => {
    expect(
      safeParse(transferSchema, { ...valid, items: [{ productId: 'p1', qty: 0 }] }).ok,
    ).toBe(false);
    expect(
      safeParse(transferSchema, { ...valid, items: [{ productId: 'p1', qty: -1 }] }).ok,
    ).toBe(false);
  });

  it('rechaza cantidades fraccionales', () => {
    expect(
      safeParse(transferSchema, { ...valid, items: [{ productId: 'p1', qty: 1.5 }] }).ok,
    ).toBe(false);
  });
});
