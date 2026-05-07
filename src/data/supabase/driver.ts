import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { addMoney, lineSubtotal, subMoney, eqMoney } from '@/lib/money';
import type {
  AuthSession,
  CashMovement,
  CashRegister,
  Category,
  Depot,
  PaymentMethod,
  Plan,
  PlanUsage,
  Product,
  Sale,
  SaleItem,
  StockItem,
  Subscription,
  SubscriptionStatus,
  Tenant,
  Transfer,
  User,
} from '@/types';
import type {
  CashMovementInput,
  CategoryInput,
  CloseRegisterInput,
  DataDriver,
  DepotInput,
  LoginInput,
  OpenRegisterInput,
  ProductInput,
  SaleInput,
  SalesQuery,
  SignupInput,
  TransferInput,
  UserInput,
} from '../driver';

const NOT_IMPL = (name: string) =>
  new Error(`SupabaseDriver.${name}() todavía no está implementado.`);

// ============================================================
// Mappers DB → TS. Postgres `numeric` viene como string en JSON.
// ============================================================

interface DepotRow { id: string; tenant_id: string; name: string; address: string; active: boolean; created_at: string; }
function mapDepot(r: DepotRow): Depot {
  return { id: r.id, tenantId: r.tenant_id, name: r.name, address: r.address, active: r.active, createdAt: r.created_at };
}

interface CategoryRow { id: string; tenant_id: string; name: string; created_at: string; }
function mapCategory(r: CategoryRow): Category {
  return { id: r.id, tenantId: r.tenant_id, name: r.name, createdAt: r.created_at };
}

interface ProductRow {
  id: string; tenant_id: string; name: string; barcode: string | null;
  price: string; cost: string; category_id: string | null; tax_rate: string;
  active: boolean; created_at: string;
}
function mapProduct(r: ProductRow): Product {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, barcode: r.barcode,
    price: Number(r.price), cost: Number(r.cost),
    categoryId: r.category_id, taxRate: Number(r.tax_rate),
    active: r.active, createdAt: r.created_at,
  };
}

interface StockRow {
  id: string; tenant_id: string; depot_id: string; product_id: string;
  qty: string; min_qty: string; updated_at: string;
}
function mapStock(r: StockRow): StockItem {
  return {
    id: r.id, tenantId: r.tenant_id, depotId: r.depot_id, productId: r.product_id,
    qty: Number(r.qty), minQty: Number(r.min_qty), updatedAt: r.updated_at,
  };
}

