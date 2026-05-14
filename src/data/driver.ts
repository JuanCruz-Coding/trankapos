import type {
  AuthSession,
  BranchAccess,
  Branch,
  CashMovement,
  CashRegister,
  Category,
  Customer,
  CustomerDocType,
  CustomerIvaCondition,
  PermissionsMap,
  Plan,
  PlanUsage,
  Product,
  Role,
  Sale,
  SaleReceiver,
  StockItem,
  Subscription,
  Tenant,
  TenantSettingsInput,
  Transfer,
  User,
  Warehouse,
} from '@/types';

export interface SignupInput {
  tenantName: string;
  branchName: string;
  ownerName: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ProductInput {
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
  initialStock?: { warehouseId: string; qty: number; minQty: number }[];
}

export interface UserInput {
  email: string;
  password?: string;
  name: string;
  role: Role;
  branchId: string | null;
  active: boolean;
  /** Set de sucursales accesibles. 'all' = todas. Si se omite, no se modifica. */
  branchAccess?: BranchAccess;
  /** Overrides de permisos. Si se omite, no se modifica (mantiene los actuales). */
  permissionOverrides?: PermissionsMap;
}

export interface BranchInput {
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
}

export interface WarehouseInput {
  name: string;
  branchId: string | null;
  isDefault: boolean;
  participatesInPos: boolean;
  alertLowStock: boolean;
  active: boolean;
}

export interface CategoryInput {
  name: string;
}

export interface SaleInput {
  branchId: string;
  registerId: string | null;
  items: { productId: string; qty: number; price: number; discount: number }[];
  payments: { method: Sale['payments'][number]['method']; amount: number }[];
  discount: number;
  /** Si true, la venta es una seña: paid<total OK, status='partial'. */
  partial?: boolean;
  /** Datos del receptor para Factura A/B. null si venta anónima. */
  receiver?: SaleReceiver | null;
}

export interface CustomerInput {
  docType: CustomerDocType;
  docNumber: string;
  legalName: string;
  ivaCondition: CustomerIvaCondition;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}

/** Documento fiscal AFIP asociado a una venta (factura o nota de crédito). */
export interface AfipDocumentSummary {
  id: string;
  saleId: string | null;
  docType: 'factura' | 'nota_credito' | 'nota_debito';
  docLetter: 'A' | 'B' | 'C';
  salesPoint: number;
  voucherNumber: number | null;
  cae: string | null;
  caeDueDate: string | null;
  status: 'pending' | 'authorized' | 'rejected' | 'cancelled';
  relatedDocId: string | null;
  qrUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Input para emitir una Nota de Crédito. */
export type CreditNoteInput =
  // Anular venta facturada + emitir NC del total.
  | { mode: 'void'; saleId: string }
  // NC manual sobre una factura (sin anular la venta entera).
  | { mode: 'manual'; afipDocumentId: string; reason?: string };

/** Resultado de emitir una Nota de Crédito. */
export interface CreditNoteResult {
  ok: boolean;
  documentId?: string;
  cae?: string;
  voucherNumber?: number;
  caeDueDate?: string;
  ptoVta?: number;
  cbteTipo?: 'A' | 'B' | 'C';
  qrUrl?: string;
  /** mode='void': si la venta se anuló OK (puede ser true aunque la NC falle). */
  voided?: boolean;
  error?: string;
}

export interface AddPaymentInput {
  saleId: string;
  payments: { method: Sale['payments'][number]['method']; amount: number }[];
}

export interface OpenRegisterInput {
  branchId: string;
  openingAmount: number;
}

export interface CloseRegisterInput {
  registerId: string;
  closingAmount: number;
  notes: string;
}

export interface CashMovementInput {
  registerId: string;
  kind: 'in' | 'out';
  amount: number;
  reason: string;
}

export interface TransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  notes: string;
  items: { productId: string; qty: number }[];
}

export interface SalesQuery {
  from?: string;
  to?: string;
  branchId?: string;
  cashierId?: string;
  registerId?: string;
  limit?: number;
  offset?: number;
}

export interface DataDriver {
  // --- auth ---
  signup(input: SignupInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  logout(): Promise<void>;
  currentSession(): Promise<AuthSession | null>;

  // --- tenant ---
  getTenant(): Promise<Tenant>;
  updateTenantSettings(input: TenantSettingsInput): Promise<Tenant>;
  /** Sube un logo (ya validado en cliente con validateLogoFile) y devuelve la URL pública. */
  uploadTenantLogo(file: File): Promise<string>;
  /** Elimina el logo del Storage y nullea logo_url en el tenant. */
  removeTenantLogo(): Promise<void>;

  // --- plan / subscription ---
  getSubscription(): Promise<Subscription>;
  getUsage(): Promise<PlanUsage>;
  listPlans(): Promise<Plan[]>;
  subscribeToPlan(
    planCode: string,
    backUrl: string,
    payerEmail: string,
  ): Promise<{ initPoint: string }>;
  cancelSubscription(): Promise<void>;
  clearPendingPlan(): Promise<void>;

  // --- branches ---
  listBranches(): Promise<Branch[]>;
  createBranch(input: BranchInput): Promise<Branch>;
  updateBranch(id: string, input: Partial<BranchInput>): Promise<Branch>;
  deleteBranch(id: string): Promise<void>;

  // --- warehouses ---
  listWarehouses(): Promise<Warehouse[]>;
  createWarehouse(input: WarehouseInput): Promise<Warehouse>;
  updateWarehouse(id: string, input: Partial<WarehouseInput>): Promise<Warehouse>;
  deleteWarehouse(id: string): Promise<void>;
  /** Resuelve el warehouse default activo de una branch. Util para POS. */
  getDefaultWarehouse(branchId: string): Promise<Warehouse | null>;

  // --- users ---
  listUsers(): Promise<User[]>;
  createUser(input: UserInput): Promise<User>;
  updateUser(id: string, input: Partial<UserInput>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // --- categories ---
  listCategories(): Promise<Category[]>;
  createCategory(input: CategoryInput): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // --- products ---
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  /** Busca por barcode primero, después por sku. Útil para escanear/tipear código. */
  findProductByCode(code: string): Promise<Product | null>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  // --- stock ---
  listStock(warehouseId?: string): Promise<StockItem[]>;
  adjustStock(productId: string, warehouseId: string, deltaQty: number, minQty?: number): Promise<void>;

  // --- sales / pos ---
  createSale(input: SaleInput): Promise<Sale>;
  voidSale(id: string): Promise<void>;
  listSales(q: SalesQuery): Promise<Sale[]>;
  /** Agrega pagos a una venta con status=partial. Promueve a paid si cubren el saldo. */
  addPaymentToSale(input: AddPaymentInput): Promise<Sale>;

  // --- cash register ---
  currentOpenRegister(branchId: string): Promise<CashRegister | null>;
  openRegister(input: OpenRegisterInput): Promise<CashRegister>;
  closeRegister(input: CloseRegisterInput): Promise<CashRegister>;
  addCashMovement(input: CashMovementInput): Promise<CashMovement>;
  listCashMovements(registerId: string): Promise<CashMovement[]>;
  listRegisters(branchId?: string): Promise<CashRegister[]>;

  // --- transfers ---
  createTransfer(input: TransferInput): Promise<Transfer>;
  listTransfers(): Promise<Transfer[]>;

  // --- customers (mini-CRM para Factura A/B identificada) ---
  listCustomers(opts?: { activeOnly?: boolean }): Promise<Customer[]>;
  searchCustomers(query: string): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  /** Busca por (doc_type, doc_number) exacto. Útil para detectar duplicado al crear. */
  findCustomerByDoc(docType: CustomerDocType, docNumber: string): Promise<Customer | null>;
  createCustomer(input: CustomerInput): Promise<Customer>;
  updateCustomer(id: string, input: Partial<CustomerInput>): Promise<Customer>;
  /** Soft delete: setea active=false. */
  deactivateCustomer(id: string): Promise<void>;

  // --- AFIP: documentos fiscales y notas de crédito ---
  /** Documentos AFIP (factura + NC/ND) asociados a una venta. */
  listAfipDocumentsForSale(saleId: string): Promise<AfipDocumentSummary[]>;
  /** Emite una Nota de Crédito (anulando la venta o manual sobre una factura). */
  emitCreditNote(input: CreditNoteInput): Promise<CreditNoteResult>;
}
