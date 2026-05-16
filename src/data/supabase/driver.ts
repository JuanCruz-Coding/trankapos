import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { addMoney, subMoney } from '@/lib/money';
import type {
  AuthSession,
  Branch,
  BranchAccess,
  BusinessMode,
  CashMovement,
  CashRegister,
  Category,
  Customer,
  CustomerCredit,
  CustomerCreditMovement,
  CustomerDocType,
  PaymentMethod,
  PermissionsMap,
  Plan,
  PlanUsage,
  Product,
  ProductVariant,
  ReturnReason,
  Sale,
  SaleItem,
  StockItem,
  Subscription,
  SubscriptionStatus,
  TaxCondition,
  Tenant,
  TenantSettingsInput,
  Transfer,
  User,
  Warehouse,
} from '@/types';
import type {
  AddPaymentInput,
  AfipContingencySummary,
  AfipDocumentDetail,
  AfipDocumentSummary,
  AfipDocumentsQuery,
  BranchInput,
  CashMovementInput,
  AfipPadronResult,
  CategoryInput,
  CloseRegisterInput,
  ConsultAfipPadronInput,
  CreditLimitCheck,
  CreditNoteInput,
  CreditNoteResult,
  CustomerInput,
  CustomerSalesStats,
  DataDriver,
  RecordCreditPaymentInput,
  ExchangeSaleInput,
  ExchangeSaleResult,
  GenerateCsrInput,
  GenerateCsrResult,
  LoginInput,
  OpenRegisterInput,
  ProductInput,
  RetryDocumentInput,
  RetryResult,
  ReturnReasonInput,
  ReturnSaleItemsInput,
  ReturnSaleItemsResult,
  SaleInput,
  SalesQuery,
  SignupInput,
  TransferInput,
  UploadAfipCertificateInput,
  UploadAfipCertificateResult,
  UserInput,
  VariantInput,
  WarehouseInput,
} from '../driver';

// ============================================================
// Tenant: el row entero (con settings nuevas) viene del SELECT
// ============================================================
interface TenantRow {
  id: string;
  name: string;
  created_at: string;
  legal_name: string;
  tax_id: string;
  tax_condition: TaxCondition;
  legal_address: string;
  city: string | null;
  state_province: string | null;
  phone: string;
  email: string;
  ticket_title: string;
  ticket_footer: string;
  ticket_show_logo: boolean;
  ticket_show_tax_id: boolean;
  ticket_width_mm: number;
  pos_allow_negative_stock: boolean;
  pos_max_discount_percent: string;
  pos_round_to: string;
  pos_require_customer: boolean;
  stock_alerts_enabled: boolean;
  sku_auto_enabled: boolean;
  sku_prefix: string;
  pos_partial_reserves_stock: boolean;
  refund_policy: 'cash_or_credit' | 'credit_only' | 'cash_only' | null;
  store_credit_validity_months: number | null;
  business_mode: 'kiosk' | 'retail' | null;
  business_subtype: string | null;
  customer_required_fields: unknown;
  credit_sales_enabled: boolean | null;
  credit_sales_default_limit: string | number | null;
  logo_url: string | null;
}

function mapTenant(r: TenantRow): Tenant {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    legalName: r.legal_name,
    taxId: r.tax_id,
    taxCondition: r.tax_condition,
    legalAddress: r.legal_address,
    city: r.city ?? '',
    stateProvince: r.state_province ?? '',
    phone: r.phone,
    email: r.email,
    ticketTitle: r.ticket_title,
    ticketFooter: r.ticket_footer,
    ticketShowLogo: r.ticket_show_logo,
    ticketShowTaxId: r.ticket_show_tax_id,
    ticketWidthMm: (r.ticket_width_mm === 58 ? 58 : 80),
    posAllowNegativeStock: r.pos_allow_negative_stock,
    posMaxDiscountPercent: Number(r.pos_max_discount_percent),
    posRoundTo: Number(r.pos_round_to),
    posRequireCustomer: r.pos_require_customer,
    stockAlertsEnabled: r.stock_alerts_enabled,
    skuAutoEnabled: r.sku_auto_enabled ?? true,
    skuPrefix: r.sku_prefix ?? '200',
    posPartialReservesStock: r.pos_partial_reserves_stock ?? false,
    refundPolicy: r.refund_policy ?? 'cash_or_credit',
    storeCreditValidityMonths: r.store_credit_validity_months ?? null,
    businessMode: r.business_mode ?? 'kiosk',
    businessSubtype: (r.business_subtype ?? null) as Tenant['businessSubtype'],
    customerRequiredFields: (r.customer_required_fields as Tenant['customerRequiredFields']) ?? {
      docNumber: false,
      ivaCondition: false,
      phone: false,
      email: false,
      address: false,
      birthdate: false,
    },
    creditSalesEnabled: r.credit_sales_enabled ?? false,
    creditSalesDefaultLimit:
      r.credit_sales_default_limit == null ? null : Number(r.credit_sales_default_limit),
    logoUrl: r.logo_url ?? null,
  };
}

const LOGO_BUCKET = 'tenant-logos';

// ============================================================
// Mappers DB → TS. Postgres `numeric` viene como string en JSON.
// ============================================================

interface BranchRow {
  id: string; tenant_id: string; name: string; address: string;
  phone: string; email: string; active: boolean; created_at: string;
}
function mapBranch(r: BranchRow): Branch {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, address: r.address,
    phone: r.phone ?? '', email: r.email ?? '',
    active: r.active, createdAt: r.created_at,
  };
}

interface WarehouseRow {
  id: string; tenant_id: string; branch_id: string | null;
  name: string; is_default: boolean;
  participates_in_pos: boolean; alert_low_stock: boolean;
  active: boolean; created_at: string;
}
function mapWarehouse(r: WarehouseRow): Warehouse {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id,
    name: r.name, isDefault: r.is_default,
    participatesInPos: r.participates_in_pos,
    alertLowStock: r.alert_low_stock,
    active: r.active, createdAt: r.created_at,
  };
}

interface CategoryRow { id: string; tenant_id: string; name: string; created_at: string; }
function mapCategory(r: CategoryRow): Category {
  return { id: r.id, tenantId: r.tenant_id, name: r.name, createdAt: r.created_at };
}

interface ProductRow {
  id: string; tenant_id: string; name: string; barcode: string | null;
  sku: string | null;
  price: string; cost: string; category_id: string | null; tax_rate: string;
  track_stock: boolean; allow_sale_when_zero: boolean;
  active: boolean; created_at: string;
}
function mapProduct(r: ProductRow): Product {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, barcode: r.barcode,
    sku: r.sku ?? null,
    price: Number(r.price), cost: Number(r.cost),
    categoryId: r.category_id, taxRate: Number(r.tax_rate),
    trackStock: r.track_stock ?? true,
    allowSaleWhenZero: r.allow_sale_when_zero ?? false,
    active: r.active, createdAt: r.created_at,
  };
}

interface StockRow {
  id: string; tenant_id: string; warehouse_id: string; product_id: string;
  variant_id: string;
  qty: string; qty_reserved: string | null; min_qty: string; updated_at: string;
}
function mapStock(r: StockRow): StockItem {
  return {
    id: r.id, tenantId: r.tenant_id, warehouseId: r.warehouse_id, productId: r.product_id,
    variantId: r.variant_id,
    qty: Number(r.qty),
    qtyReserved: r.qty_reserved !== null && r.qty_reserved !== undefined ? Number(r.qty_reserved) : 0,
    minQty: Number(r.min_qty), updatedAt: r.updated_at,
  };
}

// ============================================================
// Variantes de producto (migration 030)
// ============================================================
interface ProductVariantRow {
  id: string;
  tenant_id: string;
  product_id: string;
  sku: string | null;
  barcode: string | null;
  attributes: Record<string, string> | null;
  price_override: string | null;
  cost_override: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
}
function mapProductVariant(r: ProductVariantRow): ProductVariant {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    productId: r.product_id,
    sku: r.sku ?? null,
    barcode: r.barcode ?? null,
    attributes: (r.attributes ?? {}) as Record<string, string>,
    priceOverride: r.price_override !== null && r.price_override !== undefined ? Number(r.price_override) : null,
    costOverride: r.cost_override !== null && r.cost_override !== undefined ? Number(r.cost_override) : null,
    active: r.active,
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

interface RegisterRow {
  id: string; tenant_id: string; branch_id: string; opened_by: string; opened_at: string;
  opening_amount: string; closed_at: string | null; closed_by: string | null;
  closing_amount: string | null; expected_cash: string | null; difference: string | null;
  notes: string | null;
}
function mapRegister(r: RegisterRow): CashRegister {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id,
    openedBy: r.opened_by, openedAt: r.opened_at, openingAmount: Number(r.opening_amount),
    closedAt: r.closed_at, closedBy: r.closed_by,
    closingAmount: r.closing_amount !== null ? Number(r.closing_amount) : null,
    expectedCash: r.expected_cash !== null ? Number(r.expected_cash) : null,
    difference: r.difference !== null ? Number(r.difference) : null,
    notes: r.notes,
  };
}

