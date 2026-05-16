import type {
  AuthSession,
  BranchAccess,
  Branch,
  BusinessMode,
  BusinessSubtype,
  CashMovement,
  CashRegister,
  Category,
  Customer,
  CustomerCredit,
  CustomerCreditMovement,
  CustomerDocType,
  CustomerIvaCondition,
  PermissionsMap,
  Plan,
  PlanUsage,
  Product,
  ProductVariant,
  ReturnReason,
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
  /** Sprint CRM-RETAIL: tipo de negocio elegido en onboarding. Default 'kiosk'. */
  businessMode?: BusinessMode;
  businessSubtype?: BusinessSubtype | null;
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
  /**
   * Items de la venta. `variantId` es **opcional durante la transición** — si no
   * viene, el backend resuelve a la variante default del producto. El POS
   * adaptado debería mandarlo siempre. Cuando todas las pantallas pasen, vamos
   * a marcarlo required.
   */
  items: { productId: string; variantId?: string; qty: number; price: number; discount: number }[];
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
  /** Sprint CRM-RETAIL: datos extra opcionales. */
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  birthdate?: string | null;
  marketingOptIn?: boolean;
  active?: boolean;
}

/** Stats de compras del cliente para mostrar en su ficha. Sprint CRM-RETAIL. */
export interface CustomerSalesStats {
  totalSpent: number;
  salesCount: number;
  lastSaleAt: string | null;
  firstSaleAt: string | null;
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
  /** Sub-tipo (Sprint DEV). null en docs antiguos no migrados. */
  kind?: 'factura' | 'void_total' | 'void_partial' | 'exchange_nc' | 'nota_debito' | null;
  reasonId?: string | null;
  reasonText?: string | null;
}

/** Input para emitir una Nota de Crédito. */
export type CreditNoteInput =
  // Anular venta facturada + emitir NC del total.
  | { mode: 'void'; saleId: string }
  // NC manual sobre una factura (sin anular la venta entera).
  | { mode: 'manual'; afipDocumentId: string; reason?: string };

// --- AFIP A5a: contingencia / historial / retry ---

/** Resumen de contingencia para el banner de estado AFIP. */
export interface AfipContingencySummary {
  /** Comprobantes en estado 'rejected' del ambiente actual. */
  rejectedCount: number;
  /** created_at del rejected más viejo, o null si no hay. */
  oldestRejectedAt: string | null;
}

/** Fila del historial de comprobantes AFIP (incluye campos de contingencia). */
export interface AfipDocumentDetail extends AfipDocumentSummary {
  retryCount: number;
  lastRetryAt: string | null;
  environment: 'homologation' | 'production' | null;
  emittedAt: string | null;
}

