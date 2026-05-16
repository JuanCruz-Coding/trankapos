import { v4 as uuid } from 'uuid';
import { db } from './db';
import type {
  AuthSession,
  Branch,
  BranchAccess,
  BusinessMode,
  CashMovement,
  CashRegister,
  Category,
  CustomerCredit,
  CustomerCreditMovement,
  CustomerGroup,
  PaymentMethodConfig,
  PermissionsMap,
  Plan,
  PlanUsage,
  PriceList,
  PriceListItem,
  Product,
  ProductVariant,
  Promotion,
  ReturnReason,
  Sale,
  SaleItem,
  StockItem,
  Subscription,
  Tenant,
  TenantSettingsInput,
  Transfer,
  User,
  UserBranchAccess,
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
  CategoryInput,
  CloseRegisterInput,
  CreditNoteInput,
  CreditNoteResult,
  AfipPadronResult,
  ApplyPromotionsInput,
  ApplyPromotionsResult,
  ConsultAfipPadronInput,
  CreditLimitCheck,
  CustomerGroupInput,
  CustomerInput,
  CustomerSalesStats,
  PriceListInput,
  PriceListItemInput,
  PromotionInput,
  RecordCreditPaymentInput,
  DataDriver,
  ExchangeSaleInput,
  ExchangeSaleResult,
  PaymentMethodConfigInput,
  GenerateCsrInput,
  GenerateCsrResult,
  LoginInput,
  VariantInput,
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
  WarehouseInput,
} from '../driver';
import type { Customer, CustomerDocType } from '@/types';

// Defaults para los campos nuevos del Tenant (Sprint Settings).
// Se aplican al leer un tenant viejo que todavía no tiene estos campos.
function withTenantDefaults(t: Partial<Tenant> & Pick<Tenant, 'id' | 'name' | 'createdAt'>): Tenant {
  return {
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    legalName: t.legalName ?? t.name,
    taxId: t.taxId ?? '',
    taxCondition: t.taxCondition ?? 'monotributista',
    legalAddress: t.legalAddress ?? '',
    city: t.city ?? '',
    stateProvince: t.stateProvince ?? '',
    phone: t.phone ?? '',
    email: t.email ?? '',
    ticketTitle: t.ticketTitle ?? 'Comprobante no fiscal',
    ticketFooter: t.ticketFooter ?? '¡Gracias por su compra!',
    ticketShowLogo: t.ticketShowLogo ?? true,
    ticketShowTaxId: t.ticketShowTaxId ?? true,
    ticketWidthMm: t.ticketWidthMm ?? 80,
    posAllowNegativeStock: t.posAllowNegativeStock ?? false,
    posMaxDiscountPercent: t.posMaxDiscountPercent ?? 100,
    posRoundTo: t.posRoundTo ?? 1,
    posRequireCustomer: t.posRequireCustomer ?? false,
    stockAlertsEnabled: t.stockAlertsEnabled ?? true,
    skuAutoEnabled: t.skuAutoEnabled ?? true,
    skuPrefix: t.skuPrefix ?? '200',
    posPartialReservesStock: t.posPartialReservesStock ?? false,
    refundPolicy: t.refundPolicy ?? 'cash_or_credit',
    storeCreditValidityMonths: t.storeCreditValidityMonths ?? null,
    businessMode: t.businessMode ?? 'kiosk',
    businessSubtype: t.businessSubtype ?? null,
    customerRequiredFields: t.customerRequiredFields ?? {
      docNumber: false,
      ivaCondition: false,
      phone: false,
      email: false,
      address: false,
      birthdate: false,
    },
    creditSalesEnabled: t.creditSalesEnabled ?? false,
    creditSalesDefaultLimit: t.creditSalesDefaultLimit ?? null,
    logoUrl: t.logoUrl ?? null,
  };
}