interface RegisterRow {
  id: string; tenant_id: string; depot_id: string; opened_by: string; opened_at: string;
  opening_amount: string; closed_at: string | null; closed_by: string | null;
  closing_amount: string | null; expected_cash: string | null; difference: string | null;
  notes: string | null;
}
function mapRegister(r: RegisterRow): CashRegister {
  return {
    id: r.id, tenantId: r.tenant_id, depotId: r.depot_id,
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
}
function mapSaleItem(r: SaleItemRow): SaleItem {
  return {
    id: r.id, productId: r.product_id, name: r.name, barcode: r.barcode,
    price: Number(r.price), qty: Number(r.qty),
    discount: Number(r.discount), subtotal: Number(r.subtotal),
  };
}

interface SalePaymentRow { method: PaymentMethod; amount: string; }
interface SaleRow {
  id: string; tenant_id: string; depot_id: string; register_id: string | null;
  cashier_id: string; subtotal: string; discount: string; total: string;
  voided: boolean; created_at: string;
  sale_items?: SaleItemRow[]; sale_payments?: SalePaymentRow[];
}
function mapSale(r: SaleRow): Sale {
  return {
    id: r.id, tenantId: r.tenant_id, depotId: r.depot_id,
    registerId: r.register_id, cashierId: r.cashier_id,
    items: (r.sale_items ?? []).map(mapSaleItem),
    payments: (r.sale_payments ?? []).map((p) => ({ method: p.method, amount: Number(p.amount) })),
    subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    voided: r.voided, createdAt: r.created_at,
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

    const { error: rpcErr } = await this.sb.rpc('create_tenant_for_owner', {
      p_tenant_name: input.tenantName,
      p_depot_name: input.depotName,
      p_owner_name: input.ownerName,
    });
    if (rpcErr) throw new Error(`Error creando tenant: ${rpcErr.message}`);

    return this.loadSession();
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
      .select('tenant_id, role, depot_id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !mem) throw new Error('El usuario no tiene un tenant activo');

    const session: AuthSession = {
      userId,
      tenantId: mem.tenant_id,
      depotId: mem.depot_id,
      role: mem.role,
      email: prof.email,
      name: prof.name,
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
        plans:plan_id ( id, code, name, price_monthly, max_depots, max_users, max_products, features )
      `)
      .eq('tenant_id', s.tenantId)
      .single();
    if (error || !data) throw new Error('No se encontró la suscripción del tenant');

    type PlanRow = {
      id: string; code: string; name: string;
      price_monthly: string;
      max_depots: number | null;
      max_users: number | null;
      max_products: number | null;
      features: Record<string, boolean>;
    };
    // Supabase devuelve los joins many-to-one como array. Tomamos el primero.
    const raw = data as unknown as { plans: PlanRow | PlanRow[] };
    const planRow = Array.isArray(raw.plans) ? raw.plans[0] : raw.plans;
    if (!planRow) throw new Error('Plan no encontrado en la suscripción');

    const plan: Plan = {
      id: planRow.id,
      code: planRow.code,
      name: planRow.name,
      priceMonthly: Number(planRow.price_monthly),
      maxDepots: planRow.max_depots,
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
      .select('id, code, name, price_monthly, max_depots, max_users, max_products, features')
      .order('price_monthly', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      priceMonthly: Number(r.price_monthly),
      maxDepots: r.max_depots,
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
    // 3 counts en paralelo. Usamos `head: true` para que Supabase no traiga
    // las filas — solo pide el header con el count, mucho más liviano.
    const [depotsRes, usersRes, productsRes] = await Promise.all([
      this.sb.from('depots').select('*', { count: 'exact', head: true }),
      this.sb.from('memberships').select('*', { count: 'exact', head: true }).eq('active', true),
      this.sb.from('products').select('*', { count: 'exact', head: true }),
    ]);
    if (depotsRes.error) throw new Error(depotsRes.error.message);
    if (usersRes.error) throw new Error(usersRes.error.message);
    if (productsRes.error) throw new Error(productsRes.error.message);

    return {
      depots: depotsRes.count ?? 0,
      users: usersRes.count ?? 0,
      products: productsRes.count ?? 0,
    };
  }

  // ===== TENANT =====

  async getTenant(): Promise<Tenant> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('tenants')
      .select('id, name, created_at')
      .eq('id', s.tenantId)
      .single();
    if (error || !data) throw new Error('Tenant no encontrado');
    return { id: data.id, name: data.name, createdAt: data.created_at };
  }

  // ===== DEPOTS =====

  async listDepots(): Promise<Depot[]> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('depots')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapDepot);
  }

  async createDepot(input: DepotInput): Promise<Depot> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('depots')
      .insert({
        tenant_id: s.tenantId,
        name: input.name,
        address: input.address,
        active: input.active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapDepot(data);
  }

  async updateDepot(id: string, input: Partial<DepotInput>): Promise<Depot> {
    await this.requireSession();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.address !== undefined) patch.address = input.address;
    if (input.active !== undefined) patch.active = input.active;
    const { data, error } = await this.sb
      .from('depots')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapDepot(data);
  }

  async deleteDepot(id: string): Promise<void> {
    await this.requireSession();
    const { error } = await this.sb.from('depots').delete().eq('id', id);
    if (error) throw new Error(error.message);
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

  async findProductByBarcode(barcode: string): Promise<Product | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('products')
      .select('*')
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapProduct(data) : null;
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const s = await this.requireSession();
    const { data, error } = await this.sb
      .from('products')
      .insert({
        tenant_id: s.tenantId,
        name: input.name,
        barcode: input.barcode,
        price: input.price,
        cost: input.cost,
        category_id: input.categoryId,
        tax_rate: input.taxRate,
        active: input.active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const product = mapProduct(data);

    if (input.initialStock && input.initialStock.length > 0) {
      const rows = input.initialStock.map((row) => ({
        tenant_id: s.tenantId,
        depot_id: row.depotId,
        product_id: product.id,
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
    if (input.price !== undefined) patch.price = input.price;
    if (input.cost !== undefined) patch.cost = input.cost;
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
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
    const { error } = await this.sb.from('products').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ===== STOCK =====

  async listStock(depotId?: string): Promise<StockItem[]> {
    await this.requireSession();
    let q = this.sb.from('stock_items').select('*');
    if (depotId) q = q.eq('depot_id', depotId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapStock);
  }

  async adjustStock(
    productId: string,
    depotId: string,
    deltaQty: number,
    minQty?: number,
  ): Promise<void> {
    const s = await this.requireSession();
    const { data: existing, error: selErr } = await this.sb
      .from('stock_items')
      .select('id, qty, min_qty')
      .eq('depot_id', depotId)
      .eq('product_id', productId)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    if (existing) {
      const newQty = Number(existing.qty) + deltaQty;
      const newMin = minQty !== undefined ? minQty : Number(existing.min_qty);
      const { error } = await this.sb
        .from('stock_items')
        .update({ qty: newQty, min_qty: newMin })
        .eq('id', existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await this.sb.from('stock_items').insert({
        tenant_id: s.tenantId,
        depot_id: depotId,
        product_id: productId,
        qty: deltaQty,
        min_qty: minQty ?? 0,
      });
      if (error) throw new Error(error.message);
    }
  }

  // ===== SALES =====
  // NOTA DE DISEÑO: createSale y voidSale tocan 3 tablas (sales, sale_items,
  // sale_payments) + stock. Supabase JS no soporta transacciones cliente, así
  // que esto NO es atómico. Si hay fallo de red en medio de una venta, podés
  // quedar con stock o items inconsistentes. Para producción, conviene migrar
  // a una RPC `public.create_sale()` que haga todo en una transacción Postgres.

  async createSale(input: SaleInput): Promise<Sale> {
    const s = await this.requireSession();
    if (input.items.length === 0) throw new Error('El carrito está vacío');
    if (input.discount < 0) throw new Error('Descuento global inválido');

    // Resolvemos productos para snapshotear nombre/barcode al momento de la venta
    const productIds = input.items.map((i) => i.productId);
    const { data: prodRows, error: prodErr } = await this.sb
      .from('products')
      .select('id, name, barcode')
      .in('id', productIds);
    if (prodErr) throw new Error(prodErr.message);
    const byId = new Map((prodRows ?? []).map((p) => [p.id, p]));

    const itemsToInsert = input.items.map((it) => {
      const p = byId.get(it.productId);
      if (!p) throw new Error('Producto no encontrado en el carrito');
      if (it.qty <= 0) throw new Error(`Cantidad inválida para "${p.name}"`);
      if (it.price < 0) throw new Error(`Precio inválido para "${p.name}"`);
      if (it.discount < 0) throw new Error(`Descuento inválido para "${p.name}"`);
      const sub = lineSubtotal(it.price, it.qty, it.discount);
      if (sub < 0) throw new Error(`El descuento de "${p.name}" supera el subtotal de la línea`);
      return { ...it, name: p.name, barcode: p.barcode, subtotal: sub };
    });

    const subtotal = addMoney(...itemsToInsert.map((i) => i.subtotal));
    const total = subMoney(subtotal, input.discount);
    if (total < 0) throw new Error('El descuento global supera el subtotal');
    const paid = addMoney(...input.payments.map((p) => p.amount));
    if (!eqMoney(paid, total)) {
      throw new Error(`Pagos (${paid.toFixed(2)}) no coinciden con total (${total.toFixed(2)})`);
    }

    // 1. Insert sale (header)
    const { data: saleRow, error: saleErr } = await this.sb
      .from('sales')
      .insert({
        tenant_id: s.tenantId,
        depot_id: input.depotId,
        register_id: input.registerId,
        cashier_id: s.userId,
        subtotal,
        discount: input.discount,
        total,
        voided: false,
      })
      .select()
      .single();
    if (saleErr) throw new Error(saleErr.message);
    const saleId = saleRow.id;

    // 2. Insert sale_items (bulk)
    const itemRows = itemsToInsert.map((it) => ({
      sale_id: saleId,
      tenant_id: s.tenantId,
      product_id: it.productId,
      name: it.name,
      barcode: it.barcode,
      price: it.price,
      qty: it.qty,
      discount: it.discount,
      subtotal: it.subtotal,
    }));
    const { error: itemsErr } = await this.sb.from('sale_items').insert(itemRows);
    if (itemsErr) {
      await this.sb.from('sales').delete().eq('id', saleId);
      throw new Error(itemsErr.message);
    }

    // 3. Insert sale_payments (bulk)
    const paymentRows = input.payments.map((p) => ({
      sale_id: saleId,
      tenant_id: s.tenantId,
      method: p.method,
      amount: p.amount,
    }));
    const { error: payErr } = await this.sb.from('sale_payments').insert(paymentRows);
    if (payErr) {
      await this.sb.from('sales').delete().eq('id', saleId);
      throw new Error(payErr.message);
    }

    // 4. Decrementar stock
    for (const it of input.items) {
      await this.adjustStock(it.productId, input.depotId, -it.qty);
    }

    // 5. Re-leer la sale completa
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
    const { data: sale, error: selErr } = await this.sb
      .from('sales')
      .select('*, sale_items(product_id, qty)')
      .eq('id', id)
      .single();
    if (selErr || !sale) throw new Error('Venta no encontrada');
    if (sale.voided) return;

    const { error: updErr } = await this.sb
      .from('sales')
      .update({ voided: true })
      .eq('id', id);
    if (updErr) throw new Error(updErr.message);

    for (const it of sale.sale_items as { product_id: string; qty: string }[]) {
      await this.adjustStock(it.product_id, sale.depot_id, Number(it.qty));
    }
    void s;
  }

  async listSales(q: SalesQuery): Promise<Sale[]> {
    await this.requireSession();
    let query = this.sb
      .from('sales')
      .select('*, sale_items(*), sale_payments(method, amount)')
      .order('created_at', { ascending: false });
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lte('created_at', q.to);
    if (q.depotId) query = query.eq('depot_id', q.depotId);
    if (q.cashierId) query = query.eq('cashier_id', q.cashierId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSale);
  }

  // ===== CASH REGISTER =====

  async currentOpenRegister(depotId: string): Promise<CashRegister | null> {
    await this.requireSession();
    const { data, error } = await this.sb
      .from('cash_registers')
      .select('*')
      .eq('depot_id', depotId)
      .is('closed_at', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRegister(data) : null;
  }

  async openRegister(input: OpenRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();
    const existing = await this.currentOpenRegister(input.depotId);
    if (existing) throw new Error('Ya hay una caja abierta en este depósito');
    const { data, error } = await this.sb
      .from('cash_registers')
      .insert({
        tenant_id: s.tenantId,
        depot_id: input.depotId,
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

    // Sumamos cobros en cash de las ventas no anuladas asociadas a este register
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

    // Movimientos manuales de caja
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

  async listRegisters(depotId?: string): Promise<CashRegister[]> {
    await this.requireSession();
    let q = this.sb
      .from('cash_registers')
      .select('*')
      .order('opened_at', { ascending: false });
    if (depotId) q = q.eq('depot_id', depotId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRegister);
  }

  // ===== USERS =====
  // En Supabase los users viven en auth.users. Para la app construimos
  // el shape `User` combinando memberships (rol, depot, active del tenant)
  // + profiles (nombre, email globales).
  //
  // LIMITACIÓN: createUser() requiere crear en auth.users, lo cual solo se
  // puede hacer con service_role key (nunca debe ir al frontend). Para
  // habilitarlo, hay que crear una Edge Function en Supabase que reciba
  // las creds y use admin.createUser(). Por ahora lanza error explícito.

  async listUsers(): Promise<User[]> {
    const s = await this.requireSession();
    const { data: mems, error: memErr } = await this.sb
      .from('memberships')
      .select('user_id, role, depot_id, active, created_at, tenant_id')
      .order('created_at', { ascending: true });
    if (memErr) throw new Error(memErr.message);
    if (!mems || mems.length === 0) return [];

    const userIds = mems.map((m) => m.user_id);
    const { data: profs, error: profErr } = await this.sb
      .from('profiles')
      .select('id, name, email')
      .in('id', userIds);
    if (profErr) throw new Error(profErr.message);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));

    return mems.map((m) => {
      const p = byId.get(m.user_id);
      return {
        id: m.user_id,
        tenantId: s.tenantId,
        email: p?.email ?? '',
        // El modelo TS pide passwordHash, pero acá Supabase Auth maneja
        // las creds. Devolvemos string vacío para cumplir el tipo.
        passwordHash: '',
        name: p?.name ?? '',
        role: m.role,
        depotId: m.depot_id,
        active: m.active,
        createdAt: m.created_at,
      };
    });
  }

  async createUser(input: UserInput): Promise<User> {
    const s = await this.requireSession();
    if (!input.password) throw new Error('Password requerido para crear usuario');

    // Llamamos a la Edge Function vía fetch directo (no functions.invoke):
    // el SDK envuelve los errores 4xx/5xx en un mensaje genérico que pierde
    // el motivo real (ej. "Llegaste al límite de tu plan"). Con fetch tenemos
    // acceso al body de la respuesta independientemente del status.
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
        depotId: input.depotId,
        active: input.active,
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
      depotId: string | null;
      active: boolean;
    };
    return {
      id: created.id,
      tenantId: s.tenantId,
      email: created.email,
      passwordHash: '',
      name: created.name,
      role: created.role,
      depotId: created.depotId,
      active: created.active,
      createdAt: new Date().toISOString(),
    };
  }

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    await this.requireSession();

    if (input.name !== undefined) {
      const { error } = await this.sb
        .from('profiles')
        .update({ name: input.name })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }

    const memPatch: Record<string, unknown> = {};
    if (input.role !== undefined) memPatch.role = input.role;
    if (input.depotId !== undefined) memPatch.depot_id = input.depotId;
    if (input.active !== undefined) memPatch.active = input.active;
    if (Object.keys(memPatch).length > 0) {
      const { error } = await this.sb
        .from('memberships')
        .update(memPatch)
        .eq('user_id', id);
      if (error) throw new Error(error.message);
    }

    // input.email e input.password se ignoran: requieren llamadas a
    // supabase.auth.admin.updateUserById, que necesita service_role.

    const all = await this.listUsers();
    const user = all.find((u) => u.id === id);
    if (!user) throw new Error('Usuario no encontrado');
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    const s = await this.requireSession();
    if (s.userId === id) throw new Error('No podés eliminar tu propio usuario');
    // Soft delete: desactivamos la membership. El registro en auth.users queda
    // (eliminarlo requiere service_role). Si el user no tiene otras memberships
    // en otros tenants, queda como user huérfano sin acceso a nada.
    const { error } = await this.sb
      .from('memberships')
      .update({ active: false })
      .eq('user_id', id);
    if (error) throw new Error(error.message);
  }

  // ===== TRANSFERS =====
  // Misma nota de atomicidad que createSale: toca transfers + transfer_items
  // + stock_items en pasos secuenciales. Si falla en el medio, podría quedar
  // estado inconsistente. Migrar a RPC en producción.

  async createTransfer(input: TransferInput): Promise<Transfer> {
    const s = await this.requireSession();
    if (input.fromDepotId === input.toDepotId) {
      throw new Error('Origen y destino deben ser distintos');
    }
    if (input.items.length === 0) throw new Error('La transferencia no tiene items');

    // 1. Pre-validar stock disponible en origen
    const productIds = input.items.map((it) => it.productId);
    const { data: stockRows, error: stockErr } = await this.sb
      .from('stock_items')
      .select('product_id, qty')
      .eq('depot_id', input.fromDepotId)
      .in('product_id', productIds);
    if (stockErr) throw new Error(stockErr.message);
    const stockByProduct = new Map(
      (stockRows ?? []).map((r) => [r.product_id, Number(r.qty)]),
    );

    const { data: prodRows, error: prodErr } = await this.sb
      .from('products')
      .select('id, name')
      .in('id', productIds);
    if (prodErr) throw new Error(prodErr.message);
    const nameById = new Map((prodRows ?? []).map((p) => [p.id, p.name]));

    for (const it of input.items) {
      if (it.qty <= 0) throw new Error('Las cantidades deben ser mayores a cero');
      const available = stockByProduct.get(it.productId) ?? 0;
      if (available < it.qty) {
        const name = nameById.get(it.productId) ?? 'producto';
        throw new Error(
          `Stock insuficiente de "${name}" en el depósito origen (disponible: ${available}, pedido: ${it.qty})`,
        );
      }
    }

    // 2. Crear transfer (header)
    const { data: header, error: headerErr } = await this.sb
      .from('transfers')
      .insert({
        tenant_id: s.tenantId,
        from_depot_id: input.fromDepotId,
        to_depot_id: input.toDepotId,
        created_by: s.userId,
        notes: input.notes,
      })
      .select()
      .single();
    if (headerErr) throw new Error(headerErr.message);
    const transferId = header.id;

    // 3. Crear transfer_items (bulk)
    const itemRows = input.items.map((it) => ({
      transfer_id: transferId,
      tenant_id: s.tenantId,
      product_id: it.productId,
      qty: it.qty,
    }));
    const { error: itemsErr } = await this.sb.from('transfer_items').insert(itemRows);
    if (itemsErr) {
      await this.sb.from('transfers').delete().eq('id', transferId);
      throw new Error(itemsErr.message);
    }

    // 4. Mover stock
    for (const it of input.items) {
      await this.adjustStock(it.productId, input.fromDepotId, -it.qty);
      await this.adjustStock(it.productId, input.toDepotId, it.qty);
    }

    return {
      id: transferId,
      tenantId: s.tenantId,
      fromDepotId: input.fromDepotId,
      toDepotId: input.toDepotId,
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
      fromDepotId: r.from_depot_id,
      toDepotId: r.to_depot_id,
      createdBy: r.created_by,
      notes: r.notes,
      createdAt: r.created_at,
      items: ((r.transfer_items ?? []) as { product_id: string; qty: string }[]).map((it) => ({
        productId: it.product_id,
        qty: Number(it.qty),
      })),
    }));
  }
}