/** Filtros para listar el historial de comprobantes. */
export interface AfipDocumentsQuery {
  status?: 'pending' | 'authorized' | 'rejected' | 'cancelled';
  docType?: 'factura' | 'nota_credito' | 'nota_debito';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Input para reintentar la emisión de un comprobante. */
export type RetryDocumentInput =
  | { documentId: string }
  | { saleId: string };

/** Resultado de un reintento de emisión. */
export interface RetryResult {
  ok: boolean;
  documentId?: string;
  error?: string;
}

// --- AFIP A6: onboarding via wizard ---

/** Input para generar el par RSA + CSR para AFIP. */
export interface GenerateCsrInput {
  /** CUIT del comercio (11 dígitos sin guiones). */
  cuit: string;
  /** Razón social. Va en el subject del CSR como O=<legalName>. */
  legalName: string;
  /** Alias del cert (CN del CSR). Lo elige el comercio, ej. 'trankapos-prod'. */
  alias: string;
  /** Punto de venta AFIP (>0). */
  salesPoint: number;
  /** Ambiente: cada uno tiene su propio par (homo y prod son cuentas AFIP distintas). */
  environment: 'homologation' | 'production';
}

// --- Sprint DEV: devoluciones, cambios, saldo cliente ---

export interface ReturnReasonInput {
  code: string;
  label: string;
  stockDestination: 'original' | 'specific_warehouse' | 'discard';
  destinationWarehouseId?: string | null;
  /** Sprint DEV.fix: si true permite cash en refundPolicy=credit_only. */
  allowsCashRefund?: boolean;
  active?: boolean;
  sortOrder?: number;
}

/** Devolver items de una venta (sin cambio, sólo NC parcial). */
export interface ReturnSaleItemsInput {
  saleId: string;
  /** Cantidades a devolver por línea (no puede superar `qty - qtyReturned`). */
  items: { saleItemId: string; qty: number }[];
  reasonId?: string | null;
  reasonText?: string | null;
  /**
   * Cómo se devuelve el dinero al cliente:
   * - 'cash'   → sale del cajón (movimiento out automático)
   * - 'credit' → suma al saldo a favor del cliente (requiere customerId en la venta)
   * - 'none'   → ya está saldado de otra forma (manual)
   */
  refundMode: 'cash' | 'credit' | 'none';
}

export interface ReturnSaleItemsResult {
  ok: boolean;
  creditNoteId?: string;
  creditNoteAmount?: number;
  newCustomerBalance?: number | null;
  error?: string;
}

/** Cambio: devolver items + llevarse nuevos. Maneja diferencia automáticamente. */
export interface ExchangeSaleInput {
  originalSaleId: string;
  /** Items que el cliente devuelve (qty a devolver por línea). */
  returnedItems: { saleItemId: string; qty: number }[];
  /** Items que el cliente se lleva (mismo shape que SaleInput.items). */
  newItems: { productId: string; variantId?: string; qty: number; price: number; discount: number }[];
  /** Pagos para cubrir la diferencia si lo nuevo cuesta MÁS. */
  payments: { method: Sale['payments'][number]['method']; amount: number }[];
  /**
   * Cómo se cierra la diferencia si lo nuevo cuesta MENOS:
   * - 'cash'   → devolver delta en efectivo
   * - 'credit' → sumar al saldo del cliente
   */
  refundMode: 'cash' | 'credit';
  reasonId?: string | null;
  reasonText?: string | null;
  /** Datos del receptor para la nueva factura. Si null, anónima. */
  receiver?: SaleReceiver | null;
}

export interface ExchangeSaleResult {
  ok: boolean;
  creditNoteId?: string;
  newSaleId?: string;
  /** Delta en favor del cliente (positivo = se devuelve algo o crédito; negativo = cobra). */
  difference?: number;
  newCustomerBalance?: number | null;
  error?: string;
}

/** Resultado de generar el CSR. */
export interface GenerateCsrResult {
  /** CSR PEM (texto plano, es público). El comercio lo copia y lo pega en WSASS. */
  csrPem: string;
  alias: string;
  environment: 'homologation' | 'production';
}

/** Input para completar el onboarding con el .crt firmado por AFIP. */
export interface UploadAfipCertificateInput {
  environment: 'homologation' | 'production';
  /** Contenido completo del .crt descargado de WSASS. */
  certPem: string;
}

/** Resultado del upload del .crt. */
export interface UploadAfipCertificateResult {
  ok: boolean;
  error?: string;
}

// --- AFIP A7: consulta padrón (ws_sr_padron_a5) ---

export interface ConsultAfipPadronInput {
  /** CUIT del receptor, 11 dígitos sin guiones. */
  cuit: string;
}

/** Datos del receptor devueltos por el padrón AFIP. */
export interface AfipPadronPersona {
  cuit: string;
  /** Razón social (persona jurídica) o nombre+apellido (persona física). */
  legalName: string;
  /** Condición IVA mapeada al enum del proyecto. */
  ivaCondition: CustomerIvaCondition;
  /** Domicilio fiscal formateado "Calle 123, Ciudad, Provincia" (o null si no figura). */
  address: string | null;
}

/** Resultado de consultar el padrón. */
export interface AfipPadronResult {
  ok: boolean;
  persona?: AfipPadronPersona;
  error?: string;
}

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
  /** `variantId` opcional durante la transición (fallback a default). */
  items: { productId: string; variantId?: string; qty: number }[];
}

// --- Variantes de producto (Sprint VAR / migration 030) ---

