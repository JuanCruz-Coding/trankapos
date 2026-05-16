import type {
  AuthSession,
  BranchAccess,
  Branch,
  Brand,
  BusinessMode,
  BusinessSubtype,
  CashMovement,
  CashRegister,
  Category,
  Customer,
  CustomerCredit,
  CustomerCreditMovement,
  CustomerDocType,
  CustomerGroup,
  CustomerIvaCondition,
  PaymentMethod,
  PaymentMethodConfig,
  PermissionsMap,
  Plan,
  PlanUsage,
  PriceList,
  PriceListItem,
  Product,
  ProductVariant,
  Promotion,
  PromotionApplication,
  PromotionScopeType,
  PromotionType,
  ReturnReason,
  Role,
  Sale,
  SaleReceiver,
  StockItem,
  Subscription,
  Tenant,
  TenantSettingsInput,
  Transfer,
  UnitOfMeasure,
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
  /** Sprint PROD-RETAIL: FK a brands. null si no aplica. */
  brandId?: string | null;
  taxRate: number;
  trackStock: boolean;
  allowSaleWhenZero: boolean;
  active: boolean;
  /** Sprint PROD-RETAIL: campos extra. Si se omite, no se modifica. */
  description?: string | null;
  unitOfMeasure?: UnitOfMeasure;
  tags?: string[];
  imageUrl?: string | null;
  season?: string | null;
  initialStock?: { warehouseId: string; qty: number; minQty: number }[];
}

export interface BrandInput {
  name: string;
  active?: boolean;
  sortOrder?: number;
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
  /** Sprint PROD-RETAIL: padre para sub-rubros. null = rubro raíz. Max 2 niveles. */
  parentId?: string | null;
  sortOrder?: number;
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
  /**
   * Sprint PMP: cada pago puede llevar surchargeAmount y methodConfigId opcionales.
   * El amount YA incluye el surcharge. El backend valida que sum(amount) = subtotal - discount + sum(surchargeAmount).
   */
  payments: {
    method: Sale['payments'][number]['method'];
    amount: number;
    surchargeAmount?: number;
    methodConfigId?: string | null;
  }[];
  discount: number;
  /**
   * Sprint PROMO: promos automáticas ya aplicadas al cart (el cliente las
   * calcula con applyPromotionsToCart antes de cobrar). El driver las persiste
   * en sale_promotions post-sale y suma sus amounts al `discount` enviado al
   * RPC (para que la validación de payments cuadre). El campo es informativo
   * para el frontend; el backend no diferencia entre descuento manual y promo.
   */
  appliedPromotions?: PromotionApplication[];
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

// --- Sprint FIA: ventas a cuenta corriente ---

export interface PaymentMethodConfigInput {
  code: string;
  label: string;
  paymentMethodBase: PaymentMethod;
  cardBrand?: string | null;
  installments?: number | null;
  surchargePct?: number;
  active?: boolean;
  sortOrder?: number;
}

export interface PriceListInput {
  code: string;
  name: string;
  isDefault?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export interface PriceListItemInput {
  priceListId: string;
  productId: string;
  variantId?: string | null;
  price: number;
}

// --- Sprint PROMO ---

export interface CustomerGroupInput {
  code: string;
  name: string;
  defaultPriceListId?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface PromotionInput {
  name: string;
  promoType: PromotionType;
  /** Requerido si promoType='percent_off'. */
  percentOff?: number | null;
  /** Requerido si promoType='nxm'. */
  buyQty?: number | null;
  /** Requerido si promoType='nxm'. */
  payQty?: number | null;
  scopeType: PromotionScopeType;
  /** product_id, category_id o brand. null si scopeType='all'. */
  scopeValue?: string | null;
  customerGroupId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
  priority?: number;
}

/**
 * Una línea del cart tal como la consume el engine de promociones. Contempla
 * variante para que el motor pueda agrupar items idénticos en NxM (mismo
 * product_id + variant_id).
 */
export interface PromoCartLine {
  productId: string;
  variantId: string | null;
  qty: number;
  unitPrice: number;
  /**
   * Categoría del producto (para promos scope='category'). Si la categoría
   * tiene parentId, el engine considera que también pertenece al padre — la
   * promo en el rubro padre aplica a productos de sus sub-rubros.
   */
  categoryId: string | null;
  /** Sprint PROD-RETAIL: ID de la marca (para promos scope='brand'). */
  brandId: string | null;
}

export interface ApplyPromotionsInput {
  lines: PromoCartLine[];
  /** Cliente identificado (null si venta anónima). */
  customerId?: string | null;
  /** Si ya conocés el groupId no hace falta hacer el lookup. */
  customerGroupId?: string | null;
  /** ISO. Default: now. Para evaluar vigencia. */
  evaluatedAt?: string;
}

export interface ApplyPromotionsResult {
  /** Suma de todos los amounts (descuento total por promos). */
  totalDiscount: number;
  /** Lista de promos efectivamente aplicadas. Se persisten en sale_promotions. */
  applied: PromotionApplication[];
}

export interface RecordCreditPaymentInput {
  customerId: string;
  amount: number;
  method: 'cash' | 'debit' | 'credit' | 'qr' | 'transfer';
  notes?: string | null;
}

export interface CreditLimitCheck {
  ok: boolean;
  /** Deuda total que tendría el cliente si se aprueba el monto (incluye deuda actual). */
  currentDebt: number;
  /** Límite efectivo (override del cliente o default del tenant). null = sin límite. */
  limitAmount: number | null;
  /** Si no `ok`, motivo. */
  reason: string | null;
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
  updateCategory(id: string, input: Partial<CategoryInput>): Promise<Category>;
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
  /** Sprint REPRINT: cargar una venta puntual por id (para ReceiptModal modo view). */
  getSale(id: string): Promise<Sale | null>;
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