interface MovementRow {
  id: string; tenant_id: string; register_id: string; kind: 'in' | 'out';
  amount: string; reason: string; created_by: string; created_at: string;
}
function mapMovement(r: MovementRow): CashMovement {
  return {
    id: r.id, tenantId: r.tenant_id, registerId: r.register_id, kind: r.kind,
    amount: Number(r.amount), reason: r.reason,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

interface SaleItemRow {
  id: string; product_id: string; name: string; barcode: string | null;
  price: string; qty: string; discount: string; subtotal: string;
  /** Sprint DEV: cantidad ya devuelta acumulada (default 0 en migration 034). */
  qty_returned?: string | number | null;
}
function mapSaleItem(r: SaleItemRow): SaleItem {
  return {
    id: r.id, productId: r.product_id, name: r.name, barcode: r.barcode,
    price: Number(r.price), qty: Number(r.qty),
    discount: Number(r.discount), subtotal: Number(r.subtotal),
    qtyReturned: r.qty_returned != null ? Number(r.qty_returned) : 0,
  };
}

interface SalePaymentRow { method: PaymentMethod; amount: string; }
interface SaleRow {
  id: string; tenant_id: string; branch_id: string; register_id: string | null;
  cashier_id: string; subtotal: string; discount: string; total: string;
  voided: boolean; created_at: string;
  status?: 'paid' | 'partial' | null;
  stock_reserved_mode?: boolean | null;
  customer_id?: string | null;
  customer_doc_type?: number | null;
  customer_doc_number?: string | null;
  customer_legal_name?: string | null;
  customer_iva_condition?: string | null;
  sale_items?: SaleItemRow[]; sale_payments?: SalePaymentRow[];
}
function mapSale(r: SaleRow): Sale {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id,
    registerId: r.register_id, cashierId: r.cashier_id,
    items: (r.sale_items ?? []).map(mapSaleItem),
    payments: (r.sale_payments ?? []).map((p) => ({ method: p.method, amount: Number(p.amount) })),
    subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    status: (r.status ?? 'paid') as Sale['status'],
    stockReservedMode: r.stock_reserved_mode ?? false,
    voided: r.voided, createdAt: r.created_at,
    customerId: r.customer_id ?? null,
    customerDocType: (r.customer_doc_type ?? null) as Sale['customerDocType'],
    customerDocNumber: r.customer_doc_number ?? null,
    customerLegalName: r.customer_legal_name ?? null,
    customerIvaCondition: (r.customer_iva_condition ?? null) as Sale['customerIvaCondition'],
  };
}

interface CustomerRow {
  id: string; tenant_id: string; doc_type: number; doc_number: string;
  legal_name: string; iva_condition: string;
  email: string | null; notes: string | null; active: boolean;
  phone: string | null; address: string | null; city: string | null;
  state_province: string | null; birthdate: string | null;
  marketing_opt_in: boolean | null;
  credit_limit: string | number | null;
  created_at: string; updated_at: string;
}
function mapCustomer(r: CustomerRow): Customer {
  return {
    id: r.id, tenantId: r.tenant_id,
    docType: r.doc_type as Customer['docType'],
    docNumber: r.doc_number, legalName: r.legal_name,
    ivaCondition: r.iva_condition as Customer['ivaCondition'],
    email: r.email, notes: r.notes,
    phone: r.phone ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    stateProvince: r.state_province ?? null,
    birthdate: r.birthdate ?? null,
    marketingOptIn: r.marketing_opt_in ?? false,
    creditLimit: r.credit_limit == null ? null : Number(r.credit_limit),
    active: r.active,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface AfipDocumentRow {
  id: string;
  sale_id: string | null;
  doc_type: 'factura' | 'nota_credito' | 'nota_debito';
  doc_letter: 'A' | 'B' | 'C';
  sales_point: number;
  voucher_number: number | null;
  cae: string | null;
  cae_due_date: string | null;
  status: 'pending' | 'authorized' | 'rejected' | 'cancelled';
  related_doc_id: string | null;
  qr_url: string | null;
  error_message: string | null;
  created_at: string;
}
function mapAfipDocument(r: AfipDocumentRow): AfipDocumentSummary {
  return {
    id: r.id,
    saleId: r.sale_id,
    docType: r.doc_type,
    docLetter: r.doc_letter,
    salesPoint: r.sales_point,
    voucherNumber: r.voucher_number,
    cae: r.cae,
    caeDueDate: r.cae_due_date,
    status: r.status,
    relatedDocId: r.related_doc_id,
    qrUrl: r.qr_url,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  };
}

// ============================================================
// Sprint DEV: devoluciones / saldo cliente
// ============================================================
interface ReturnReasonRow {
  id: string;
  tenant_id: string;
  code: string;
  label: string;
  stock_destination: 'original' | 'specific_warehouse' | 'discard';
  destination_warehouse_id: string | null;
  allows_cash_refund: boolean | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
function mapReturnReason(r: ReturnReasonRow): ReturnReason {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    label: r.label,
    stockDestination: r.stock_destination,
    destinationWarehouseId: r.destination_warehouse_id,
    allowsCashRefund: r.allows_cash_refund ?? false,
    active: r.active,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface CustomerCreditRow {
  customer_id: string;
  balance: string | number;
  currency: string;
  updated_at: string;
}
function mapCustomerCredit(r: CustomerCreditRow): CustomerCredit {
  return {
    customerId: r.customer_id,
    balance: Number(r.balance),
    currency: r.currency,
    updatedAt: r.updated_at,
  };
}

interface CustomerCreditMovementRow {
  id: string;
  customer_id: string;
  amount: string | number;
  reason: 'return_credit' | 'sale_payment' | 'manual_adjust' | 'fiado' | 'fiado_payment';
  related_sale_id: string | null;
  related_doc_id: string | null;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
}
function mapCustomerCreditMovement(r: CustomerCreditMovementRow): CustomerCreditMovement {
  return {
    id: r.id,
    customerId: r.customer_id,
    amount: Number(r.amount),
    reason: r.reason,
    relatedSaleId: r.related_sale_id,
    relatedDocId: r.related_doc_id,
    notes: r.notes,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

// Fila extendida del historial A5a: incluye campos de contingencia/retry.
interface AfipDocumentDetailRow extends AfipDocumentRow {
  retry_count: number | null;
  last_retry_at: string | null;
  environment: 'homologation' | 'production' | null;
  emitted_at: string | null;
}
function mapAfipDocumentDetail(r: AfipDocumentDetailRow): AfipDocumentDetail {
  return {
    ...mapAfipDocument(r),
    retryCount: r.retry_count ?? 0,
    lastRetryAt: r.last_retry_at,
    environment: r.environment,
    emittedAt: r.emitted_at,
  };
}

// ============================================================

export function createSupabaseDriver(): DataDriver {
  return new SupabaseDriver();
}

class SupabaseDriver implements DataDriver {
  private sb: SupabaseClient;
  private cached: AuthSession | null = null;

  constructor() {
    this.sb = getSupabase();
  }

  // ===== AUTH =====

  async signup(input: SignupInput): Promise<AuthSession> {
    const { data, error } = await this.sb.auth.signUp({
      email: input.email,
      password: input.password,
    });
    if (error) throw new Error(error.message);

    if (!data.session) {
      throw new Error(
        'Cuenta creada pero no hay sesión. Desactivá "Confirm email" en Supabase Auth o confirmá el mail antes de continuar.',
      );
    }

    // La RPC mantiene el parámetro p_depot_name por compat con la signature
    // existente en el SQL (la migration 012 no lo renombra para no romper
    // backwards-compat). Conceptualmente ahora crea branch + warehouse default.
    // Retorna el tenant_id recién creado.
    const { data: tenantIdData, error: rpcErr } = await this.sb.rpc('create_tenant_for_owner', {
      p_tenant_name: input.tenantName,
      p_depot_name: input.branchName,
      p_owner_name: input.ownerName,
    });
    if (rpcErr) throw new Error(`Error creando tenant: ${rpcErr.message}`);

    // Sprint CRM-RETAIL: la RPC create_tenant_for_owner no acepta business_mode
    // (queda el default 'kiosk' por la migration 037). Si el onboarding pidió
    // retail, aplicamos el preset vía RPC dedicada. business_subtype se
    // updatea aparte porque el preset no lo toca.
    const businessMode: BusinessMode = input.businessMode ?? 'kiosk';
    const businessSubtype = input.businessSubtype ?? null;
    const tenantId = (tenantIdData as string | null) ?? null;

    if (businessMode === 'retail' && tenantId) {
      const { error: presetErr } = await this.sb.rpc('tenant_apply_business_mode_preset', {
        p_tenant_id: tenantId,
        p_mode: 'retail',
      });
      if (presetErr) throw new Error(`Error aplicando preset retail: ${presetErr.message}`);
    }

    if (businessSubtype && tenantId) {
      const { error: subtypeErr } = await this.sb
        .from('tenants')
        .update({ business_subtype: businessSubtype })
        .eq('id', tenantId);
      if (subtypeErr) throw new Error(`Error guardando subtipo: ${subtypeErr.message}`);
    }

    void this.sendWelcomeEmail();

    return this.loadSession();
  }

  private async sendWelcomeEmail(): Promise<void> {
    try {
      const { data: sessionData } = await this.sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-welcome-email`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
      });
    } catch (err) {
      console.warn('No se pudo mandar email de bienvenida:', err);
    }
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const { error } = await this.sb.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) throw new Error('Credenciales inválidas');
    return this.loadSession();
  }

  async logout(): Promise<void> {
    await this.sb.auth.signOut();
    this.cached = null;
  }

  async currentSession(): Promise<AuthSession | null> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) {
      this.cached = null;
      return null;
    }
    try {
      return await this.loadSession();
    } catch {
      return null;
    }
  }

  private async loadSession(): Promise<AuthSession> {
    const { data: userRes, error: userErr } = await this.sb.auth.getUser();
    if (userErr || !userRes.user) throw new Error('No autenticado');
    const userId = userRes.user.id;

    const { data: prof, error: profErr } = await this.sb
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single();
    if (profErr || !prof) throw new Error('No se encontró el perfil del usuario');

    const { data: mem, error: memErr } = await this.sb
      .from('memberships')
      .select('tenant_id, role, branch_id, permissions')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !mem) throw new Error('El usuario no tiene un tenant activo');

    // Resolver branchAccess desde user_branch_access. Una fila NULL = 'all'.
    const { data: accessRows, error: accessErr } = await this.sb
      .from('user_branch_access')
      .select('branch_id')
      .eq('user_id', userId)
      .eq('tenant_id', mem.tenant_id);
    if (accessErr) throw new Error(accessErr.message);

    const hasNullRow = (accessRows ?? []).some((r) => r.branch_id === null);
    const branchAccess: BranchAccess = hasNullRow
      ? 'all'
      : (accessRows ?? [])
          .map((r) => r.branch_id as string | null)
          .filter((id): id is string => id !== null);

    const session: AuthSession = {
      userId,
      tenantId: mem.tenant_id,
      branchId: mem.branch_id,
      role: mem.role,
      email: prof.email,
      name: prof.name,
      branchAccess,
      permissionOverrides: (mem.permissions as PermissionsMap) ?? {},
    };
    this.cached = session;
    return session;
  }

  private async requireSession(): Promise<AuthSession> {
    if (this.cached) return this.cached;
    const s = await this.currentSession();
    if (!s) throw new Error('No autenticado');
    return s;
  }

  // ===== PLAN / SUBSCRIPTION =====

  async getSubscription(): Promise<Subscription> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('subscriptions')
      .select(`
        id, tenant_id, status, trial_ends_at, current_period_start, current_period_end,
        plans:plan_id ( id, code, name, price_monthly, max_branches, max_warehouses_per_branch, max_users, max_products, features )
      `)
      .eq('tenant_id', s.tenantId)
      .single();
    if (error || !data) throw new Error('No se encontró la suscripción del tenant');

    type PlanRow = {
      id: string; code: string; name: string;
      price_monthly: string;
      max_branches: number | null;
      max_warehouses_per_branch: number | null;
      max_users: number | null;
      max_products: number | null;
      features: Record<string, boolean>;
    };
    const raw = data as unknown as { plans: PlanRow | PlanRow[] };
    const planRow = Array.isArray(raw.plans) ? raw.plans[0] : raw.plans;
    if (!planRow) throw new Error('Plan no encontrado en la suscripción');

    const plan: Plan = {
      id: planRow.id,
      code: planRow.code,
      name: planRow.name,
      priceMonthly: Number(planRow.price_monthly),
      maxBranches: planRow.max_branches,
      maxWarehousesPerBranch: planRow.max_warehouses_per_branch,
      maxUsers: planRow.max_users,
      maxProducts: planRow.max_products,
      features: planRow.features ?? {},
    };

    return {
      id: data.id,
      tenantId: data.tenant_id,
      status: data.status as SubscriptionStatus,
      trialEndsAt: data.trial_ends_at,
      currentPeriodStart: data.current_period_start,
      currentPeriodEnd: data.current_period_end,
      plan,
    };
  }

  async listPlans(): Promise<Plan[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('plans')
      .select('id, code, name, price_monthly, max_branches, max_warehouses_per_branch, max_users, max_products, features')
      .order('price_monthly', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      priceMonthly: Number(r.price_monthly),
      maxBranches: r.max_branches,
      maxWarehousesPerBranch: r.max_warehouses_per_branch,
      maxUsers: r.max_users,
      maxProducts: r.max_products,
      features: r.features ?? {},
    }));
  }

  async cancelSubscription(): Promise<void> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-subscription`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);
  }

  async clearPendingPlan(): Promise<void> {
    const s = await this.requireSession();
    const { error } = await this.sb
      .from('subscriptions')
      .update({ pending_plan_id: null })
      .eq('tenant_id', s.tenantId);
    if (error) throw new Error(error.message);
  }

  async subscribeToPlan(
    planCode: string,
    backUrl: string,
    payerEmail: string,
  ): Promise<{ initPoint: string }> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-subscription`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify({ planCode, backUrl, payerEmail }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);
    return { initPoint: body.initPoint };
  }

  async getUsage(): Promise<PlanUsage> {
    await this.requireSession();
    const [branchesRes, warehousesRes, usersRes, productsRes] = await Promise.all([
      this.sb.from('branches').select('*', { count: 'exact', head: true }),
      this.sb.from('warehouses').select('*', { count: 'exact', head: true }),
      this.sb.from('memberships').select('*', { count: 'exact', head: true }).eq('active', true),
      this.sb.from('products').select('*', { count: 'exact', head: true }),
    ]);
    if (branchesRes.error) throw new Error(branchesRes.error.message);
    if (warehousesRes.error) throw new Error(warehousesRes.error.message);
    if (usersRes.error) throw new Error(usersRes.error.message);
    if (productsRes.error) throw new Error(productsRes.error.message);

    return {
      branches: branchesRes.count ?? 0,
      warehouses: warehousesRes.count ?? 0,
      users: usersRes.count ?? 0,
      products: productsRes.count ?? 0,
    };
  }

  // ===== TENANT =====

  async getTenant(): Promise<Tenant> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('tenants')
      .select('*')
      .eq('id', s.tenantId)
      .single();
    if (error || !data) throw new Error('Tenant no encontrado');
    return mapTenant(data as TenantRow);
  }

  async updateTenantSettings(input: TenantSettingsInput): Promise<Tenant> {
    const s = await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.legalName !== undefined) patch.legal_name = input.legalName;
    if (input.taxId !== undefined) patch.tax_id = input.taxId;
    if (input.taxCondition !== undefined) patch.tax_condition = input.taxCondition;
    if (input.legalAddress !== undefined) patch.legal_address = input.legalAddress;
    if (input.city !== undefined) patch.city = input.city;
    if (input.stateProvince !== undefined) patch.state_province = input.stateProvince;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email;
    if (input.ticketTitle !== undefined) patch.ticket_title = input.ticketTitle;
    if (input.ticketFooter !== undefined) patch.ticket_footer = input.ticketFooter;
    if (input.ticketShowLogo !== undefined) patch.ticket_show_logo = input.ticketShowLogo;
    if (input.ticketShowTaxId !== undefined) patch.ticket_show_tax_id = input.ticketShowTaxId;
    if (input.ticketWidthMm !== undefined) patch.ticket_width_mm = input.ticketWidthMm;
    if (input.posAllowNegativeStock !== undefined) patch.pos_allow_negative_stock = input.posAllowNegativeStock;
    if (input.posMaxDiscountPercent !== undefined) patch.pos_max_discount_percent = input.posMaxDiscountPercent;
    if (input.posRoundTo !== undefined) patch.pos_round_to = input.posRoundTo;
    if (input.posRequireCustomer !== undefined) patch.pos_require_customer = input.posRequireCustomer;
    if (input.stockAlertsEnabled !== undefined) patch.stock_alerts_enabled = input.stockAlertsEnabled;
    if (input.skuAutoEnabled !== undefined) patch.sku_auto_enabled = input.skuAutoEnabled;
    if (input.skuPrefix !== undefined) patch.sku_prefix = input.skuPrefix;
    if (input.posPartialReservesStock !== undefined) patch.pos_partial_reserves_stock = input.posPartialReservesStock;
    if (input.refundPolicy !== undefined) patch.refund_policy = input.refundPolicy;
    if (input.storeCreditValidityMonths !== undefined) patch.store_credit_validity_months = input.storeCreditValidityMonths;
    if (input.businessMode !== undefined) patch.business_mode = input.businessMode;
    if (input.businessSubtype !== undefined) patch.business_subtype = input.businessSubtype;
    if (input.customerRequiredFields !== undefined) patch.customer_required_fields = input.customerRequiredFields;
    if (input.creditSalesEnabled !== undefined) patch.credit_sales_enabled = input.creditSalesEnabled;
    if (input.creditSalesDefaultLimit !== undefined) patch.credit_sales_default_limit = input.creditSalesDefaultLimit;

    const { data, error } = await this.sb
      .from('tenants')
      .update(patch)
      .eq('id', s.tenantId)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'No se pudo actualizar el tenant');
    return mapTenant(data as TenantRow);
  }

  async uploadTenantLogo(file: File): Promise<string> {
    const s = await this.requireSession();
    if (!file) throw new Error('No se eligió ningún archivo.');

    // Path: {tenantId}/logo.{ext}. La extensión sale del MIME para evitar
    // que extensiones falsas en el filename pasen el filtro client-side.
    const ext = file.type === 'image/jpeg' ? 'jpg'
              : file.type === 'image/webp' ? 'webp'
              : 'png';
    const path = `${s.tenantId}/logo.${ext}`;

    // Si había un logo con otra extensión, lo borramos primero (sino quedan
    // huérfanos en el bucket que cuentan como uso de Storage).
    await this.cleanupStaleLogos(s.tenantId, ext).catch(() => {
      // best-effort: si falla el cleanup no rompe el upload
    });

    const { error: upErr } = await this.sb.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw new Error(`No se pudo subir el logo: ${upErr.message}`);

    // URL pública (el bucket es público)
    const { data: urlData } = this.sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
    // Cache-buster para que el navegador no muestre el logo viejo cuando
    // sobreescribimos en la misma URL.
    const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updErr } = await this.sb
      .from('tenants')
      .update({ logo_url: publicUrl })
      .eq('id', s.tenantId);
    if (updErr) throw new Error(`Logo subido pero no se pudo guardar la URL: ${updErr.message}`);

    return publicUrl;
  }

  async removeTenantLogo(): Promise<void> {
    const s = await this.requireSession();

    // Borramos cualquier extensión que pueda haber quedado.
    await this.cleanupStaleLogos(s.tenantId, null).catch(() => {
      // best-effort
    });

    const { error: updErr } = await this.sb
      .from('tenants')
      .update({ logo_url: null })
      .eq('id', s.tenantId);
    if (updErr) throw new Error(`No se pudo limpiar el logo: ${updErr.message}`);
  }

  /**
   * Lista archivos en {tenantId}/ y borra los que no tengan la extensión que
   * vamos a subir ahora. Si keepExt es null, borra todo (caso removeTenantLogo).
   */
  private async cleanupStaleLogos(tenantId: string, keepExt: string | null): Promise<void> {
    const { data: list } = await this.sb.storage.from(LOGO_BUCKET).list(tenantId);
    if (!list || list.length === 0) return;
    const toRemove = list
      .filter((f) => keepExt === null || !f.name.endsWith(`.${keepExt}`))
      .map((f) => `${tenantId}/${f.name}`);
    if (toRemove.length === 0) return;
    await this.sb.storage.from(LOGO_BUCKET).remove(toRemove);
  }

  // ===== BRANCHES =====

  async listBranches(): Promise<Branch[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('branches')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapBranch);
  }

  async createBranch(input: BranchInput): Promise<Branch> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('branches')
      .insert({
        tenant_id: s.tenantId,
        name: input.name,
        address: input.address,
        phone: input.phone,
        email: input.email,
        active: input.active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const branch = mapBranch(data);

    const { error: whErr } = await this.sb.from('warehouses').insert({
      tenant_id: s.tenantId,
      branch_id: branch.id,
      name: input.name,
      is_default: true,
      participates_in_pos: true,
      alert_low_stock: true,
      active: true,
    });
    if (whErr) {
      await this.sb.from('branches').delete().eq('id', branch.id);
      throw new Error(`Branch creada pero falló warehouse default: ${whErr.message}`);
    }
    return branch;
  }

  async updateBranch(id: string, input: Partial<BranchInput>): Promise<Branch> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.address !== undefined) patch.address = input.address;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email;
    if (input.active !== undefined) patch.active = input.active;
    const { data, error } = await this.sb
      .from('branches')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapBranch(data);
  }

  async deleteBranch(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb.from('branches').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ===== WAREHOUSES =====

  async listWarehouses(): Promise<Warehouse[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('warehouses')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapWarehouse);
  }

  async createWarehouse(input: WarehouseInput): Promise<Warehouse> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('warehouses')
      .insert({
        tenant_id: s.tenantId,
        branch_id: input.branchId,
        name: input.name,
        is_default: input.isDefault,
        participates_in_pos: input.participatesInPos,
        alert_low_stock: input.alertLowStock,
        active: input.active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapWarehouse(data);
  }

  async updateWarehouse(id: string, input: Partial<WarehouseInput>): Promise<Warehouse> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.branchId !== undefined) patch.branch_id = input.branchId;
    if (input.isDefault !== undefined) patch.is_default = input.isDefault;
    if (input.participatesInPos !== undefined) patch.participates_in_pos = input.participatesInPos;
    if (input.alertLowStock !== undefined) patch.alert_low_stock = input.alertLowStock;
    if (input.active !== undefined) patch.active = input.active;
    const { data, error } = await this.sb
      .from('warehouses')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapWarehouse(data);
  }

  async deleteWarehouse(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb.from('warehouses').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getDefaultWarehouse(branchId: string): Promise<Warehouse | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('warehouses')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_default', true)
      .eq('active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapWarehouse(data) : null;
  }

  // ===== CATEGORIES =====

  async listCategories(): Promise<Category[]> {
    await this.requireSession();
    const { data, error } = await this.sb.from('categories').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapCategory);
  }

  async createCategory(input: CategoryInput): Promise<Category> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('categories')
      .insert({ tenant_id: s.tenantId, name: input.name })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapCategory(data);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb.from('categories').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ===== PRODUCTS =====

  async listProducts(): Promise<Product[]> {
    await this.requireSession();
    const { data, error } = await this.sb.from('products').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapProduct);
  }

  async getProduct(id: string): Promise<Product | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapProduct(data) : null;
  }

  async findProductByCode(code: string): Promise<Product | null> {
    await this.requireSession();
    // Busca por barcode primero (más común), después por SKU. Dos queries
    // separadas en lugar de un OR para evitar issues con el query builder
    // de Supabase escapando comas/dots en valores con caracteres especiales.
    const byBarcode = await this.sb
      .from('products')
      .select('*')
      .eq('barcode', code)
      .maybeSingle();
    if (byBarcode.error) throw new Error(byBarcode.error.message);
    if (byBarcode.data) return mapProduct(byBarcode.data);

    const bySku = await this.sb
      .from('products')
      .select('*')
      .eq('sku', code)
      .maybeSingle();
    if (bySku.error) throw new Error(bySku.error.message);
    return bySku.data ? mapProduct(bySku.data) : null;
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('products')
      .insert({
        tenant_id: s.tenantId,
        name: input.name,
        barcode: input.barcode,
        sku: input.sku,
        price: input.price,
        cost: input.cost,
        category_id: input.categoryId,
        tax_rate: input.taxRate,
        track_stock: input.trackStock,
        allow_sale_when_zero: input.allowSaleWhenZero,
        active: input.active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const product = mapProduct(data);

    if (input.initialStock && input.initialStock.length > 0) {
      // El trigger products_create_default_variant (migration 032) ya creó la
      // default. La buscamos para incluir variant_id en el INSERT a stock_items
      // (NOT NULL desde migration 030).
      const { data: defVar, error: varErr } = await this.sb
        .from('product_variants')
        .select('id')
        .eq('product_id', product.id)
        .eq('is_default', true)
        .single();
      if (varErr || !defVar) {
        await this.sb.from('products').delete().eq('id', product.id);
        throw new Error('Producto creado pero no se encontró la variante default');
      }
      const rows = input.initialStock.map((row) => ({
        tenant_id: s.tenantId,
        warehouse_id: row.warehouseId,
        product_id: product.id,
        variant_id: defVar.id,
        qty: row.qty,
        min_qty: row.minQty,
      }));
      const { error: stockErr } = await this.sb.from('stock_items').insert(rows);
      if (stockErr) {
        await this.sb.from('products').delete().eq('id', product.id);
        throw new Error(`Producto creado pero falló stock inicial: ${stockErr.message}`);
      }
    }
    return product;
  }

  async updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.barcode !== undefined) patch.barcode = input.barcode;
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.price !== undefined) patch.price = input.price;
    if (input.cost !== undefined) patch.cost = input.cost;
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
    if (input.trackStock !== undefined) patch.track_stock = input.trackStock;
    if (input.allowSaleWhenZero !== undefined) patch.allow_sale_when_zero = input.allowSaleWhenZero;
    if (input.active !== undefined) patch.active = input.active;

    const { data, error } = await this.sb
      .from('products')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapProduct(data);
  }

  async deleteProduct(id: string): Promise<void> {
    await this.requireSession();

    // Pre-check: si el producto ya tiene ventas o transferencias, no se puede
    // borrar (FK on delete restrict en sale_items y transfer_items). Devolvemos
    // un mensaje claro para que el dueño desactive el producto en lugar de
    // borrarlo. Borrar el histórico corrompería reportes y tickets pasados.
    const [salesRes, transfersRes] = await Promise.all([
      this.sb
        .from('sale_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id),
      this.sb
        .from('transfer_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id),
    ]);
    if (salesRes.error) throw new Error(salesRes.error.message);
    if (transfersRes.error) throw new Error(transfersRes.error.message);

    const hasSales = (salesRes.count ?? 0) > 0;
    const hasTransfers = (transfersRes.count ?? 0) > 0;
    if (hasSales || hasTransfers) {
      const motivo = hasSales ? 'ventas' : 'transferencias';
      throw new Error(
        `No se puede eliminar: el producto tiene ${motivo} asociadas. Para sacarlo del catálogo, editalo y desmarcá "Producto activo".`,
      );
    }

    const { error } = await this.sb.from('products').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ===== STOCK =====

  async listStock(warehouseId?: string): Promise<StockItem[]> {
    await this.requireSession();
    let q = this.sb.from('stock_items').select('*');
    if (warehouseId) q = q.eq('warehouse_id', warehouseId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapStock);
  }

  async adjustStock(
    productId: string,
    warehouseId: string,
    deltaQty: number,
    minQty?: number,
  ): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb.rpc('adjust_stock_atomic', {
      p_product_id: productId,
      p_warehouse_id: warehouseId,
      p_delta: deltaQty,
      p_min_qty: minQty ?? null,
    });
    if (error) throw new Error(error.message);
  }

  // ===== SALES =====

  /**
   * Resuelve la variante default de un producto. Cache local para no repetir
   * la query si un mismo product_id aparece varias veces en la sale.
   * Usado por createSale/createTransfer cuando el caller no manda variant_id.
   */
  private async resolveVariantId(
    productId: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const hit = cache.get(productId);
    if (hit) return hit;
    const { data, error } = await this.sb
      .from('product_variants')
      .select('id')
      .eq('product_id', productId)
      .eq('is_default', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        'No se encontró la variante default del producto. Migration 030 debe haber generado una.',
      );
    }
    cache.set(productId, data.id);
    return data.id;
  }

  async createSale(input: SaleInput): Promise<Sale> {
    const s = await this.requireSession();

    // Resolver variant_id para cada item. Si viene en el input se respeta;
    // si no, se busca la variante default del producto.
    const defaultCache = new Map<string, string>();
    const itemsWithVariant = await Promise.all(
      input.items.map(async (it) => {
        const variantId = it.variantId ?? (await this.resolveVariantId(it.productId, defaultCache));
        return {
          product_id: it.productId,
          variant_id: variantId,
          qty: it.qty,
          price: it.price,
          discount: it.discount,
        };
      }),
    );

    const { data: saleId, error: rpcErr } = await this.sb.rpc('create_sale_atomic', {
      p_tenant_id: s.tenantId,
      p_branch_id: input.branchId,
      p_register_id: input.registerId ?? null,
      p_discount: input.discount,
      p_items: itemsWithVariant,
      p_payments: input.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
      })),
      p_partial: input.partial ?? false,
      // Receptor (Factura A/B). Si null, todos los params quedan null en la RPC.
      p_customer_id: input.receiver?.customerId ?? null,
      p_customer_doc_type: input.receiver?.docType ?? null,
      p_customer_doc_number: input.receiver?.docNumber ?? null,
      p_customer_legal_name: input.receiver?.legalName ?? null,
      p_customer_iva_condition: input.receiver?.ivaCondition ?? null,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { data: full, error: fullErr } = await this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .eq('id', saleId)
      .single();
    if (fullErr) throw new Error(fullErr.message);
    return mapSale(full);
  }

  async voidSale(id: string): Promise<void> {
    const s = await this.requireSession();
    const { error } = await this.sb.rpc('void_sale_atomic', {
      p_tenant_id: s.tenantId,
      p_sale_id: id,
    });
    if (error) throw new Error(error.message);
  }

  async addPaymentToSale(input: AddPaymentInput): Promise<Sale> {
    const s = await this.requireSession();
    const { error: rpcErr } = await this.sb.rpc('add_payment_to_sale_atomic', {
      p_tenant_id: s.tenantId,
      p_sale_id: input.saleId,
      p_payments: input.payments.map((p) => ({ method: p.method, amount: p.amount })),
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { data: full, error: fullErr } = await this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .eq('id', input.saleId)
      .single();
    if (fullErr) throw new Error(fullErr.message);
    return mapSale(full);
  }

  async listSales(q: SalesQuery): Promise<Sale[]> {
    await this.requireSession();
    let query = this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .order('created_at', { ascending: false });
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lte('created_at', q.to);
    if (q.branchId) query = query.eq('branch_id', q.branchId);
    if (q.cashierId) query = query.eq('cashier_id', q.cashierId);
    if (q.registerId) query = query.eq('register_id', q.registerId);
    if (q.limit !== undefined) {
      const offset = q.offset ?? 0;
      query = query.range(offset, offset + q.limit - 1);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSale);
  }

  async getSale(id: string): Promise<Sale | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSale(data) : null;
  }

  // ===== CASH REGISTER =====

  async currentOpenRegister(branchId: string): Promise<CashRegister | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('cash_registers')
      .select('*')
      .eq('branch_id', branchId)
      .is('closed_at', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRegister(data) : null;
  }

  async openRegister(input: OpenRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();
    const existing = await this.currentOpenRegister(input.branchId);
    if (existing) throw new Error('Ya hay una caja abierta en esta sucursal');
    const { data, error } = await this.sb
      .from('cash_registers')
      .insert({
        tenant_id: s.tenantId,
        branch_id: input.branchId,
        opened_by: s.userId,
        opening_amount: input.openingAmount,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapRegister(data);
  }

  async closeRegister(input: CloseRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();

    const { data: regRow, error: regErr } = await this.sb
      .from('cash_registers')
      .select('*')
      .eq('id', input.registerId)
      .single();
    if (regErr || !regRow) throw new Error('Caja no encontrada');
    const reg = mapRegister(regRow);
    if (reg.closedAt) throw new Error('Caja ya cerrada');

    const { data: salesRows, error: salesErr } = await this.sb
      .from('sales')
      .select('voided, sale_payments(method, amount)')
      .eq('register_id', reg.id);
    if (salesErr) throw new Error(salesErr.message);

    let cashIn = 0;
    for (const row of salesRows ?? []) {
      if (row.voided) continue;
      for (const p of row.sale_payments as SalePaymentRow[]) {
        if (p.method === 'cash') cashIn = addMoney(cashIn, Number(p.amount));
      }
    }

    const { data: movs, error: movErr } = await this.sb
      .from('cash_movements')
      .select('kind, amount')
      .eq('register_id', reg.id);
    if (movErr) throw new Error(movErr.message);
    const movIn = addMoney(
      ...(movs ?? []).filter((m) => m.kind === 'in').map((m) => Number(m.amount)),
    );
    const movOut = addMoney(
      ...(movs ?? []).filter((m) => m.kind === 'out').map((m) => Number(m.amount)),
    );

    const expected = subMoney(addMoney(reg.openingAmount, cashIn, movIn), movOut);
    const difference = subMoney(input.closingAmount, expected);

    const { data: updated, error: updErr } = await this.sb
      .from('cash_registers')
      .update({
        closed_at: new Date().toISOString(),
        closed_by: s.userId,
        closing_amount: input.closingAmount,
        expected_cash: expected,
        difference,
        notes: input.notes,
      })
      .eq('id', reg.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return mapRegister(updated);
  }

  async addCashMovement(input: CashMovementInput): Promise<CashMovement> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('cash_movements')
      .insert({
        tenant_id: s.tenantId,
        register_id: input.registerId,
        kind: input.kind,
        amount: input.amount,
        reason: input.reason,
        created_by: s.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapMovement(data);
  }

  async listCashMovements(registerId: string): Promise<CashMovement[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('cash_movements')
      .select('*')
      .eq('register_id', registerId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapMovement);
  }

  async listRegisters(branchId?: string): Promise<CashRegister[]> {
    await this.requireSession();
    let q = this.sb
      .from('cash_registers')
      .select('*')
      .order('opened_at', { ascending: false });
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRegister);
  }

  // ===== USERS =====

  async listUsers(): Promise<User[]> {
    const s = await this.requireSession();
    const { data: mems, error: memErr } = await this.sb
      .from('memberships')
      .select('user_id, role, branch_id, active, created_at, tenant_id, permissions')
      .order('created_at', { ascending: true });
    if (memErr) throw new Error(memErr.message);
    if (!mems || mems.length === 0) return [];

    const userIds = mems.map((m) => m.user_id);
    const [profsRes, accessRes] = await Promise.all([
      this.sb.from('profiles').select('id, name, email').in('id', userIds),
      this.sb
        .from('user_branch_access')
        .select('user_id, branch_id')
        .in('user_id', userIds)
        .eq('tenant_id', s.tenantId),
    ]);
    if (profsRes.error) throw new Error(profsRes.error.message);
    if (accessRes.error) throw new Error(accessRes.error.message);

    const byId = new Map((profsRes.data ?? []).map((p) => [p.id, p]));
    const accessByUser = new Map<string, BranchAccess>();
    for (const row of accessRes.data ?? []) {
      const userId = row.user_id;
      const existing = accessByUser.get(userId);
      if (row.branch_id === null) {
        accessByUser.set(userId, 'all');
      } else if (existing !== 'all') {
        const arr = (existing as string[]) ?? [];
        accessByUser.set(userId, [...arr, row.branch_id]);
      }
    }

    return mems.map((m) => {
      const p = byId.get(m.user_id);
      return {
        id: m.user_id,
        tenantId: s.tenantId,
        email: p?.email ?? '',
        passwordHash: '',
        name: p?.name ?? '',
        role: m.role,
        branchId: m.branch_id,
        active: m.active,
        createdAt: m.created_at,
        permissionOverrides: (m.permissions as PermissionsMap) ?? {},
        branchAccess: accessByUser.get(m.user_id) ?? [],
      };
    });
  }

  async createUser(input: UserInput): Promise<User> {
    const s = await this.requireSession();
    if (!input.password) throw new Error('Password requerido para crear usuario');

    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-team-user`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.name,
        role: input.role,
        branchId: input.branchId,
        active: input.active,
        branchAccess: input.branchAccess ?? null,
        permissionOverrides: input.permissionOverrides ?? null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error ?? `Error HTTP ${res.status}`);
    }

    const created = body.user as {
      id: string;
      email: string;
      name: string;
      role: typeof input.role;
      branchId: string | null;
      active: boolean;
    };
    return {
      id: created.id,
      tenantId: s.tenantId,
      email: created.email,
      passwordHash: '',
      name: created.name,
      role: created.role,
      branchId: created.branchId,
      active: created.active,
      createdAt: new Date().toISOString(),
      permissionOverrides: input.permissionOverrides ?? {},
      branchAccess: input.branchAccess ?? [],
    };
  }

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    const s = await this.requireSession();

    if (input.name !== undefined) {
      const { error } = await this.sb
        .from('profiles')
        .update({ name: input.name })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }

    const memPatch: Record<string, unknown> = {};
    if (input.role !== undefined) memPatch.role = input.role;
    if (input.branchId !== undefined) memPatch.branch_id = input.branchId;
    if (input.active !== undefined) memPatch.active = input.active;
    if (input.permissionOverrides !== undefined) memPatch.permissions = input.permissionOverrides;
    if (Object.keys(memPatch).length > 0) {
      const { error } = await this.sb
        .from('memberships')
        .update(memPatch)
        .eq('user_id', id);
      if (error) throw new Error(error.message);
    }

    // Si el caller pasa branchAccess, reemplazamos las filas: borrar todo y
    // re-insertar el set nuevo. Es idempotente y mantiene la tabla en sync.
    if (input.branchAccess !== undefined) {
      const { error: delErr } = await this.sb
        .from('user_branch_access')
        .delete()
        .eq('user_id', id)
        .eq('tenant_id', s.tenantId);
      if (delErr) throw new Error(delErr.message);

      const rows =
        input.branchAccess === 'all'
          ? [{ user_id: id, tenant_id: s.tenantId, branch_id: null }]
          : input.branchAccess.map((bid) => ({
              user_id: id,
              tenant_id: s.tenantId,
              branch_id: bid,
            }));
      if (rows.length > 0) {
        const { error: insErr } = await this.sb.from('user_branch_access').insert(rows);
        if (insErr) throw new Error(insErr.message);
      }
    }

    const all = await this.listUsers();
    const user = all.find((u) => u.id === id);
    if (!user) throw new Error('Usuario no encontrado');
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    const s = await this.requireSession();
    if (s.userId === id) throw new Error('No podés eliminar tu propio usuario');
    const { error } = await this.sb
      .from('memberships')
      .update({ active: false })
      .eq('user_id', id);
    if (error) throw new Error(error.message);
  }

  // ===== TRANSFERS =====

  async createTransfer(input: TransferInput): Promise<Transfer> {
    const s = await this.requireSession();

    // Resolver variant_id (default si no viene). Mismo patrón que createSale.
    const defaultCache = new Map<string, string>();
    const itemsWithVariant = await Promise.all(
      input.items.map(async (it) => ({
        product_id: it.productId,
        variant_id: it.variantId ?? (await this.resolveVariantId(it.productId, defaultCache)),
        qty: it.qty,
      })),
    );

    const { data: transferId, error: rpcErr } = await this.sb.rpc(
      'create_transfer_atomic',
      {
        p_tenant_id: s.tenantId,
        p_from_warehouse_id: input.fromWarehouseId,
        p_to_warehouse_id: input.toWarehouseId,
        p_notes: input.notes ?? '',
        p_items: itemsWithVariant,
      },
    );
    if (rpcErr) throw new Error(rpcErr.message);

    const { data: header, error: headerErr } = await this.sb
      .from('transfers')
      .select('created_at')
      .eq('id', transferId as string)
      .single();
    if (headerErr) throw new Error(headerErr.message);

    return {
      id: transferId as string,
      tenantId: s.tenantId,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      createdBy: s.userId,
      notes: input.notes,
      items: input.items,
      createdAt: header.created_at,
    };
  }

  async listTransfers(): Promise<Transfer[]> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('transfers')
      .select('*, transfer_items(product_id, qty)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []).map((r) => ({
      id: r.id,
      tenantId: s.tenantId,
      fromWarehouseId: r.from_warehouse_id,
      toWarehouseId: r.to_warehouse_id,
      createdBy: r.created_by,
      notes: r.notes,
      createdAt: r.created_at,
      items: ((r.transfer_items ?? []) as { product_id: string; qty: string }[]).map((it) => ({
        productId: it.product_id,
        qty: Number(it.qty),
      })),
    }));
  }

  // ===== CUSTOMERS (mini-CRM Sprint A3.2) =====

  async listCustomers(opts?: { activeOnly?: boolean }): Promise<Customer[]> {
    await this.requireSession();
    let q = this.sb
      .from('customers')
      .select('*')
      .order('legal_name', { ascending: true });
    if (opts?.activeOnly !== false) {
      q = q.eq('active', true);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as CustomerRow[]).map(mapCustomer);
  }

  async searchCustomers(query: string): Promise<Customer[]> {
    await this.requireSession();
    const q = query.trim();
    if (!q) return this.listCustomers({ activeOnly: true });
    // Buscamos por doc_number (prefix) OR legal_name (ilike). Para combinar
    // se usa .or() de PostgREST.
    const safe = q.replace(/[%,]/g, '');
    const { data, error } = await this.sb
      .from('customers')
      .select('*')
      .eq('active', true)
      .or(`doc_number.like.${safe}%,legal_name.ilike.%${safe}%`)
      .order('legal_name', { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data as CustomerRow[]).map(mapCustomer);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapCustomer(data as CustomerRow) : null;
  }

  async findCustomerByDoc(docType: CustomerDocType, docNumber: string): Promise<Customer | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('customers')
      .select('*')
      .eq('doc_type', docType)
      .eq('doc_number', docNumber)
      .eq('active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapCustomer(data as CustomerRow) : null;
  }

  async createCustomer(input: CustomerInput): Promise<Customer> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('customers')
      .insert({
        tenant_id: s.tenantId,
        doc_type: input.docType,
        doc_number: input.docNumber,
        legal_name: input.legalName.trim(),
        iva_condition: input.ivaCondition,
        email: input.email ?? null,
        notes: input.notes ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        state_province: input.stateProvince ?? null,
        birthdate: input.birthdate ?? null,
        marketing_opt_in: input.marketingOptIn ?? false,
        active: input.active ?? true,
      })
      .select('*')
      .single();
    if (error) {
      // Codigo 23505 = unique violation (cuit duplicado activo)
      if (error.code === '23505') {
        throw new Error('Ya existe un cliente activo con ese número de documento.');
      }
      throw new Error(error.message);
    }
    return mapCustomer(data as CustomerRow);
  }

  async updateCustomer(id: string, input: Partial<CustomerInput>): Promise<Customer> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.docType !== undefined) patch.doc_type = input.docType;
    if (input.docNumber !== undefined) patch.doc_number = input.docNumber;
    if (input.legalName !== undefined) patch.legal_name = input.legalName.trim();
    if (input.ivaCondition !== undefined) patch.iva_condition = input.ivaCondition;
    if (input.email !== undefined) patch.email = input.email;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.address !== undefined) patch.address = input.address;
    if (input.city !== undefined) patch.city = input.city;
    if (input.stateProvince !== undefined) patch.state_province = input.stateProvince;
    if (input.birthdate !== undefined) patch.birthdate = input.birthdate;
    if (input.marketingOptIn !== undefined) patch.marketing_opt_in = input.marketingOptIn;
    if (input.active !== undefined) patch.active = input.active;

    const { data, error } = await this.sb
      .from('customers')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error('Ya existe un cliente activo con ese número de documento.');
      }
      throw new Error(error.message);
    }
    return mapCustomer(data as CustomerRow);
  }

  async deactivateCustomer(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb
      .from('customers')
      .update({ active: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // --- AFIP: documentos fiscales y notas de crédito (Sprint A4) ---

  async listAfipDocumentsForSale(saleId: string): Promise<AfipDocumentSummary[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('afip_documents')
      .select('id, sale_id, doc_type, doc_letter, sales_point, voucher_number, cae, cae_due_date, status, related_doc_id, qr_url, error_message, created_at')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as AfipDocumentRow[]).map(mapAfipDocument);
  }

  async emitCreditNote(input: CreditNoteInput): Promise<CreditNoteResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-emit-credit-note`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as CreditNoteResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  // --- AFIP A5a: contingencia / historial / retry ---

  async getAfipContingencySummary(): Promise<AfipContingencySummary> {
    await this.requireSession();
    // RPC afip_contingency_summary devuelve filas { rejected_count, oldest_rejected_at }.
    const { data, error } = await this.sb.rpc('afip_contingency_summary');
    if (error) throw new Error(error.message);
    const row = (data as { rejected_count: number; oldest_rejected_at: string | null }[] | null)?.[0];
    return {
      rejectedCount: row?.rejected_count ?? 0,
      oldestRejectedAt: row?.oldest_rejected_at ?? null,
    };
  }

  async listAfipDocuments(q: AfipDocumentsQuery): Promise<AfipDocumentDetail[]> {
    await this.requireSession();
    let query = this.sb
      .from('afip_documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (q.status) query = query.eq('status', q.status);
    if (q.docType) query = query.eq('doc_type', q.docType);
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lte('created_at', q.to);
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as AfipDocumentDetailRow[]).map(mapAfipDocumentDetail);
  }

  async retryAfipDocument(input: RetryDocumentInput): Promise<RetryResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-retry-document`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as RetryResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  // --- AFIP A6: onboarding via wizard (genera CSR en el server) ---

  async generateAfipCsr(input: GenerateCsrInput): Promise<GenerateCsrResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-generate-csr`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      csrPem?: string;
      alias?: string;
      environment?: 'homologation' | 'production';
      error?: string;
    };
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    if (body.error) throw new Error(body.error);
    if (!body.csrPem || !body.alias || !body.environment) {
      throw new Error('Respuesta inválida del servidor al generar CSR');
    }
    return {
      csrPem: body.csrPem,
      alias: body.alias,
      environment: body.environment,
    };
  }

  async uploadAfipCertificate(
    input: UploadAfipCertificateInput,
  ): Promise<UploadAfipCertificateResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-upload-certificate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as UploadAfipCertificateResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  // --- AFIP A7: consulta padrón ---

  async consultAfipPadron(input: ConsultAfipPadronInput): Promise<AfipPadronResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-consult-padron`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as AfipPadronResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  // --- Variantes (Sprint VAR / migration 030) ---

  async listVariants(productId?: string): Promise<ProductVariant[]> {
    await this.requireSession();
    let q = this.sb
      .from('product_variants')
      .select('*')
      // Default primero, después por antigüedad. El RLS ya filtra por tenant.
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (productId) q = q.eq('product_id', productId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as ProductVariantRow[]).map(mapProductVariant);
  }

  async createVariant(input: VariantInput): Promise<ProductVariant> {
    const s = await this.requireSession();

    if (!input.productId) throw new Error('productId es requerido');
    if (input.attributes === null || input.attributes === undefined) {
      throw new Error('attributes no puede ser null');
    }

    // Validar que el producto existe y pertenece al tenant (RLS lo cubre, pero
    // así devolvemos un error claro en vez de un FK violation cripto).
    const { data: prod, error: prodErr } = await this.sb
      .from('products')
      .select('id')
      .eq('id', input.productId)
      .maybeSingle();
    if (prodErr) throw new Error(prodErr.message);
    if (!prod) throw new Error('Producto no encontrado');

    const { data, error } = await this.sb
      .from('product_variants')
      .insert({
        tenant_id: s.tenantId,
        product_id: input.productId,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        attributes: input.attributes,
        price_override: input.priceOverride ?? null,
        cost_override: input.costOverride ?? null,
        active: input.active ?? true,
        // Nunca se crea como default por esta vía: la única default es la
        // autogenerada en migration 030.
        is_default: false,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error('Ya existe una variante con ese SKU o código de barras.');
      }
      throw new Error(error.message);
    }
    return mapProductVariant(data as ProductVariantRow);
  }

  async updateVariant(
    id: string,
    input: Partial<VariantInput>,
  ): Promise<ProductVariant> {
    await this.requireSession();

    const patch: Record<string, unknown> = {};
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.barcode !== undefined) patch.barcode = input.barcode;
    if (input.attributes !== undefined) patch.attributes = input.attributes;
    if (input.priceOverride !== undefined) patch.price_override = input.priceOverride;
    if (input.costOverride !== undefined) patch.cost_override = input.costOverride;
    if (input.active !== undefined) patch.active = input.active;
    // is_default no se toca por esta vía — se ignora silenciosamente si llega.
    // No se permite cambiar product_id de una variante (rompe la identidad).

    const { data, error } = await this.sb
      .from('product_variants')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error('Ya existe una variante con ese SKU o código de barras.');
      }
      throw new Error(error.message);
    }
    return mapProductVariant(data as ProductVariantRow);
  }

  async deleteVariant(id: string): Promise<void> {
    await this.requireSession();

    const { data: variant, error: variantErr } = await this.sb
      .from('product_variants')
      .select('id, is_default')
      .eq('id', id)
      .maybeSingle();
    if (variantErr) throw new Error(variantErr.message);
    if (!variant) throw new Error('Variante no encontrada');
    if (variant.is_default) {
      throw new Error('No se puede eliminar la variante principal del producto.');
    }

    // FK on delete restrict en sale_items.variant_id (asumido por consistencia
    // con products): chequeamos primero para devolver un mensaje claro.
    const { count, error: salesErr } = await this.sb
      .from('sale_items')
      .select('id', { count: 'exact', head: true })
      .eq('variant_id', id);
    if (salesErr) throw new Error(salesErr.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        'Esta variante tiene ventas registradas. Desactivala en vez de eliminarla.',
      );
    }

    const { error } = await this.sb.from('product_variants').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async findVariantByCode(
    code: string,
  ): Promise<{ product: Product; variant: ProductVariant } | null> {
    await this.requireSession();

    // 1) Buscar por barcode de la variante (más común en POS con scanner).
    const byBarcode = await this.sb
      .from('product_variants')
      .select('*')
      .eq('barcode', code)
      .maybeSingle();
    if (byBarcode.error) throw new Error(byBarcode.error.message);
    if (byBarcode.data) {
      const variant = mapProductVariant(byBarcode.data as ProductVariantRow);
      const product = await this.getProduct(variant.productId);
      if (!product) return null;
      return { product, variant };
    }

    // 2) Buscar por SKU de la variante.
    const bySku = await this.sb
      .from('product_variants')
      .select('*')
      .eq('sku', code)
      .maybeSingle();
    if (bySku.error) throw new Error(bySku.error.message);
    if (bySku.data) {
      const variant = mapProductVariant(bySku.data as ProductVariantRow);
      const product = await this.getProduct(variant.productId);
      if (!product) return null;
      return { product, variant };
    }

    // 3) Fallback legacy: matchear el código contra products.barcode / .sku.
    // Si matchea, devolvemos la variante default de ese producto.
    const product = await this.findProductByCode(code);
    if (!product) return null;

    const { data: defaultVariant, error: dvErr } = await this.sb
      .from('product_variants')
      .select('*')
      .eq('product_id', product.id)
      .eq('is_default', true)
      .maybeSingle();
    if (dvErr) throw new Error(dvErr.message);
    if (!defaultVariant) return null;

    return { product, variant: mapProductVariant(defaultVariant as ProductVariantRow) };
  }

  // --- Sprint DEV: devoluciones / cambios / saldo cliente ---

  async listReturnReasons(opts?: { activeOnly?: boolean }): Promise<ReturnReason[]> {
    await this.requireSession();
    let query = this.sb
      .from('return_reasons')
      .select('*')
      .order('sort_order', { ascending: true });
    if (opts?.activeOnly) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapReturnReason(r as ReturnReasonRow));
  }

  async createReturnReason(input: ReturnReasonInput): Promise<ReturnReason> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('return_reasons')
      .insert({
        tenant_id: s.tenantId,
        code: input.code,
        label: input.label,
        stock_destination: input.stockDestination,
        destination_warehouse_id: input.destinationWarehouseId ?? null,
        allows_cash_refund: input.allowsCashRefund ?? false,
        active: input.active ?? true,
        sort_order: input.sortOrder ?? 0,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapReturnReason(data as ReturnReasonRow);
  }

  async updateReturnReason(
    id: string,
    input: Partial<ReturnReasonInput>,
  ): Promise<ReturnReason> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.label !== undefined) patch.label = input.label;
    if (input.stockDestination !== undefined) patch.stock_destination = input.stockDestination;
    if (input.destinationWarehouseId !== undefined) {
      patch.destination_warehouse_id = input.destinationWarehouseId;
    }
    if (input.allowsCashRefund !== undefined) patch.allows_cash_refund = input.allowsCashRefund;
    if (input.active !== undefined) patch.active = input.active;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    const { data, error } = await this.sb
      .from('return_reasons')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapReturnReason(data as ReturnReasonRow);
  }

  async deactivateReturnReason(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb
      .from('return_reasons')
      .update({ active: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async returnSaleItems(input: ReturnSaleItemsInput): Promise<ReturnSaleItemsResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-return-items`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as ReturnSaleItemsResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  async exchangeSale(input: ExchangeSaleInput): Promise<ExchangeSaleResult> {
    await this.requireSession();
    const { data: sessionData } = await this.sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-exchange-sale`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as ExchangeSaleResult;
    if (!res.ok && body.error === undefined) {
      throw new Error(`Error HTTP ${res.status}`);
    }
    return body;
  }

  async getCustomerCredit(customerId: string): Promise<CustomerCredit | null> {
    const s = await this.requireSession();
    // Sprint DEV.fix: usar el RPC que excluye movements vencidos.
    const { data: available, error: rpcErr } = await this.sb.rpc(
      'get_customer_available_credit',
      { p_tenant_id: s.tenantId, p_customer_id: customerId },
    );
    if (rpcErr) throw new Error(rpcErr.message);
    const balance = Number(available ?? 0);
    // Para currency/updatedAt leemos el row de customer_credits si existe.
    const { data: row } = await this.sb
      .from('customer_credits')
      .select('customer_id, currency, updated_at')
      .eq('customer_id', customerId)
      .maybeSingle();
    if (!row && balance === 0) return null;
    return {
      customerId,
      balance,
      currency: (row?.currency as string | undefined) ?? 'ARS',
      updatedAt: (row?.updated_at as string | undefined) ?? new Date().toISOString(),
    };
  }

  async listCustomerCreditMovements(customerId: string): Promise<CustomerCreditMovement[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('customer_credit_movements')
      .select('id, customer_id, amount, reason, related_sale_id, related_doc_id, notes, expires_at, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapCustomerCreditMovement(r as CustomerCreditMovementRow));
  }

  // --- Sprint CRM-RETAIL: stats + listado por cliente + preset business_mode ---

  async getCustomerSalesStats(customerId: string): Promise<CustomerSalesStats> {
    const s = await this.requireSession();
    const { data, error } = await this.sb.rpc('get_customer_sales_stats', {
      p_tenant_id: s.tenantId,
      p_customer_id: customerId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { totalSpent: 0, salesCount: 0, lastSaleAt: null, firstSaleAt: null };
    }
    return {
      totalSpent: Number((row as { total_spent: string | number }).total_spent ?? 0),
      salesCount: Number((row as { sales_count: number }).sales_count ?? 0),
      lastSaleAt: (row as { last_sale_at: string | null }).last_sale_at ?? null,
      firstSaleAt: (row as { first_sale_at: string | null }).first_sale_at ?? null,
    };
  }

  async listSalesForCustomer(
    customerId: string,
    opts?: { limit?: number },
  ): Promise<Sale[]> {
    await this.requireSession();
    const limit = opts?.limit ?? 20;
    // Mismo SELECT que listSales: trae items + payments para que el mapper
    // devuelva Sale completa. Filtramos por customer_id y excluimos anuladas.
    const { data, error } = await this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .eq('customer_id', customerId)
      .eq('voided', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSale);
  }

  async applyBusinessModePreset(mode: BusinessMode): Promise<void> {
    const s = await this.requireSession();
    const { error } = await this.sb.rpc('tenant_apply_business_mode_preset', {
      p_tenant_id: s.tenantId,
      p_mode: mode,
    });
    if (error) throw new Error(error.message);
  }

  // --- Sprint FIA: cuenta corriente ---

  async validateCustomerCreditLimit(
    customerId: string,
    amount: number,
  ): Promise<CreditLimitCheck> {
    const s = await this.requireSession();
    const { data, error } = await this.sb.rpc('validate_customer_credit_limit', {
      p_tenant_id: s.tenantId,
      p_customer_id: customerId,
      p_amount: amount,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { ok: false, currentDebt: 0, limitAmount: null, reason: 'Sin respuesta del servidor' };
    }
    return {
      ok: !!(row as { ok: boolean }).ok,
      currentDebt: Number((row as { current_debt: string | number }).current_debt ?? 0),
      limitAmount:
        (row as { limit_amount: string | number | null }).limit_amount == null
          ? null
          : Number((row as { limit_amount: string | number }).limit_amount),
      reason: (row as { reason: string | null }).reason ?? null,
    };
  }

  async recordCreditPayment(
    input: RecordCreditPaymentInput,
  ): Promise<{ newBalance: number }> {
    const s = await this.requireSession();
    if (input.amount <= 0) throw new Error('El monto debe ser mayor a 0');
    const { data, error } = await this.sb.rpc('apply_customer_credit_movement', {
      p_tenant_id: s.tenantId,
      p_customer_id: input.customerId,
      p_amount: input.amount,
      p_reason: 'fiado_payment',
      p_related_sale_id: null,
      p_related_doc_id: null,
      p_notes: input.notes ?? `Pago de fiado (${input.method})`,
      p_created_by: s.userId,
      p_expires_at: null,
    });
    if (error) throw new Error(error.message);
    return { newBalance: Number(data ?? 0) };
  }

  async listCustomersWithDebt(): Promise<Array<Customer & { debt: number }>> {
    await this.requireSession();
    // customer_credits con balance < 0 → cliente debe.
    const { data, error } = await this.sb
      .from('customer_credits')
      .select(
        'balance, customer:customers(id, tenant_id, doc_type, doc_number, legal_name, iva_condition, email, notes, active, phone, address, city, state_province, birthdate, marketing_opt_in, credit_limit, created_at, updated_at)',
      )
      .lt('balance', 0)
      .order('balance', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) => {
      const cRaw = (row as { customer: CustomerRow | CustomerRow[] | null }).customer;
      const c = Array.isArray(cRaw) ? cRaw[0] : cRaw;
      if (!c) return [];
      const customer = mapCustomer(c);
      return [{ ...customer, debt: -Number((row as { balance: string | number }).balance) }];
    });
  }
}
