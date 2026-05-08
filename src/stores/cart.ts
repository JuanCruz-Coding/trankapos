import { create } from 'zustand';
import type { Product } from '@/types';
import { addMoney, lineSubtotal, subMoney, gtMoney } from '@/lib/money';

export interface CartLine {
  productId: string;
  name: string;
  barcode: string | null;
  price: number;
  qty: number;
  discount: number;
}

interface CartState {
  lines: CartLine[];
  discount: number;
  addProduct: (p: Product, qty?: number) => void;
  updateQty: (productId: string, qty: number) => void;
  updatePrice: (productId: string, price: number) => void;
  updateLineDiscount: (productId: string, discount: number) => void;
  removeLine: (productId: string) => void;
  setGlobalDiscount: (d: number) => void;
  clear: () => void;
}

export const useCart = create<CartState>((set) => ({
  lines: [],
  discount: 0,
  addProduct: (p, qty = 1) =>
    set((state) => {
      const existing = state.lines.find((l) => l.productId === p.id);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.productId === p.id ? { ...l, qty: l.qty + qty } : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            productId: p.id,
            name: p.name,
            barcode: p.barcode,
            price: p.price,
            qty,
            discount: 0,
          },
        ],
      };
    }),
  updateQty: (productId, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.productId === productId ? { ...l, qty } : l))
        .filter((l) => l.qty > 0),
    })),
  updatePrice: (productId, price) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.productId === productId ? { ...l, price } : l)),
    })),
  updateLineDiscount: (productId, discount) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.productId === productId ? { ...l, discount } : l)),
    })),
  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.productId !== productId) })),
  setGlobalDiscount: (d) => set({ discount: d }),
  clear: () => set({ lines: [], discount: 0 }),
}));

export function cartTotals(lines: CartLine[], globalDiscount: number) {
  const subtotal = addMoney(...lines.map((l) => lineSubtotal(l.price, l.qty, l.discount)));
  const afterDiscount = subMoney(subtotal, globalDiscount);
  const total = gtMoney(afterDiscount, 0) ? afterDiscount : 0;
  return { subtotal, total };
}