export interface VariantInput {
  productId: string;
  sku?: string | null;
  barcode?: string | null;
  attributes: Record<string, string>;
  /** Si null/undefined, hereda Product.price. Override solo si la variante cobra distinto. */
  priceOverride?: number | null;
  costOverride?: number | null;
  active?: boolean;
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
  /** Busca por barcode primero, después por sku. Útil para detectar duplicados al crear. */
  findProductByCode(code: string): Promise<Product | null>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  // --- variantes (Sprint VAR) ---
  /** Variantes del tenant, opcionalmente filtradas por producto. */
  listVariants(productId?: string): Promise<ProductVariant[]>;
  createVariant(input: VariantInput): Promise<ProductVariant>;
  updateVariant(id: string, input: Partial<VariantInput>): Promise<ProductVariant>;
  /** Falla si la variante es la default o si tiene ventas asociadas. */
  deleteVariant(id: string): Promise<void>;
  /**
   * Búsqueda para el POS: chequea primero en `product_variants` (cada variante
   * puede tener su propio EAN) y después en `products`. Devuelve el producto + la
   * variante que matcheó (o la default si matcheó el código del producto padre).
   */
  findVariantByCode(code: string): Promise<{ product: Product; variant: ProductVariant } | null>;

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
  /** Sprint CRM-RETAIL: stats agregadas del cliente para mostrar en su ficha. */
  getCustomerSalesStats(customerId: string): Promise<CustomerSalesStats>;
  /** Sprint CRM-RETAIL: ventas no anuladas del cliente, últimas primero. */
  listSalesForCustomer(customerId: string, opts?: { limit?: number }): Promise<Sale[]>;
  /** Sprint CRM-RETAIL: aplica preset al cambiar el modo del negocio. */
  applyBusinessModePreset(mode: BusinessMode): Promise<void>;

  // --- AFIP: documentos fiscales y notas de crédito ---
  /** Documentos AFIP (factura + NC/ND) asociados a una venta. */
  listAfipDocumentsForSale(saleId: string): Promise<AfipDocumentSummary[]>;
  /** Emite una Nota de Crédito (anulando la venta o manual sobre una factura). */
  emitCreditNote(input: CreditNoteInput): Promise<CreditNoteResult>;

  // --- AFIP A5a: contingencia / historial / retry ---
  /** Resumen para el banner: cuántos comprobantes quedaron rejected. */
  getAfipContingencySummary(): Promise<AfipContingencySummary>;
  /** Historial de comprobantes AFIP del tenant, con filtros. */
  listAfipDocuments(q: AfipDocumentsQuery): Promise<AfipDocumentDetail[]>;
  /** Reintenta la emisión de un comprobante rejected (o emite uno nuevo para una sale sin doc). */
  retryAfipDocument(input: RetryDocumentInput): Promise<RetryResult>;

  // --- AFIP A6: onboarding via wizard (genera CSR en el server) ---
  /**
   * Genera RSA key + CSR para AFIP. El backend persiste la key encriptada en
   * tenant_afip_credentials (cert_encrypted queda null hasta que el comercio
   * sube el .crt firmado por AFIP). Devuelve el CSR para que el comercio lo
   * pegue en WSASS.
   */
  generateAfipCsr(input: GenerateCsrInput): Promise<GenerateCsrResult>;
  /**
   * Sube el .crt firmado por AFIP y activa las credenciales. Solo válido si
   * antes se generó un CSR (hay key persistida y csr_pem). Valida que la
   * public key del cert coincida con la key privada guardada.
   */
  uploadAfipCertificate(input: UploadAfipCertificateInput): Promise<UploadAfipCertificateResult>;

  // --- AFIP A7: consulta padrón ---
  /**
   * Consulta el padrón AFIP (ws_sr_padron_a5) por CUIT. Devuelve razón social,
   * condición IVA y domicilio del receptor. Útil para autocompletar el form
   * de Customer y validar antes de emitir Factura A.
   */
  consultAfipPadron(input: ConsultAfipPadronInput): Promise<AfipPadronResult>;

  // --- Sprint DEV: devoluciones / cambios / saldo cliente ---
  listReturnReasons(opts?: { activeOnly?: boolean }): Promise<ReturnReason[]>;
  createReturnReason(input: ReturnReasonInput): Promise<ReturnReason>;
  updateReturnReason(id: string, input: Partial<ReturnReasonInput>): Promise<ReturnReason>;
  /** Soft delete: setea active=false. */
  deactivateReturnReason(id: string): Promise<void>;
  /** Devolver items de una venta (NC parcial). */
  returnSaleItems(input: ReturnSaleItemsInput): Promise<ReturnSaleItemsResult>;
  /** Cambio atómico: devolver + nueva venta + cerrar diferencia. */
  exchangeSale(input: ExchangeSaleInput): Promise<ExchangeSaleResult>;
  /** Saldo actual del cliente (puede ser 0/null si nunca tuvo movimientos). */
  getCustomerCredit(customerId: string): Promise<CustomerCredit | null>;
  /** Historial de movimientos del saldo del cliente, más reciente primero. */
  listCustomerCreditMovements(customerId: string): Promise<CustomerCreditMovement[]>;
}
