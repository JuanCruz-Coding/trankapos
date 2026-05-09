export type Role = 'owner' | 'manager' | 'cashier';

export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'qr' | 'transfer';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'qr', label: 'QR / MP' },
  { value: 'transfer', label: 'Transferencia' },
];

export type TaxCondition =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'exento'
  | 'consumidor_final';

export const TAX_CONDITIONS: { value: TaxCondition; label: string }[] = [
  { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
  { value: 'monotributista', label: 'Monotributista' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor Final' },
];

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
  // Empresa / fiscal
  legalName: string;
  taxId: string;
  taxCondition: TaxCondition;
  legalAddress: string;
  phone: string;
  email: string;
  // Ticket
  ticketTitle: string;
  ticketFooter: string;
  ticketShowLogo: boolean;
  ticketShowTaxId: boolean;
  ticketWidthMm: 58 | 80;
  // POS
  posAllowNegativeStock: boolean;
  posMaxDiscountPercent: number;
  posRoundTo: number;
  posRequireCustomer: boolean;
  // Stock
  stockAlertsEnabled: boolean;
  // Branding
  logoUrl: string | null;
}

export interface TenantSettingsInput {
  legalName?: string;
  taxId?: string;
  taxCondition?: TaxCondition;
  legalAddress?: string;
  phone?: string;
  email?: string;
  ticketTitle?: string;
  ticketFooter?: string;
  ticketShowLogo?: boolean;
  ticketShowTaxId?: boolean;
  ticketWidthMm?: 58 | 80;
  posAllowNegativeStock?: boolean;
  posMaxDiscountPercent?: number;
  posRoundTo?: number;
  posRequireCustomer?: boolean;
  stockAlertsEnabled?: boolean;
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
  phone: string;
  email: string;
  active: boolean;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  isDefault: boolean;
  participatesInPos: boolean;
  alertLowStock: boolean;
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
  trackStock: boolean;
  allowSaleWhenZero: boolean;
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
