export type Role = 'owner' | 'manager' | 'cashier';

export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'qr' | 'transfer';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'qr', label: 'QR / MP' },
  { value: 'transfer', label: 'Transferencia' },
];

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  branchId: string | null;
  active: boolean;
  createdAt: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  barcode: string | null;
  price: number;
  cost: number;
  categoryId: string | null;
  taxRate: number;
  active: boolean;
  createdAt: string;
}

export interface StockItem {
  id: string;
  tenantId: string;
  warehouseId: string;
  productId: string;
  qty: number;
  minQty: number;
  updatedAt: string;
}

export interface CashRegister {
  id: string;
  tenantId: string;
  branchId: string;
  openedBy: string;
  openedAt: string;
  openingAmount: number;
  closedAt: string | null;
  closedBy: string | null;
  closingAmount: number | null;
  expectedCash: number | null;
  difference: number | null;
  notes: string | null;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  registerId: string;
  kind: 'in' | 'out';
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  name: string;
  barcode: string | null;
  price: number;
  qty: number;
  discount: number;
  subtotal: number;
}

export interface SalePayment {
  method: PaymentMethod;
  amount: number;
}

export interface Sale {
  id: string;
  tenantId: string;
  branchId: string;
  registerId: string | null;
  cashierId: string;
  items: SaleItem[];
  payments: SalePayment[];
  subtotal: number;
  discount: number;
  total: number;
  createdAt: string;
  voided: boolean;
}

export interface Transfer {
  id: string;
  tenantId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  createdBy: string;
  createdAt: string;
  notes: string;
  items: { productId: string; qty: number }[];
}

export interface AuthSession {
  userId: string;
  tenantId: string;
  branchId: string | null;
  role: Role;
  email: string;
  name: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  maxBranches: number | null;
  maxWarehousesPerBranch: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
  features: Record<string, boolean>;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Subscription {
  id: string;
  tenantId: string;
  plan: Plan;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface PlanUsage {
  branches: number;
  warehouses: number;
  users: number;
  products: number;
}