// Replica el trigger SQL assign_product_sku para LocalDriver: si el producto
// se crea sin barcode y sin SKU manual, y el tenant tiene auto_enabled,
// genera {prefix}-{NNNN} con correlativo único.
async function generateNextSkuLocal(tenantId: string, prefix: string): Promise<string> {
  const products = await import('./db').then((m) => m.db.products.where('tenantId').equals(tenantId).toArray());
  const re = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const p of products) {
    const sku = (p as Product).sku;
    if (!sku) continue;
    const m = re.exec(sku);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(5, '0')}`;
}
import { hashPassword, verifyPassword } from '@/lib/hash';
import { addMoney, eqMoney, gtMoney, lineSubtotal, subMoney } from '@/lib/money';

const now = () => new Date().toISOString();

async function loadBranchAccessLocal(userId: string, tenantId: string): Promise<BranchAccess> {
  const dbModule = await import('./db');
  const rows = await dbModule.db.userBranchAccess
    .where('[userId+tenantId]')
    .equals([userId, tenantId])
    .toArray();
  const hasNull = rows.some((r) => r.branchId === null);
  if (hasNull) return 'all';
  return rows.map((r) => r.branchId).filter((b): b is string => b !== null);
}

async function toSession(user: User): Promise<AuthSession> {
  const branchAccess = await loadBranchAccessLocal(user.id, user.tenantId);
  return {
    userId: user.id,
    tenantId: user.tenantId,
    branchId: user.branchId,
    role: user.role,
    email: user.email,
    name: user.name,
    branchAccess,
    permissionOverrides: user.permissionOverrides ?? {},
  };
}

export class LocalDriver implements DataDriver {
  private _session: AuthSession | null = null;

  private async requireSession(): Promise<AuthSession> {
    if (this._session) return this._session;
    const row = await db.session.get('current');
    if (!row) throw new Error('No autenticado');
    const user = await db.users.get(row.userId);
    if (!user) throw new Error('Usuario no encontrado');
    this._session = await toSession(user);
    return this._session;
  }

  async signup(input: SignupInput): Promise<AuthSession> {
    const existing = await db.users.where('email').equals(input.email.toLowerCase()).first();
    if (existing) throw new Error('Ya existe una cuenta con ese email');

    const tenantId = uuid();
    const userId = uuid();
    const branchId = uuid();
    const warehouseId = uuid();
    const ts = now();

    // Sprint CRM-RETAIL: si el onboarding pidió retail, replicamos el preset
    // que aplica el trigger SQL (refund_policy=credit_only,
    // store_credit_validity_months=6, customer_required_fields con doc + cuit
    // + phone obligatorios).
    const businessMode: BusinessMode = input.businessMode ?? 'kiosk';
    const businessSubtype = input.businessSubtype ?? null;
    const retailOverrides: Partial<Tenant> =
      businessMode === 'retail'
        ? {
            refundPolicy: 'credit_only',
            storeCreditValidityMonths: 6,
            customerRequiredFields: {
              docNumber: true,
              ivaCondition: true,
              phone: true,
              email: false,
              address: false,
              birthdate: false,
            },
          }
        : {};

    const tenant: Tenant = withTenantDefaults({
      id: tenantId,
      name: input.tenantName,
      createdAt: ts,
      legalName: input.tenantName,
      businessMode,
      businessSubtype,
      ...retailOverrides,
    });
    const branch: Branch = {
      id: branchId,
      tenantId,
      name: input.branchName,
      address: '',
      phone: '',
      email: '',
      active: true,
      createdAt: ts,
    };
    const warehouse: Warehouse = {
      id: warehouseId,
      tenantId,
      branchId,
      name: input.branchName,
      isDefault: true,
      participatesInPos: true,
      alertLowStock: true,
      active: true,
      createdAt: ts,
    };
    const user: User = {
      id: userId,
      tenantId,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.ownerName,
      role: 'owner',
      branchId,
      active: true,
      createdAt: ts,
    };

    // Dexie permite hasta 5 tablas como args posicionales antes del callback;
    // con 5 tablas pasamos un array para usar la sobrecarga de array.
    await db.transaction(
      'rw',
      [db.tenants, db.branches, db.warehouses, db.users, db.userBranchAccess, db.session],
      async () => {
        await db.tenants.put(tenant);
        await db.branches.put(branch);
        await db.warehouses.put(warehouse);
        await db.users.put(user);
        // Owner del tenant nuevo arranca con acceso a todas las sucursales (NULL).
        await db.userBranchAccess.put({
          id: uuid(),
          userId,
          tenantId,
          branchId: null,
          createdAt: ts,
        });
        await db.session.put({ id: 'current', userId, tenantId, branchId });
      },
    );

    this._session = await toSession(user);
    return this._session;
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const user = await db.users.where('email').equals(input.email.toLowerCase()).first();
    if (!user || !user.active) throw new Error('Credenciales inválidas');
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw new Error('Credenciales inválidas');
    await db.session.put({
      id: 'current',
      userId: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
    });
    this._session = await toSession(user);
    return this._session;
  }

  async logout(): Promise<void> {
    await db.session.delete('current');
    this._session = null;
  }

  async currentSession(): Promise<AuthSession | null> {
    const row = await db.session.get('current');
    if (!row) return null;
    const user = await db.users.get(row.userId);
    if (!user || !user.active) return null;
    this._session = await toSession(user);
    return this._session;
  }

  async getTenant(): Promise<Tenant> {
    const s = await this.requireSession();
    const t = await db.tenants.get(s.tenantId);
    if (!t) throw new Error('Tenant no encontrado');
    return withTenantDefaults(t);
  }

  async updateTenantSettings(input: TenantSettingsInput): Promise<Tenant> {
    const s = await this.requireSession();
    const existing = await db.tenants.get(s.tenantId);
    if (!existing) throw new Error('Tenant no encontrado');
    const merged: Tenant = withTenantDefaults({
      ...existing,
      ...input,
    });
    await db.tenants.put(merged);
    return merged;
  }

  // En modo local no hay subscriptions reales — devolvemos un plan ficticio
  // sin límites. El SaaS y los chequeos de plan sólo aplican en modo Supabase.
  async getSubscription(): Promise<Subscription> {
    const s = await this.requireSession();
    return {
      id: 'local-stub',
      tenantId: s.tenantId,
      status: 'active',
      trialEndsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      plan: {
        id: 'local-stub',
        code: 'local',
        name: 'Local (sin límites)',
        priceMonthly: 0,
        maxBranches: null,
        maxWarehousesPerBranch: null,
        maxUsers: null,
        maxProducts: null,
        features: {
          scanner_camera: true,
          csv_import: true,
          csv_export: true,
          advanced_reports: true,
          transfers: true,
          customers: true,
          multi_cash: true,
          variants: true,
          purchases: true,
          audit_log: true,
          granular_perms: true,
          api: true,
          webhooks: true,
          custom_branding: true,
          central_warehouse: true,
        },
      },
    };
  }

  async getUsage(): Promise<PlanUsage> {
    const s = await this.requireSession();
    const [branches, warehouses, users, products] = await Promise.all([
      db.branches.where('tenantId').equals(s.tenantId).count(),
      db.warehouses.where('tenantId').equals(s.tenantId).count(),
      db.users.where('tenantId').equals(s.tenantId).filter((u) => u.active).count(),
      db.products.where('tenantId').equals(s.tenantId).count(),
    ]);
    return { branches, warehouses, users, products };
  }

  async listPlans(): Promise<Plan[]> {
    return [];
  }

  async subscribeToPlan(): Promise<{ initPoint: string }> {
    throw new Error('La suscripción solo funciona con el driver de Supabase.');
  }

  async cancelSubscription(): Promise<void> {
    throw new Error('La cancelación solo funciona con el driver de Supabase.');
  }

  async clearPendingPlan(): Promise<void> {
    // No aplica en LocalDriver.
  }

  async uploadTenantLogo(): Promise<string> {
    throw new Error('Subir logo solo funciona con conexión online (driver de Supabase).');
  }

  async removeTenantLogo(): Promise<void> {
    throw new Error('Eliminar logo solo funciona con conexión online (driver de Supabase).');
  }

  // --- branches ---
  async listBranches(): Promise<Branch[]> {
    const s = await this.requireSession();
    return db.branches.where('tenantId').equals(s.tenantId).toArray();
  }

  async createBranch(input: BranchInput): Promise<Branch> {
    const s = await this.requireSession();
    const branchId = uuid();
    const ts = now();
    const branch: Branch = { id: branchId, tenantId: s.tenantId, createdAt: ts, ...input };
    const warehouse: Warehouse = {
      id: uuid(),
      tenantId: s.tenantId,
      branchId,
      name: input.name,
      isDefault: true,
      participatesInPos: true,
      alertLowStock: true,
      active: input.active,
      createdAt: ts,
    };
    await db.transaction('rw', db.branches, db.warehouses, async () => {
      await db.branches.put(branch);
      await db.warehouses.put(warehouse);
    });
    return branch;
  }

  async updateBranch(id: string, input: Partial<BranchInput>): Promise<Branch> {
    const s = await this.requireSession();
    const existing = await db.branches.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Sucursal no encontrada');
    const updated: Branch = { ...existing, ...input };
    await db.branches.put(updated);
    return updated;
  }

  async deleteBranch(id: string): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.branches.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    // Cascade manual: borrar warehouses de la branch (y stock asociado).
    const whs = await db.warehouses.where('branchId').equals(id).toArray();
    await db.transaction('rw', db.branches, db.warehouses, db.stock, async () => {
      for (const w of whs) {
        const stocks = await db.stock.where('warehouseId').equals(w.id).toArray();
        await Promise.all(stocks.map((si) => db.stock.delete(si.id)));
        await db.warehouses.delete(w.id);
      }
      await db.branches.delete(id);
    });
  }

  // --- warehouses ---
  async listWarehouses(): Promise<Warehouse[]> {
    const s = await this.requireSession();
    return db.warehouses.where('tenantId').equals(s.tenantId).toArray();
  }

  async createWarehouse(input: WarehouseInput): Promise<Warehouse> {
    const s = await this.requireSession();
    const wh: Warehouse = { id: uuid(), tenantId: s.tenantId, createdAt: now(), ...input };
    await db.warehouses.put(wh);
    return wh;
  }

  async updateWarehouse(id: string, input: Partial<WarehouseInput>): Promise<Warehouse> {
    const s = await this.requireSession();
    const existing = await db.warehouses.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Depósito no encontrado');
    const updated: Warehouse = { ...existing, ...input };
    await db.warehouses.put(updated);
    return updated;
  }

  async deleteWarehouse(id: string): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.warehouses.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    await db.transaction('rw', db.warehouses, db.stock, async () => {
      const stocks = await db.stock.where('warehouseId').equals(id).toArray();
      await Promise.all(stocks.map((si) => db.stock.delete(si.id)));
      await db.warehouses.delete(id);
    });
  }

  async getDefaultWarehouse(branchId: string): Promise<Warehouse | null> {
    const s = await this.requireSession();
    const all = await db.warehouses.where('branchId').equals(branchId).toArray();
    const wh = all.find((w) => w.isDefault && w.active && w.tenantId === s.tenantId);
    return wh ?? null;
  }

  // --- users ---
  async listUsers(): Promise<User[]> {
    const s = await this.requireSession();
    const users = await db.users.where('tenantId').equals(s.tenantId).toArray();
    // Hidratamos branchAccess de cada user.
    return Promise.all(
      users.map(async (u) => {
        const access = await loadBranchAccessLocal(u.id, s.tenantId);
        return {
          ...u,
          permissionOverrides: u.permissionOverrides ?? {},
          branchAccess: access,
        };
      }),
    );
  }

  async createUser(input: UserInput): Promise<User> {
    const s = await this.requireSession();
    if (!input.password) throw new Error('Password requerido');
    const existing = await db.users.where('email').equals(input.email.toLowerCase()).first();
    if (existing) throw new Error('Email ya registrado');
    const userId = uuid();
    const ts = now();
    const user: User = {
      id: userId,
      tenantId: s.tenantId,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
      branchId: input.branchId,
      active: input.active,
      createdAt: ts,
      permissionOverrides: input.permissionOverrides ?? {},
    };

    // Resolver branchAccess: si vino explícito, usarlo. Sino owner→null, otro→branchId.
    const accessRows: UserBranchAccess[] = [];
    if (input.branchAccess === 'all') {
      accessRows.push({ id: uuid(), userId, tenantId: s.tenantId, branchId: null, createdAt: ts });
    } else if (Array.isArray(input.branchAccess) && input.branchAccess.length > 0) {
      for (const bid of input.branchAccess) {
        accessRows.push({ id: uuid(), userId, tenantId: s.tenantId, branchId: bid, createdAt: ts });
      }
    } else if (input.role === 'owner') {
      accessRows.push({ id: uuid(), userId, tenantId: s.tenantId, branchId: null, createdAt: ts });
    } else if (input.branchId) {
      accessRows.push({ id: uuid(), userId, tenantId: s.tenantId, branchId: input.branchId, createdAt: ts });
    }

    await db.transaction('rw', db.users, db.userBranchAccess, async () => {
      await db.users.put(user);
      for (const r of accessRows) await db.userBranchAccess.put(r);
    });

    return { ...user, branchAccess: input.branchAccess ?? (input.branchId ? [input.branchId] : []) };
  }

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    const s = await this.requireSession();
    const existing = await db.users.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Usuario no encontrado');
    const updated: User = {
      ...existing,
      name: input.name ?? existing.name,
      role: input.role ?? existing.role,
      branchId: input.branchId !== undefined ? input.branchId : existing.branchId,
      active: input.active ?? existing.active,
      email: input.email ? input.email.toLowerCase() : existing.email,
      passwordHash: input.password ? await hashPassword(input.password) : existing.passwordHash,
      permissionOverrides:
        input.permissionOverrides !== undefined
          ? input.permissionOverrides
          : (existing.permissionOverrides ?? {}),
    };

    await db.transaction('rw', db.users, db.userBranchAccess, async () => {
      await db.users.put(updated);

      // Si vino branchAccess, reemplazamos las filas
      if (input.branchAccess !== undefined) {
        const oldRows = await db.userBranchAccess
          .where('[userId+tenantId]')
          .equals([id, s.tenantId])
          .toArray();
        await Promise.all(oldRows.map((r) => db.userBranchAccess.delete(r.id)));

        const ts = now();
        if (input.branchAccess === 'all') {
          await db.userBranchAccess.put({
            id: uuid(),
            userId: id,
            tenantId: s.tenantId,
            branchId: null,
            createdAt: ts,
          });
        } else if (Array.isArray(input.branchAccess)) {
          for (const bid of input.branchAccess) {
            await db.userBranchAccess.put({
              id: uuid(),
              userId: id,
              tenantId: s.tenantId,
              branchId: bid,
              createdAt: ts,
            });
          }
        }
      }
    });

    const access = await loadBranchAccessLocal(id, s.tenantId);
    return { ...updated, branchAccess: access };
  }

  async deleteUser(id: string): Promise<void> {
    const s = await this.requireSession();
    if (s.userId === id) throw new Error('No podés eliminar tu propio usuario');
    const existing = await db.users.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    await db.transaction('rw', db.users, db.userBranchAccess, async () => {
      await db.users.delete(id);
      const accessRows = await db.userBranchAccess.where('userId').equals(id).toArray();
      await Promise.all(accessRows.map((r) => db.userBranchAccess.delete(r.id)));
    });
  }

  // --- categories ---
  async listCategories(): Promise<Category[]> {
    const s = await this.requireSession();
    return db.categories.where('tenantId').equals(s.tenantId).toArray();
  }

  async createCategory(input: CategoryInput): Promise<Category> {
    const s = await this.requireSession();
    const cat: Category = { id: uuid(), tenantId: s.tenantId, name: input.name, createdAt: now() };
    await db.categories.put(cat);
    return cat;
  }

  async deleteCategory(id: string): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.categories.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    await db.categories.delete(id);
  }

  // --- products ---
  async listProducts(): Promise<Product[]> {
    const s = await this.requireSession();
    return db.products.where('tenantId').equals(s.tenantId).toArray();
  }

  async getProduct(id: string): Promise<Product | null> {
    const s = await this.requireSession();
    const p = await db.products.get(id);
    if (!p || p.tenantId !== s.tenantId) return null;
    return p;
  }

  async findProductByCode(code: string): Promise<Product | null> {
    const s = await this.requireSession();
    // Probar barcode primero (índice compuesto)
    const byBarcode = await db.products
      .where('[tenantId+barcode]')
      .equals([s.tenantId, code])
      .first();
    if (byBarcode) return byBarcode;
    // Sino por SKU. Sin índice compuesto en sku — scan + filter (vol bajo).
    const all = await db.products.where('tenantId').equals(s.tenantId).toArray();
    return all.find((p) => p.sku === code) ?? null;
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const s = await this.requireSession();

    // Replica del trigger SQL assign_product_sku: si no hay sku ni barcode,
    // y el tenant tiene sku_auto_enabled, generamos uno automático.
    let finalSku = input.sku ?? null;
    if (!finalSku && !input.barcode) {
      const tenant = await this.getTenant();
      if (tenant.skuAutoEnabled) {
        finalSku = await generateNextSkuLocal(s.tenantId, tenant.skuPrefix);
      }
    }

    const product: Product = {
      id: uuid(),
      tenantId: s.tenantId,
      name: input.name,
      barcode: input.barcode,
      sku: finalSku,
      price: input.price,
      cost: input.cost,
      categoryId: input.categoryId,
      taxRate: input.taxRate,
      // Sprint PROMO: feature requiere modo online. En local siempre null.
      brand: null,
      trackStock: input.trackStock,
      allowSaleWhenZero: input.allowSaleWhenZero,
      active: input.active,
      createdAt: now(),
    };
    await db.transaction('rw', db.products, db.stock, async () => {
      await db.products.put(product);
      if (input.initialStock) {
        for (const row of input.initialStock) {
          const stock: StockItem = {
            id: uuid(),
            tenantId: s.tenantId,
            warehouseId: row.warehouseId,
            productId: product.id,
            qty: row.qty,
            qtyReserved: 0,
            minQty: row.minQty,
            updatedAt: now(),
          };
          await db.stock.put(stock);
        }
      }
    });
    return product;
  }

  async updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
    const s = await this.requireSession();
    const existing = await db.products.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Producto no encontrado');
    const updated: Product = { ...existing, ...input } as Product;
    await db.products.put(updated);
    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.products.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;

    // Misma regla que el SupabaseDriver: si hay ventas o transferencias con
    // este producto, no se puede eliminar (corrompería el histórico).
    const [allSales, allTransfers] = await Promise.all([
      db.sales.where('tenantId').equals(s.tenantId).toArray(),
      db.transfers.where('tenantId').equals(s.tenantId).toArray(),
    ]);
    const hasSales = allSales.some((sale) => sale.items.some((it) => it.productId === id));
    const hasTransfers = allTransfers.some((t) => t.items.some((it) => it.productId === id));
    if (hasSales || hasTransfers) {
      const motivo = hasSales ? 'ventas' : 'transferencias';
      throw new Error(
        `No se puede eliminar: el producto tiene ${motivo} asociadas. Para sacarlo del catálogo, editalo y desmarcá "Producto activo".`,
      );
    }

    await db.transaction('rw', db.products, db.stock, async () => {
      await db.products.delete(id);
      const stock = await db.stock.where('productId').equals(id).toArray();
      await Promise.all(stock.map((si) => db.stock.delete(si.id)));
    });
  }

  // --- stock ---
  async listStock(warehouseId?: string): Promise<StockItem[]> {
    const s = await this.requireSession();
    let items = await db.stock.where('tenantId').equals(s.tenantId).toArray();
    if (warehouseId) items = items.filter((x) => x.warehouseId === warehouseId);
    return items;
  }

  async adjustStock(
    productId: string,
    warehouseId: string,
    deltaQty: number,
    minQty?: number,
  ): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.stock
      .where('[tenantId+warehouseId+productId]')
      .equals([s.tenantId, warehouseId, productId])
      .first();
    if (existing) {
      const updated: StockItem = {
        ...existing,
        qty: existing.qty + deltaQty,
        minQty: minQty !== undefined ? minQty : existing.minQty,
        updatedAt: now(),
      };
      await db.stock.put(updated);
    } else {
      const fresh: StockItem = {
        id: uuid(),
        tenantId: s.tenantId,
        warehouseId,
        productId,
        qty: deltaQty,
        qtyReserved: 0,
        minQty: minQty ?? 0,
        updatedAt: now(),
      };
      await db.stock.put(fresh);
    }
  }

  // --- sales ---
  async createSale(input: SaleInput): Promise<Sale> {
    const s = await this.requireSession();
    if (input.items.length === 0) throw new Error('El carrito está vacío');

    const warehouse = await this.getDefaultWarehouse(input.branchId);
    if (!warehouse) throw new Error('La sucursal no tiene un depósito principal configurado');

    // Settings del tenant relevantes para la venta (paridad con SQL create_sale_atomic).
    const tenant = await this.getTenant();
    const allowNegativeGlobal = tenant.posAllowNegativeStock;
    const maxDiscountPct = tenant.posMaxDiscountPercent;
    const partialReserves = tenant.posPartialReservesStock;
    const isPartial = input.partial === true;
    // Modo de stock para esta venta: solo usa reserva si partial Y el tenant lo tiene activo.
    const stockMode = isPartial && partialReserves;

    const id = uuid();
    const ts = now();
    const products = await db.products.where('tenantId').equals(s.tenantId).toArray();
    const byId = new Map(products.map((p) => [p.id, p]));

    const items: SaleItem[] = input.items.map((it) => {
      const p = byId.get(it.productId);
      if (!p) throw new Error('Producto no encontrado en el carrito');
      if (it.qty <= 0) throw new Error(`Cantidad inválida para "${p.name}"`);
      if (it.price < 0) throw new Error(`Precio inválido para "${p.name}"`);
      if (it.discount < 0) throw new Error(`Descuento inválido para "${p.name}"`);

      // Tope de descuento por línea
      if (it.price * it.qty > 0) {
        const linePct = (it.discount / (it.price * it.qty)) * 100;
        if (linePct > maxDiscountPct) {
          throw new Error(
            `El descuento de "${p.name}" (${linePct.toFixed(2)}%) supera el tope del comercio (${maxDiscountPct}%)`,
          );
        }
      }

      const lineSub = lineSubtotal(it.price, it.qty, it.discount);
      if (lineSub < 0) {
        throw new Error(`El descuento de "${p.name}" supera el subtotal de la línea`);
      }
      return {
        id: uuid(),
        productId: p.id,
        name: p.name,
        barcode: p.barcode,
        price: it.price,
        qty: it.qty,
        discount: it.discount,
        subtotal: lineSub,
      };
    });

    if (input.discount < 0) throw new Error('Descuento global inválido');
    const subtotal = addMoney(...items.map((i) => i.subtotal));

    // Tope de descuento global
    if (subtotal > 0) {
      const globalPct = (input.discount / subtotal) * 100;
      if (globalPct > maxDiscountPct) {
        throw new Error(
          `El descuento global (${globalPct.toFixed(2)}%) supera el tope del comercio (${maxDiscountPct}%)`,
        );
      }
    }

    const total = subMoney(subtotal, input.discount);
    if (total < 0) throw new Error('El descuento global supera el subtotal');
    const paid = addMoney(...input.payments.map((p) => p.amount));

    let saleStatus: Sale['status'];
    let actualStockMode = stockMode;
    if (isPartial) {
      if (paid <= 0) throw new Error('Una seña debe tener al menos un pago');
      if (paid > total) {
        throw new Error(`El pago de la seña (${paid.toFixed(2)}) no puede superar el total (${total.toFixed(2)})`);
      }
      if (eqMoney(paid, total)) {
        // partial=true pero los pagos cubren el total: lo registramos como paid.
        saleStatus = 'paid';
        actualStockMode = false;
      } else {
        saleStatus = 'partial';
      }
    } else {
      if (!eqMoney(paid, total)) {
        throw new Error(`Pagos (${paid.toFixed(2)}) no coinciden con total (${total.toFixed(2)})`);
      }
      saleStatus = 'paid';
    }

    const sale: Sale = {
      id,
      tenantId: s.tenantId,
      branchId: input.branchId,
      registerId: input.registerId,
      cashierId: s.userId,
      items,
      payments: input.payments,
      subtotal,
      discount: input.discount,
      total,
      status: saleStatus,
      stockReservedMode: actualStockMode,
      createdAt: ts,
      voided: false,
    };

    await db.transaction('rw', db.sales, db.stock, async () => {
      await db.sales.put(sale);
      for (const it of items) {
        const product = byId.get(it.productId)!;
        // Si el producto no controla stock, no descontamos.
        if (!product.trackStock) continue;

        const stock = await db.stock
          .where('[tenantId+warehouseId+productId]')
          .equals([s.tenantId, warehouse.id, it.productId])
          .first();
        const onHand = stock?.qty ?? 0;
        const reserved = stock?.qtyReserved ?? 0;
        const available = onHand - reserved;

        if (available < it.qty) {
          if (!product.allowSaleWhenZero && !allowNegativeGlobal) {
            throw new Error(
              `Stock insuficiente para "${product.name}": disponible ${available}, solicitado ${it.qty}`,
            );
          }
        }

        if (actualStockMode) {
          // Modo reserva: sumar qtyReserved (qty no se toca)
          if (stock) {
            await db.stock.put({ ...stock, qtyReserved: reserved + it.qty, updatedAt: ts });
          } else {
            await db.stock.put({
              id: uuid(),
              tenantId: s.tenantId,
              warehouseId: warehouse.id,
              productId: it.productId,
              qty: 0,
              qtyReserved: it.qty,
              minQty: 0,
              updatedAt: ts,
            });
          }
        } else {
          // Modo se-lleva o venta normal: bajar qty
          if (stock) {
            await db.stock.put({ ...stock, qty: stock.qty - it.qty, updatedAt: ts });
          } else {
            await db.stock.put({
              id: uuid(),
              tenantId: s.tenantId,
              warehouseId: warehouse.id,
              productId: it.productId,
              qty: -it.qty,
              qtyReserved: 0,
              minQty: 0,
              updatedAt: ts,
            });
          }
        }
      }
    });

    return sale;
  }

  async addPaymentToSale(input: AddPaymentInput): Promise<Sale> {
    const s = await this.requireSession();
    if (input.payments.length === 0) throw new Error('No hay pagos para agregar');

    const sale = await db.sales.get(input.saleId);
    if (!sale || sale.tenantId !== s.tenantId) throw new Error('Venta no encontrada');
    if (sale.status === 'paid') throw new Error('La venta ya está saldada');

    const ts = now();
    const paidSoFar = addMoney(...sale.payments.map((p) => p.amount));
    const newAmount = addMoney(...input.payments.map((p) => p.amount));

    for (const p of input.payments) {
      if (p.amount <= 0) throw new Error('Los montos de pago deben ser mayores a 0');
    }

    const totalAfter = addMoney(paidSoFar, newAmount);
    if (gtMoney(totalAfter, addMoney(sale.total, 0.005))) {
      throw new Error(
        `Los pagos (${newAmount.toFixed(2)}) superan el saldo pendiente (${subMoney(sale.total, paidSoFar).toFixed(2)})`,
      );
    }

    const willPromote = eqMoney(totalAfter, sale.total);
    const updatedSale: Sale = {
      ...sale,
      payments: [...sale.payments, ...input.payments],
      status: willPromote ? 'paid' : 'partial',
    };

    await db.transaction('rw', db.sales, db.stock, async () => {
      await db.sales.put(updatedSale);

      // Si llegó al total y el stock estaba reservado, materializar
      if (willPromote && sale.stockReservedMode) {
        const warehouse = await this.getDefaultWarehouse(sale.branchId);
        if (!warehouse) return;
        for (const it of sale.items) {
          const stock = await db.stock
            .where('[tenantId+warehouseId+productId]')
            .equals([s.tenantId, warehouse.id, it.productId])
            .first();
          if (!stock) continue;
          await db.stock.put({
            ...stock,
            qty: stock.qty - it.qty,
            qtyReserved: Math.max((stock.qtyReserved ?? 0) - it.qty, 0),
            updatedAt: ts,
          });
        }
      }
    });

    return updatedSale;
  }

  async voidSale(id: string): Promise<void> {
    const s = await this.requireSession();
    const sale = await db.sales.get(id);
    if (!sale || sale.tenantId !== s.tenantId) throw new Error('Venta no encontrada');
    if (sale.voided) return;
    const warehouse = await this.getDefaultWarehouse(sale.branchId);
    if (!warehouse) throw new Error('La sucursal de la venta no tiene un depósito principal');
    const ts = now();
    // Si la venta era partial con stock reservado y aún no se materializó, liberamos qty_reserved.
    // Sino sumamos qty (devolución estándar).
    const releaseReserved = sale.status === 'partial' && sale.stockReservedMode;
    await db.transaction('rw', db.sales, db.stock, async () => {
      await db.sales.put({ ...sale, voided: true });
      for (const it of sale.items) {
        const stock = await db.stock
          .where('[tenantId+warehouseId+productId]')
          .equals([s.tenantId, warehouse.id, it.productId])
          .first();
        if (!stock) continue;
        if (releaseReserved) {
          await db.stock.put({
            ...stock,
            qtyReserved: Math.max((stock.qtyReserved ?? 0) - it.qty, 0),
            updatedAt: ts,
          });
        } else {
          await db.stock.put({ ...stock, qty: stock.qty + it.qty, updatedAt: ts });
        }
      }
    });
  }

  async listSales(q: SalesQuery): Promise<Sale[]> {
    const s = await this.requireSession();
    let sales = await db.sales.where('tenantId').equals(s.tenantId).toArray();
    if (q.from) sales = sales.filter((x) => x.createdAt >= q.from!);
    if (q.to) sales = sales.filter((x) => x.createdAt <= q.to!);
    if (q.branchId) sales = sales.filter((x) => x.branchId === q.branchId);
    if (q.cashierId) sales = sales.filter((x) => x.cashierId === q.cashierId);
    if (q.registerId) sales = sales.filter((x) => x.registerId === q.registerId);
    sales = sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (q.limit !== undefined) {
      const offset = q.offset ?? 0;
      sales = sales.slice(offset, offset + q.limit);
    }
    return sales;
  }

  async getSale(id: string): Promise<Sale | null> {
    const s = await this.requireSession();
    const sale = await db.sales.get(id);
    if (!sale || sale.tenantId !== s.tenantId) return null;
    return sale;
  }

  // --- cash register ---
  async currentOpenRegister(branchId: string): Promise<CashRegister | null> {
    const s = await this.requireSession();
    const all = await db.registers.where('tenantId').equals(s.tenantId).toArray();
    return all.find((r) => r.branchId === branchId && !r.closedAt) ?? null;
  }

  async openRegister(input: OpenRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();
    const existing = await this.currentOpenRegister(input.branchId);
    if (existing) throw new Error('Ya hay una caja abierta en esta sucursal');
    const reg: CashRegister = {
      id: uuid(),
      tenantId: s.tenantId,
      branchId: input.branchId,
      openedBy: s.userId,
      openedAt: now(),
      openingAmount: input.openingAmount,
      closedAt: null,
      closedBy: null,
      closingAmount: null,
      expectedCash: null,
      difference: null,
      notes: null,
    };
    await db.registers.put(reg);
    return reg;
  }

  async closeRegister(input: CloseRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();
    const reg = await db.registers.get(input.registerId);
    if (!reg || reg.tenantId !== s.tenantId) throw new Error('Caja no encontrada');
    if (reg.closedAt) throw new Error('Caja ya cerrada');
    const sales = await db.sales.where('tenantId').equals(s.tenantId).toArray();
    const regSales = sales.filter((x) => x.registerId === reg.id && !x.voided);
    const cashAmounts = regSales.flatMap((sale) =>
      sale.payments.filter((p) => p.method === 'cash').map((p) => p.amount),
    );
    const cashIn = addMoney(...cashAmounts);
    const movements = await db.cashMovements.where('registerId').equals(reg.id).toArray();
    const movIn = addMoney(...movements.filter((m) => m.kind === 'in').map((m) => m.amount));
    const movOut = addMoney(...movements.filter((m) => m.kind === 'out').map((m) => m.amount));
    const expected = subMoney(addMoney(reg.openingAmount, cashIn, movIn), movOut);
    const updated: CashRegister = {
      ...reg,
      closedAt: now(),
      closedBy: s.userId,
      closingAmount: input.closingAmount,
      expectedCash: expected,
      difference: subMoney(input.closingAmount, expected),
      notes: input.notes,
    };
    await db.registers.put(updated);
    return updated;
  }

  async addCashMovement(input: CashMovementInput): Promise<CashMovement> {
    const s = await this.requireSession();
    const mv: CashMovement = {
      id: uuid(),
      tenantId: s.tenantId,
      registerId: input.registerId,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason,
      createdBy: s.userId,
      createdAt: now(),
    };
    await db.cashMovements.put(mv);
    return mv;
  }

  async listCashMovements(registerId: string): Promise<CashMovement[]> {
    return db.cashMovements.where('registerId').equals(registerId).toArray();
  }

  async listRegisters(branchId?: string): Promise<CashRegister[]> {
    const s = await this.requireSession();
    let regs = await db.registers.where('tenantId').equals(s.tenantId).toArray();
    if (branchId) regs = regs.filter((r) => r.branchId === branchId);
    return regs.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  // --- transfers ---
  async createTransfer(input: TransferInput): Promise<Transfer> {
    const s = await this.requireSession();
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new Error('Origen y destino deben ser distintos');
    }
    if (input.items.length === 0) {
      throw new Error('La transferencia no tiene items');
    }
    const id = uuid();
    const ts = now();
    const transfer: Transfer = {
      id,
      tenantId: s.tenantId,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      createdBy: s.userId,
      createdAt: ts,
      notes: input.notes,
      items: input.items,
    };

    const products = await db.products.where('tenantId').equals(s.tenantId).toArray();
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (it.qty <= 0) throw new Error('Las cantidades deben ser mayores a cero');
      const src = await db.stock
        .where('[tenantId+warehouseId+productId]')
        .equals([s.tenantId, input.fromWarehouseId, it.productId])
        .first();
      const available = src?.qty ?? 0;
      if (available < it.qty) {
        const name = productById.get(it.productId)?.name ?? 'producto';
        throw new Error(
          `Stock insuficiente de "${name}" en el depósito origen (disponible: ${available}, pedido: ${it.qty})`,
        );
      }
    }

    await db.transaction('rw', db.transfers, db.stock, async () => {
      await db.transfers.put(transfer);
      for (const it of input.items) {
        const src = await db.stock
          .where('[tenantId+warehouseId+productId]')
          .equals([s.tenantId, input.fromWarehouseId, it.productId])
          .first();
        if (src) {
          await db.stock.put({ ...src, qty: src.qty - it.qty, updatedAt: ts });
        }
        const dst = await db.stock
          .where('[tenantId+warehouseId+productId]')
          .equals([s.tenantId, input.toWarehouseId, it.productId])
          .first();
        if (dst) {
          await db.stock.put({ ...dst, qty: dst.qty + it.qty, updatedAt: ts });
        } else {
          await db.stock.put({
            id: uuid(),
            tenantId: s.tenantId,
            warehouseId: input.toWarehouseId,
            productId: it.productId,
            qty: it.qty,
            qtyReserved: 0,
            minQty: 0,
            updatedAt: ts,
          });
        }
      }
    });
    return transfer;
  }

  async listTransfers(): Promise<Transfer[]> {
    const s = await this.requireSession();
    const all = await db.transfers.where('tenantId').equals(s.tenantId).toArray();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ===== CUSTOMERS (Sprint A3.2) =====
  // Stubs en modo local: el CRM no es crítico offline. AFIP requiere
  // conexión siempre, así que customers solo se usan en flow online.
  // Si en el futuro queremos soporte offline real, agregar tabla a Dexie.

  async listCustomers(): Promise<Customer[]> {
    await this.requireSession();
    return [];
  }

  async searchCustomers(): Promise<Customer[]> {
    await this.requireSession();
    return [];
  }

  async getCustomer(_id: string): Promise<Customer | null> {
    await this.requireSession();
    return null;
  }

  async findCustomerByDoc(_docType: CustomerDocType, _docNumber: string): Promise<Customer | null> {
    await this.requireSession();
    return null;
  }

  async createCustomer(_input: CustomerInput): Promise<Customer> {
    await this.requireSession();
    throw new Error('La gestión de clientes requiere modo online.');
  }

  async updateCustomer(_id: string, _input: Partial<CustomerInput>): Promise<Customer> {
    await this.requireSession();
    throw new Error('La gestión de clientes requiere modo online.');
  }

  async deactivateCustomer(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('La gestión de clientes requiere modo online.');
  }

  // --- AFIP: documentos fiscales y notas de crédito (Sprint A4) ---
  // AFIP requiere conexión siempre — en modo local no hay documentos fiscales.
  async listAfipDocumentsForSale(_saleId: string): Promise<AfipDocumentSummary[]> {
    await this.requireSession();
    return [];
  }

  async emitCreditNote(_input: CreditNoteInput): Promise<CreditNoteResult> {
    await this.requireSession();
    throw new Error('La emisión de comprobantes AFIP requiere modo online.');
  }

  // --- AFIP A5a: contingencia / historial / retry ---
  // Modo offline: no hay documentos AFIP. Summary en ceros, listado vacío,
  // retry no disponible.
  async getAfipContingencySummary(): Promise<AfipContingencySummary> {
    await this.requireSession();
    return { rejectedCount: 0, oldestRejectedAt: null };
  }

  async listAfipDocuments(_q: AfipDocumentsQuery): Promise<AfipDocumentDetail[]> {
    await this.requireSession();
    return [];
  }

  async retryAfipDocument(_input: RetryDocumentInput): Promise<RetryResult> {
    await this.requireSession();
    throw new Error('El reintento de comprobantes AFIP requiere modo online.');
  }

  // --- AFIP A6: onboarding via wizard ---
  // Modo offline: no se puede onboardear AFIP (requiere generar key + persistir cifrada).
  async generateAfipCsr(_input: GenerateCsrInput): Promise<GenerateCsrResult> {
    await this.requireSession();
    throw new Error('El onboarding AFIP requiere modo online.');
  }

  async uploadAfipCertificate(
    _input: UploadAfipCertificateInput,
  ): Promise<UploadAfipCertificateResult> {
    await this.requireSession();
    throw new Error('El onboarding AFIP requiere modo online.');
  }

  // --- AFIP A7: consulta padrón ---
  async consultAfipPadron(_input: ConsultAfipPadronInput): Promise<AfipPadronResult> {
    await this.requireSession();
    throw new Error('La consulta al padrón AFIP requiere modo online.');
  }

  // --- Variantes (Sprint VAR) ---
  // Modo offline: el catálogo local todavía no soporta variantes. Las queries de
  // lista/find devuelven vacío para no romper la app; las mutaciones tiran error.
  async listVariants(_productId?: string): Promise<ProductVariant[]> {
    await this.requireSession();
    return [];
  }
  async createVariant(_input: VariantInput): Promise<ProductVariant> {
    await this.requireSession();
    throw new Error('Las variantes de producto requieren modo online (por ahora).');
  }
  async updateVariant(
    _id: string,
    _input: Partial<VariantInput>,
  ): Promise<ProductVariant> {
    await this.requireSession();
    throw new Error('Las variantes de producto requieren modo online (por ahora).');
  }
  async deleteVariant(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Las variantes de producto requieren modo online (por ahora).');
  }
  async findVariantByCode(
    _code: string,
  ): Promise<{ product: Product; variant: ProductVariant } | null> {
    await this.requireSession();
    return null;
  }

  // --- Sprint DEV: devoluciones / cambios / saldo cliente ---
  // Modo offline: nada de esto está soportado por ahora.
  async listReturnReasons(_opts?: { activeOnly?: boolean }): Promise<ReturnReason[]> {
    await this.requireSession();
    return [];
  }
  async createReturnReason(_input: ReturnReasonInput): Promise<ReturnReason> {
    await this.requireSession();
    throw new Error('Las devoluciones requieren modo online (por ahora).');
  }
  async updateReturnReason(
    _id: string,
    _input: Partial<ReturnReasonInput>,
  ): Promise<ReturnReason> {
    await this.requireSession();
    throw new Error('Las devoluciones requieren modo online (por ahora).');
  }
  async deactivateReturnReason(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Las devoluciones requieren modo online (por ahora).');
  }
  async returnSaleItems(_input: ReturnSaleItemsInput): Promise<ReturnSaleItemsResult> {
    await this.requireSession();
    throw new Error('Las devoluciones requieren modo online (por ahora).');
  }
  async exchangeSale(_input: ExchangeSaleInput): Promise<ExchangeSaleResult> {
    await this.requireSession();
    throw new Error('Los cambios requieren modo online (por ahora).');
  }
  async getCustomerCredit(_customerId: string): Promise<CustomerCredit | null> {
    await this.requireSession();
    return null;
  }
  async listCustomerCreditMovements(_customerId: string): Promise<CustomerCreditMovement[]> {
    await this.requireSession();
    return [];
  }

  // --- Sprint CRM-RETAIL: stats + listado por cliente + preset business_mode ---
  async getCustomerSalesStats(_customerId: string): Promise<CustomerSalesStats> {
    await this.requireSession();
    return { totalSpent: 0, salesCount: 0, lastSaleAt: null, firstSaleAt: null };
  }
  async listSalesForCustomer(_customerId: string, _opts?: { limit?: number }): Promise<Sale[]> {
    await this.requireSession();
    return [];
  }
  async applyBusinessModePreset(_mode: BusinessMode): Promise<void> {
    await this.requireSession();
    throw new Error('El cambio de modo del negocio requiere modo online.');
  }

  // --- Sprint FIA: cuenta corriente (stubs offline) ---
  async validateCustomerCreditLimit(
    _customerId: string,
    _amount: number,
  ): Promise<CreditLimitCheck> {
    await this.requireSession();
    return { ok: false, currentDebt: 0, limitAmount: null, reason: 'Requiere modo online' };
  }
  async recordCreditPayment(
    _input: RecordCreditPaymentInput,
  ): Promise<{ newBalance: number }> {
    await this.requireSession();
    throw new Error('Los pagos de cuenta corriente requieren modo online.');
  }
  async listCustomersWithDebt(): Promise<Array<Customer & { debt: number }>> {
    await this.requireSession();
    return [];
  }

  // --- Sprint PRC: listas de precios (stubs offline) ---
  async listPriceLists(_opts?: { activeOnly?: boolean }): Promise<PriceList[]> {
    await this.requireSession();
    return [];
  }
  async createPriceList(_input: PriceListInput): Promise<PriceList> {
    await this.requireSession();
    throw new Error('Las listas de precios requieren modo online (por ahora).');
  }
  async updatePriceList(_id: string, _input: Partial<PriceListInput>): Promise<PriceList> {
    await this.requireSession();
    throw new Error('Las listas de precios requieren modo online (por ahora).');
  }
  async deactivatePriceList(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Las listas de precios requieren modo online (por ahora).');
  }
  async listPriceListItems(_priceListId: string): Promise<PriceListItem[]> {
    await this.requireSession();
    return [];
  }
  async upsertPriceListItem(_input: PriceListItemInput): Promise<PriceListItem> {
    await this.requireSession();
    throw new Error('Las listas de precios requieren modo online (por ahora).');
  }
  async deletePriceListItem(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Las listas de precios requieren modo online (por ahora).');
  }
  async getEffectivePrice(_input: {
    productId: string;
    variantId?: string | null;
    priceListId?: string | null;
  }): Promise<number> {
    await this.requireSession();
    return 0;
  }

  // --- Sprint PMP: medios de pago configurables (stubs offline) ---
  async listPaymentMethods(_opts?: { activeOnly?: boolean }): Promise<PaymentMethodConfig[]> {
    await this.requireSession();
    return [];
  }
  async createPaymentMethod(_input: PaymentMethodConfigInput): Promise<PaymentMethodConfig> {
    await this.requireSession();
    throw new Error('Los medios de pago configurables requieren modo online.');
  }
  async updatePaymentMethod(
    _id: string,
    _input: Partial<PaymentMethodConfigInput>,
  ): Promise<PaymentMethodConfig> {
    await this.requireSession();
    throw new Error('Los medios de pago configurables requieren modo online.');
  }
  async deactivatePaymentMethod(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Los medios de pago configurables requieren modo online.');
  }

  // --- Sprint PROMO: customer groups + promociones (stubs offline) ---
  async listCustomerGroups(_opts?: { activeOnly?: boolean }): Promise<CustomerGroup[]> {
    await this.requireSession();
    return [];
  }
  async createCustomerGroup(_input: CustomerGroupInput): Promise<CustomerGroup> {
    await this.requireSession();
    throw new Error('Grupos de cliente requieren modo online.');
  }
  async updateCustomerGroup(
    _id: string,
    _input: Partial<CustomerGroupInput>,
  ): Promise<CustomerGroup> {
    await this.requireSession();
    throw new Error('Grupos de cliente requieren modo online.');
  }
  async deactivateCustomerGroup(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Grupos de cliente requieren modo online.');
  }

  async listPromotions(_opts?: { activeOnly?: boolean }): Promise<Promotion[]> {
    await this.requireSession();
    return [];
  }
  async createPromotion(_input: PromotionInput): Promise<Promotion> {
    await this.requireSession();
    throw new Error('Promociones requieren modo online.');
  }
  async updatePromotion(_id: string, _input: Partial<PromotionInput>): Promise<Promotion> {
    await this.requireSession();
    throw new Error('Promociones requieren modo online.');
  }
  async deactivatePromotion(_id: string): Promise<void> {
    await this.requireSession();
    throw new Error('Promociones requieren modo online.');
  }
  async applyPromotionsToCart(_input: ApplyPromotionsInput): Promise<ApplyPromotionsResult> {
    await this.requireSession();
    // Local nunca aplica promos.
    return { totalDiscount: 0, applied: [] };
  }
}
