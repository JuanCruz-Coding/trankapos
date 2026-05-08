import { describe, it, expect } from 'vitest';
import {
  addMoney,
  subMoney,
  mulMoney,
  eqMoney,
  gtMoney,
  ltMoney,
  toCents,
  fromCents,
  roundMoney,
  lineSubtotal,
} from './money';

describe('money — conversiones', () => {
  it('toCents redondea al centavo más cercano', () => {
    expect(toCents(10.005)).toBe(1001);
    expect(toCents(10.004)).toBe(1000);
    expect(toCents(0.1)).toBe(10);
  });

  it('fromCents revierte sin pérdida', () => {
    expect(fromCents(1001)).toBe(10.01);
    expect(fromCents(0)).toBe(0);
  });

  it('toCents tolera valores no finitos', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });
});

describe('money — operaciones', () => {
  it('addMoney evita el bug clásico de 0.1 + 0.2', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    // confirmar que con floats puros falla
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('addMoney suma una lista variable', () => {
    expect(addMoney(100, 200, 300)).toBe(600);
    expect(addMoney()).toBe(0);
    expect(addMoney(1.99, 2.99, 3.99)).toBe(8.97);
  });

  it('subMoney respeta precisión', () => {
    expect(subMoney(0.3, 0.1)).toBe(0.2);
    expect(subMoney(1000, 999.99)).toBe(0.01);
  });

  it('mulMoney multiplica precio por cantidad fraccional', () => {
    expect(mulMoney(99.99, 3)).toBe(299.97);
    expect(mulMoney(10, 1.5)).toBe(15);
    expect(mulMoney(0.1, 3)).toBe(0.3);
  });

  it('roundMoney corta a dos decimales', () => {
    expect(roundMoney(10.123)).toBe(10.12);
    expect(roundMoney(10.125)).toBe(10.13);
  });
});

describe('money — comparaciones', () => {
  it('eqMoney compara con tolerancia de centavos', () => {
    expect(eqMoney(0.1 + 0.2, 0.3)).toBe(true);
    expect(eqMoney(100.001, 100)).toBe(true);
    expect(eqMoney(100.005, 100)).toBe(false); // 100.01 vs 100.00
  });

  it('gtMoney y ltMoney funcionan', () => {
    expect(gtMoney(0.31, 0.3)).toBe(true);
    expect(ltMoney(0.29, 0.3)).toBe(true);
    expect(gtMoney(0.3, 0.3)).toBe(false);
  });
});

describe('money — lineSubtotal', () => {
  it('calcula precio*qty - descuento', () => {
    expect(lineSubtotal(100, 2, 0)).toBe(200);
    expect(lineSubtotal(99.99, 3, 0)).toBe(299.97);
    expect(lineSubtotal(100, 2, 50)).toBe(150);
  });

  it('soporta cantidades fraccionales', () => {
    expect(lineSubtotal(10, 1.5, 0)).toBe(15);
  });

  it('puede dar negativo si el descuento supera el bruto', () => {
    expect(lineSubtotal(100, 1, 150)).toBe(-50);
  });
});