  // --- Sprint FIA: cuenta corriente ---
  /** Valida si el cliente puede fiar `amount`. Llama RPC validate_customer_credit_limit. */
  validateCustomerCreditLimit(customerId: string, amount: number): Promise<CreditLimitCheck>;
  /** Registra un pago de fiado (suma al balance del cliente). */
  recordCreditPayment(input: RecordCreditPaymentInput): Promise<{ newBalance: number }>;
  /** Lista clientes con deuda (balance < 0), ordenados por monto adeudado desc. */
  listCustomersWithDebt(): Promise<Array<Customer & { debt: number }>>;

  // --- Sprint PRC: listas de precios ---
  listPriceLists(opts?: { activeOnly?: boolean }): Promise<PriceList[]>;
  createPriceList(input: PriceListInput): Promise<PriceList>;
  updatePriceList(id: string, input: Partial<PriceListInput>): Promise<PriceList>;
  /** Soft delete: setea active=false. La lista default no se puede borrar. */
  deactivatePriceList(id: string): Promise<void>;
  /** Items de una lista. */
  listPriceListItems(priceListId: string): Promise<PriceListItem[]>;
  /** Upsert (crear o actualizar) un item de la lista. */
  upsertPriceListItem(input: PriceListItemInput): Promise<PriceListItem>;
  /** Eliminar un item (vuelve a usar la cascada fallback). */
  deletePriceListItem(id: string): Promise<void>;
  /** Resuelve el precio efectivo con la cascada (variant > product > default). */
  getEffectivePrice(input: {
    productId: string;
    variantId?: string | null;
    priceListId?: string | null;
  }): Promise<number>;

  // --- Sprint PMP: medios de pago configurables ---
  listPaymentMethods(opts?: { activeOnly?: boolean }): Promise<PaymentMethodConfig[]>;
  createPaymentMethod(input: PaymentMethodConfigInput): Promise<PaymentMethodConfig>;
  updatePaymentMethod(
    id: string,
    input: Partial<PaymentMethodConfigInput>,
  ): Promise<PaymentMethodConfig>;
  deactivatePaymentMethod(id: string): Promise<void>;

  // --- Sprint PROD-RETAIL: marcas ---
  listBrands(opts?: { activeOnly?: boolean }): Promise<Brand[]>;
  createBrand(input: BrandInput): Promise<Brand>;
  updateBrand(id: string, input: Partial<BrandInput>): Promise<Brand>;
  deactivateBrand(id: string): Promise<void>;

  // --- Sprint PROMO: customer groups + promociones ---
  listCustomerGroups(opts?: { activeOnly?: boolean }): Promise<CustomerGroup[]>;
  createCustomerGroup(input: CustomerGroupInput): Promise<CustomerGroup>;
  updateCustomerGroup(id: string, input: Partial<CustomerGroupInput>): Promise<CustomerGroup>;
  /** Soft delete: setea active=false. Los clientes asignados quedan sin grupo (FK ON DELETE SET NULL maneja el caso de delete real). */
  deactivateCustomerGroup(id: string): Promise<void>;

  listPromotions(opts?: { activeOnly?: boolean }): Promise<Promotion[]>;
  createPromotion(input: PromotionInput): Promise<Promotion>;
  updatePromotion(id: string, input: Partial<PromotionInput>): Promise<Promotion>;
  deactivatePromotion(id: string): Promise<void>;

  /**
   * Engine de promociones (cliente-side). Recibe el cart + cliente y devuelve
   * el descuento total + qué promos aplicaron. Stack EXCLUSIVO: por cada
   * producto se aplica solo la mejor promo aplicable.
   * Las promos se guardan en sale_promotions al confirmar la venta — esa
   * persistencia la hace el driver internamente como parte de createSale.
   */
  applyPromotionsToCart(input: ApplyPromotionsInput): Promise<ApplyPromotionsResult>;

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
