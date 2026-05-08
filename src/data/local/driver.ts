import { v4 as uuid } from 'uuid';
import { db } from './db';
import type {
  AuthSession,
  CashMovement,
  CashRegister,
  Category,
  Depot,
  Plan,
  PlanUsage,
  Product,
  Sale,
  SaleItem,
  StockItem,
  Subscription,
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
import { hashPassword, verifyPassword } from '@/lib/hash';
import { addMoney, eqMoney, lineSubtotal, subMoney } from '@/lib/money';

const now = () => new Date().toISOString();

function toSession(user: User): AuthSession {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    depotId: user.depotId,
    role: user.role,
    email: user.email,
    name: user.name,
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
    this._session = toSession(user);
    return this._session;
  }

  private tenantScope<T extends { tenantId: string }>(collection: T[]): T[] {
    const tid = this._session?.tenantId;
    if (!tid) return [];
    return collection.filter((c) => c.tenantId === tid);
  }

  async signup(input: SignupInput): Promise<AuthSession> {
    const existing = await db.users.where('email').equals(input.email.toLowerCase()).first();
    if (existing) throw new Error('Ya existe una cuenta con ese email');

    const tenantId = uuid();
    const userId = uuid();
    const depotId = uuid();
    const ts = now();

    const tenant: Tenant = { id: tenantId, name: input.tenantName, createdAt: ts };
    const depot: Depot = {
      id: depotId,
      tenantId,
      name: input.depotName,
      address: '',
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
      depotId,
      active: true,
      createdAt: ts,
    };

    await db.transaction('rw', db.tenants, db.depots, db.users, db.session, async () => {
      await db.tenants.put(tenant);
      await db.depots.put(depot);
      await db.users.put(user);
      await db.session.put({ id: 'current', userId, tenantId, depotId });
    });

    this._session = toSession(user);
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
      depotId: user.depotId,
    });
    this._session = toSession(user);
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
    this._session = toSession(user);
    return this._session;
  }

  async getTenant(): Promise<Tenant> {
    const s = await this.requireSession();
    const t = await db.tenants.get(s.tenantId);
    if (!t) throw new Error('Tenant no encontrado');
    return t;
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
        maxDepots: null,
        maxUsers: null,
        maxProducts: null,
        features: { transfers: true, advanced_reports: true, csv_export: true, api: true },
      },
    };
  }

  async getUsage(): Promise<PlanUsage> {
    const s = await this.requireSession();
    const [depots, users, products] = await Promise.all([
      db.depots.where('tenantId').equals(s.tenantId).count(),
      db.users.where('tenantId').equals(s.tenantId).filter((u) => u.active).count(),
      db.products.where('tenantId').equals(s.tenantId).count(),
    ]);
    return { depots, users, products };
  }

  async listPlans(): Promise<Plan[]> {
    // En modo local devolvemos un array vacío — los planes solo aplican en Supabase.
    return [];
  }

  async subscribeToPlan(): Promise<{ initPoint: string }> {
    throw new Error('La suscripción solo funciona con el driver de Supabase.');
  }

  async cancelSubscription(): Promise<void> {
    throw new Error('La cancelación solo funciona con el driver de Supabase.');
  }

  async clearPendingPlan(): Promise<void> {
    // No aplica en LocalDriver: no hay flow de subscripción real.
  }

  // --- depots ---
  async listDepots(): Promise<Depot[]> {
    const s = await this.requireSession();
    return db.depots.where('tenantId').equals(s.tenantId).toArray();
  }

  async createDepot(input: DepotInput): Promise<Depot> {
    const s = await this.requireSession();
    const depot: Depot = { id: uuid(), tenantId: s.tenantId, createdAt: now(), ...input };
    await db.depots.put(depot);
    return depot;
  }

  async updateDepot(id: string, input: Partial<DepotInput>): Promise<Depot> {
    const s = await this.requireSession();
    const existing = await db.depots.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Depósito no encontrado');
    const updated: Depot = { ...existing, ...input };
    await db.depots.put(updated);
    return updated;
  }

  async deleteDepot(id: string): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.depots.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    await db.depots.delete(id);
  }

  // --- users ---
  async listUsers(): Promise<User[]> {
    const s = await this.requireSession();
    return db.users.where('tenantId').equals(s.tenantId).toArray();
  }

  async createUser(input: UserInput): Promise<User> {
    const s = await this.requireSession();
    if (!input.password) throw new Error('Password requerido');
    const existing = await db.users.where('email').equals(input.email.toLowerCase()).first();
    if (existing) throw new Error('Email ya registrado');
    const user: User = {
      id: uuid(),
      tenantId: s.tenantId,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
      depotId: input.depotId,
      active: input.active,
      createdAt: now(),
    };
    await db.users.put(user);
    return user;
  }

  async updateUser(id: string, input: Partial<UserInput>): Promise<User> {
    const s = await this.requireSession();
    const existing = await db.users.get(id);
    if (!existing || existing.tenantId !== s.tenantId) throw new Error('Usuario no encontrado');
    const updated: User = {
      ...existing,
      name: input.name ?? existing.name,
      role: input.role ?? existing.role,
      depotId: input.depotId !== undefined ? input.depotId : existing.depotId,
      active: input.active ?? existing.active,
      email: input.email ? input.email.toLowerCase() : existing.email,
      passwordHash: input.password ? await hashPassword(input.password) : existing.passwordHash,
    };
    await db.users.put(updated);
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    const s = await this.requireSession();
    if (s.userId === id) throw new Error('No podés eliminar tu propio usuario');
    const existing = await db.users.get(id);
    if (!existing || existing.tenantId !== s.tenantId) return;
    await db.users.delete(id);
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

  async findProductByBarcode(barcode: string): Promise<Product | null> {
    const s = await this.requireSession();
    const p = await db.products.where('[tenantId+barcode]').equals([s.tenantId, barcode]).first();
    return p ?? null;
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const s = await this.requireSession();
    const product: Product = {
      id: uuid(),
      tenantId: s.tenantId,
      name: input.name,
      barcode: input.barcode,
      price: input.price,
      cost: input.cost,
      categoryId: input.categoryId,
      taxRate: input.taxRate,
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
            depotId: row.depotId,
            productId: product.id,
            qty: row.qty,
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
    await db.transaction('rw', db.products, db.stock, async () => {
      await db.products.delete(id);
      const stock = await db.stock.where('productId').equals(id).toArray();
      await Promise.all(stock.map((si) => db.stock.delete(si.id)));
    });
  }

  // --- stock ---
  async listStock(depotId?: string): Promise<StockItem[]> {
    const s = await this.requireSession();
    let items = await db.stock.where('tenantId').equals(s.tenantId).toArray();
    if (depotId) items = items.filter((x) => x.depotId === depotId);
    return items;
  }

  async adjustStock(
    productId: string,
    depotId: string,
    deltaQty: number,
    minQty?: number,
  ): Promise<void> {
    const s = await this.requireSession();
    const existing = await db.stock
      .where('[tenantId+depotId+productId]')
      .equals([s.tenantId, depotId, productId])
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
        depotId,
        productId,
        qty: deltaQty,
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
    const total = subMoney(subtotal, input.discount);
    if (total < 0) throw new Error('El descuento global supera el subtotal');
    const paid = addMoney(...input.payments.map((p) => p.amount));
    if (!eqMoney(paid, total)) {
      throw new Error(`Pagos (${paid.toFixed(2)}) no coinciden con total (${total.toFixed(2)})`);
    }

    const sale: Sale = {
      id,
      tenantId: s.tenantId,
      depotId: input.depotId,
      registerId: input.registerId,
      cashierId: s.userId,
      items,
      payments: input.payments,
      subtotal,
      discount: input.discount,
      total,
      createdAt: ts,
      voided: false,
    };

    await db.transaction('rw', db.sales, db.stock, async () => {
      await db.sales.put(sale);
      for (const it of items) {
        const stock = await db.stock
          .where('[tenantId+depotId+productId]')
          .equals([s.tenantId, input.depotId, it.productId])
          .first();
        if (stock) {
          await db.stock.put({ ...stock, qty: stock.qty - it.qty, updatedAt: ts });
        } else {
          await db.stock.put({
            id: uuid(),
            tenantId: s.tenantId,
            depotId: input.depotId,
            productId: it.productId,
            qty: -it.qty,
            minQty: 0,
            updatedAt: ts,
          });
        }
      }
    });

    return sale;
  }

  async voidSale(id: string): Promise<void> {
    const s = await this.requireSession();
    const sale = await db.sales.get(id);
    if (!sale || sale.tenantId !== s.tenantId) throw new Error('Venta no encontrada');
    if (sale.voided) return;
    const ts = now();
    await db.transaction('rw', db.sales, db.stock, async () => {
      await db.sales.put({ ...sale, voided: true });
      for (const it of sale.items) {
        const stock = await db.stock
          .where('[tenantId+depotId+productId]')
          .equals([s.tenantId, sale.depotId, it.productId])
          .first();
        if (stock) {
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
    if (q.depotId) sales = sales.filter((x) => x.depotId === q.depotId);
    if (q.cashierId) sales = sales.filter((x) => x.cashierId === q.cashierId);
    if (q.registerId) sales = sales.filter((x) => x.registerId === q.registerId);
    sales = sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (q.limit !== undefined) {
      const offset = q.offset ?? 0;
      sales = sales.slice(offset, offset + q.limit);
    }
    return sales;
  }

  // --- cash register ---
  async currentOpenRegister(depotId: string): Promise<CashRegister | null> {
    const s = await this.requireSession();
    const all = await db.registers.where('tenantId').equals(s.tenantId).toArray();
    return all.find((r) => r.depotId === depotId && !r.closedAt) ?? null;
  }

  async openRegister(input: OpenRegisterInput): Promise<CashRegister> {
    const s = await this.requireSession();
    const existing = await this.currentOpenRegister(input.depotId);
    if (existing) throw new Error('Ya hay una caja abierta en este depósito');
    const reg: CashRegister = {
      id: uuid(),
      tenantId: s.tenantId,
      depotId: input.depotId,
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

  async listRegisters(depotId?: string): Promise<CashRegister[]> {
    const s = await this.requireSession();
    let regs = await db.registers.where('tenantId').equals(s.tenantId).toArray();
    if (depotId) regs = regs.filter((r) => r.depotId === depotId);
    return regs.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  // --- transfers ---
  async createTransfer(input: TransferInput): Promise<Transfer> {
    const s = await this.requireSession();
    if (input.fromDepotId === input.toDepotId) {
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
      fromDepotId: input.fromDepotId,
      toDepotId: input.toDepotId,
      createdBy: s.userId,
      createdAt: ts,
      notes: input.notes,
      items: input.items,
    };

    // Pre-validar stock disponible en origen antes de tocar la BD
    const products = await db.products.where('tenantId').equals(s.tenantId).toArray();
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (it.qty <= 0) throw new Error('Las cantidades deben ser mayores a cero');
      const src = await db.stock
        .where('[tenantId+depotId+productId]')
        .equals([s.tenantId, input.fromDepotId, it.productId])
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
          .where('[tenantId+depotId+productId]')
          .equals([s.tenantId, input.fromDepotId, it.productId])
          .first();
        if (src) {
          await db.stock.put({ ...src, qty: src.qty - it.qty, updatedAt: ts });
        }
        const dst = await db.stock
          .where('[tenantId+depotId+productId]')
          .equals([s.tenantId, input.toDepotId, it.productId])
          .first();
        if (dst) {
          await db.stock.put({ ...dst, qty: dst.qty + it.qty, updatedAt: ts });
        } else {
          await db.stock.put({
            id: uuid(),
            tenantId: s.tenantId,
            depotId: input.toDepotId,
            productId: it.productId,
            qty: it.qty,
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
}
