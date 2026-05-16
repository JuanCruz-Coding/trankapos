export type Role = 'owner' | 'manager' | 'cashier';

export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'qr' | 'transfer' | 'on_account';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'qr', label: 'QR / MP' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'on_account', label: 'Cuenta corriente' },
];

export type TaxCondition =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'exento'
  | 'consumidor_final';

/**
 * Condición IVA que puede tener un **receptor** de factura.
 * Igual a TaxCondition + 'no_categorizado' (que AFIP soporta para receptores
 * pero no para emisores). Mantener sincronizado con CHECK de customers.iva_condition.
 */
export type CustomerIvaCondition = TaxCondition | 'no_categorizado';

export const CUSTOMER_IVA_CONDITIONS: { value: CustomerIvaCondition; label: string }[] = [
  { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
  { value: 'monotributista', label: 'Monotributista' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor Final' },
  { value: 'no_categorizado', label: 'No Categorizado' },
];

/** Códigos AFIP de documento de identidad. */
export type CustomerDocType = 80 | 86 | 96;

export const CUSTOMER_DOC_TYPES: { value: CustomerDocType; label: string }[] = [
  { value: 80, label: 'CUIT' },
  { value: 86, label: 'CUIL' },
  { value: 96, label: 'DNI' },
];

export interface Customer {
  id: string;
  tenantId: string;
  docType: CustomerDocType;
  docNumber: string;
  legalName: string;
  ivaCondition: CustomerIvaCondition;
  email: string | null;
  notes: string | null;
  /** Sprint CRM-RETAIL: datos extra para retail / marketing. */
  phone: string | null;
  address: string | null;
  city: string | null;
  stateProvince: string | null;
  birthdate: string | null;
  marketingOptIn: boolean;
  /** Override del limite de cuenta corriente del tenant para este cliente. null = usa default. Sprint FIA. */
  creditLimit: number | null;
  /** Lista de precios asignada al cliente. null = usa la default del tenant. Sprint PRC. */
  priceListId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lista de precios (Sprint PRC). */
export interface PriceList {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Override de precio dentro de una lista. variantId null = aplica a todas las variantes del producto. */
export interface PriceListItem {
  id: string;
  tenantId: string;
  priceListId: string;
  productId: string;
  variantId: string | null;
  price: number;
}

/** Configuración granular de qué campos del cliente son obligatorios al cargarlo. */
export interface CustomerRequiredFields {
  docNumber: boolean;
  ivaCondition: boolean;
  phone: boolean;
  email: boolean;
  address: boolean;
  birthdate: boolean;
}

export type BusinessMode = 'kiosk' | 'retail';
export type BusinessSubtype =
  | 'food'
  | 'clothing'
  | 'electronics'
  | 'home'
  | 'pharmacy'
  | 'bookstore'
  | 'other';

export const BUSINESS_SUBTYPES: { value: BusinessSubtype; label: string }[] = [
  { value: 'clothing', label: 'Ropa / Indumentaria' },
  { value: 'electronics', label: 'Electrodomésticos / Electrónica' },
  { value: 'home', label: 'Hogar / Decoración' },
  { value: 'pharmacy', label: 'Farmacia / Perfumería' },
  { value: 'bookstore', label: 'Librería / Papelería' },
  { value: 'food', label: 'Comestibles' },
  { value: 'other', label: 'Otro' },
];

/** Datos del receptor a incluir en una venta. Puede provenir de la tabla customers o ser inline. */
export interface SaleReceiver {
  /** null si es inline (no se guarda en customers). */
  customerId: string | null;
  docType: CustomerDocType;
  docNumber: string;
  legalName: string;
  ivaCondition: CustomerIvaCondition;
}

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
  /** Ciudad/localidad — requerida para conectar MP Connect (catálogo oficial AR). */
  city: string;
  /** Provincia AR — requerida para conectar MP Connect (una de las 24). */
  stateProvince: string;
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
  // SKU
  skuAutoEnabled: boolean;
  skuPrefix: string;
  // Señas
  posPartialReservesStock: boolean;
  // Devoluciones (Sprint DEV.fix)
  /** Política de devolución de dinero. cash_or_credit (default), credit_only (siempre vale), cash_only. */
  refundPolicy: 'cash_or_credit' | 'credit_only' | 'cash_only';
  /** Meses de vigencia del vale generado por devolución. null = sin vencimiento. */
  storeCreditValidityMonths: number | null;
  // CRM / modo de negocio (Sprint CRM-RETAIL)
  businessMode: BusinessMode;
  businessSubtype: BusinessSubtype | null;
  customerRequiredFields: CustomerRequiredFields;
  // Cuenta corriente cliente (Sprint FIA)
  creditSalesEnabled: boolean;
  /** Límite default de deuda por cliente. null = sin límite. */
  creditSalesDefaultLimit: number | null;
  // Branding
  logoUrl: string | null;
}

export interface TenantSettingsInput {
  legalName?: string;
  taxId?: string;
  taxCondition?: TaxCondition;
  legalAddress?: string;
  city?: string;
  stateProvince?: string;
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
  skuAutoEnabled?: boolean;
  skuPrefix?: string;
  posPartialReservesStock?: boolean;
  refundPolicy?: 'cash_or_credit' | 'credit_only' | 'cash_only';
  storeCreditValidityMonths?: number | null;
  businessMode?: BusinessMode;
  businessSubtype?: BusinessSubtype | null;
  customerRequiredFields?: CustomerRequiredFields;
  creditSalesEnabled?: boolean;
  creditSalesDefaultLimit?: number | null;
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
  /** Overrides en jsonb. hasPermission combina con defaults del rol. */
  permissionOverrides?: PermissionsMap;
  /** Resuelto al listar — qué sucursales puede operar este user. */
  branchAccess?: BranchAccess;
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
  sku: string | null;
  price: number;
  cost: number;
  categoryId: string | null;
  taxRate: number;
  trackStock: boolean;
  allowSaleWhenZero: boolean;
  active: boolean;
  createdAt: string;
  /** Variantes del producto. Siempre hay al menos 1 (la default, migration 030). */
  variants?: ProductVariant[];
}

/**
 * Variante vendible de un producto: una combinación concreta (talla M / color Negro).
 * Cada producto tiene mínimo 1 variante (la "default" autogenerada en migration 030
 * para productos simples). sale_items, stock_items y transfer_items referencian la
 * variant_id, no el product_id.
 */
export interface ProductVariant {
  id: string;
  tenantId: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  /**
   * Shape libre, ej `{ talle: "M", color: "Negro" }`. Las claves las define el comercio
   * cuando arma la grilla de variantes. Para la variante default es `{}`.
   */
  attributes: Record<string, string>;
  /** Si null, hereda `Product.price`. */
  priceOverride: number | null;
  /** Si null, hereda `Product.cost`. */
  costOverride: number | null;
  active: boolean;
  /** true para la variante autogenerada en migration 030. No editable manualmente. */
  isDefault: boolean;
  createdAt: string;
}

export interface StockItem {
  id: string;
  tenantId: string;
  warehouseId: string;
  productId: string;
  /**
   * Variante a la que pertenece el stock. **Opcional durante la transición**:
   * la Pieza A del Sprint VAR adapta los mappers para que venga siempre. Cuando
   * todos los call sites lo pueblan, lo marcamos required.
   */
  variantId?: string;
  qty: number;
  qtyReserved: number;
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
  /** Variante vendida. Opcional durante la transición (Sprint VAR). */
  variantId?: string;
  name: string;
  barcode: string | null;
  price: number;
  qty: number;
  discount: number;
  subtotal: number;
  /** Cantidad ya devuelta acumulada (Sprint DEV). 0 = nada devuelto. */
  qtyReturned?: number;
}

/**
 * Motivo de devolución/cambio (Sprint DEV).
 * stock_destination define qué pasa con el item devuelto:
 * - 'original'           → vuelve al depósito original (default)
 * - 'specific_warehouse' → va al warehouse configurado (ej. depósito "Service")
 * - 'discard'            → no se ingresa a ningún depósito (pérdida)
 */
export interface ReturnReason {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  stockDestination: 'original' | 'specific_warehouse' | 'discard';
  destinationWarehouseId: string | null;
  /** Si true, este motivo permite cash incluso bajo refundPolicy='credit_only'. */
  allowsCashRefund: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Saldo del cliente (Sprint DEV). Positivo = a favor, negativo = fiado (no implementado). */
export interface CustomerCredit {
  customerId: string;
  balance: number;
  currency: string;
  updatedAt: string;
}

export interface CustomerCreditMovement {
  id: string;
  customerId: string;
  amount: number;
  reason: 'return_credit' | 'sale_payment' | 'manual_adjust' | 'fiado' | 'fiado_payment';
  relatedSaleId: string | null;
  relatedDocId: string | null;
  notes: string | null;
  /** Vencimiento individual. null = no vence. */
  expiresAt: string | null;
  createdAt: string;
}

export interface SalePayment {
  method: PaymentMethod;
  amount: number;
  /** Sprint PMP: recargo aplicado al pago (parte de amount). Para reportes. */
  surchargeAmount?: number;
  /** Sprint PMP: medio configurado usado, si aplica. */
  methodConfigId?: string | null;
}

/** Medio de pago configurable (Sprint PMP). */
export interface PaymentMethodConfig {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  paymentMethodBase: PaymentMethod;
  /** ej 'visa', 'master', 'naranja', 'cabal'. null si no aplica. */
  cardBrand: string | null;
  installments: number | null;
  /** Recargo en %. Puede ser negativo (descuento). */
  surchargePct: number;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type SaleStatus = 'paid' | 'partial';

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
  /** Sprint PMP: suma de recargos por medio de pago. total = subtotal - discount + surchargeTotal. */
  surchargeTotal?: number;
  total: number;
  status: SaleStatus;
  stockReservedMode: boolean;
  createdAt: string;
  voided: boolean;
  // Receptor (Factura A/B identificada). null si venta anónima.
  customerId?: string | null;
  customerDocType?: CustomerDocType | null;
  customerDocNumber?: string | null;
  customerLegalName?: string | null;
  customerIvaCondition?: CustomerIvaCondition | null;
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

export type Permission =
  | 'view_costs'
  | 'view_reports'
  | 'view_other_branches_stock'
  | 'void_sales'
  | 'do_transfers'
  | 'adjust_stock'
  | 'manage_products'
  | 'manage_branches'
  | 'manage_users'
  | 'manage_settings'
  | 'apply_discount_above_default'
  | 'cash_register_open_close'
  | 'reprint_documents';

export type PermissionsMap = Partial<Record<Permission, boolean>>;

export interface UserBranchAccess {
  id: string;
  userId: string;
  tenantId: string;
  /** null = acceso a todas las sucursales del tenant. */
  branchId: string | null;
  createdAt: string;
}

/**
 * 'all' = acceso a todas las sucursales (fila NULL en user_branch_access);
 * array = ids específicos.
 */
export type BranchAccess = 'all' | string[];

export interface AuthSession {
  userId: string;
  tenantId: string;
  branchId: string | null;
  role: Role;
  email: string;
  name: string;
  branchAccess: BranchAccess;
  /** Overrides — los efectivos se calculan combinando con defaults del rol. */
  permissionOverrides: PermissionsMap;
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
