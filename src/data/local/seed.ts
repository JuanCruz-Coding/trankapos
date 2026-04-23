import { v4 as uuid } from 'uuid';
import { subDays } from 'date-fns';
import { db } from './db';
import { hashPassword } from '@/lib/hash';
import type {
  CashMovement,
  CashRegister,
  Category,
  Depot,
  PaymentMethod,
  Product,
  Sale,
  SaleItem,
  StockItem,
  Tenant,
  User,
} from '@/types';

// Idempotente: si ya hay tenants, no hace nada.
export async function seedIfEmpty(): Promise<void> {
  const count = await db.tenants.count();
  if (count > 0) return;

  const tenantId = uuid();
  const ts = new Date().toISOString();
  const tenant: Tenant = { id: tenantId, name: 'Kiosko Demo', createdAt: ts };

  const depot1Id = uuid();
  const depot2Id = uuid();
  const depots: Depot[] = [
    { id: depot1Id, tenantId, name: 'Sucursal Centro', address: 'Av. Corrientes 1234', active: true, createdAt: ts },
    { id: depot2Id, tenantId, name: 'Depósito', address: 'Galpón', active: true, createdAt: ts },
  ];

  const ownerId = uuid();
  const cashierId = uuid();
  const users: User[] = [
    {
      id: ownerId,
      tenantId,
      email: 'demo@trankapos.local',
      passwordHash: await hashPassword('demo1234'),
      name: 'Dueño Demo',
      role: 'owner',
      depotId: depot1Id,
      active: true,
      createdAt: ts,
    },
    {
      id: cashierId,
      tenantId,
      email: 'cajero@trankapos.local',
      passwordHash: await hashPassword('demo1234'),
      name: 'Cajero 1',
      role: 'cashier',
      depotId: depot1Id,
      active: true,
      createdAt: ts,
    },
  ];

  const catBebidas = uuid();
  const catSnacks = uuid();
  const catLimpieza = uuid();
  const categories: Category[] = [
    { id: catBebidas, tenantId, name: 'Bebidas', createdAt: ts },
    { id: catSnacks, tenantId, name: 'Snacks', createdAt: ts },
    { id: catLimpieza, tenantId, name: 'Limpieza', createdAt: ts },
  ];

  const sampleProducts = [
    { name: 'Coca Cola 500ml', barcode: '7790895000014', price: 1200, cost: 900, categoryId: catBebidas },
    { name: 'Agua Mineral 500ml', barcode: '7790895000021', price: 900, cost: 600, categoryId: catBebidas },
    { name: 'Cerveza Quilmes 473ml', barcode: '7790895000038', price: 1800, cost: 1300, categoryId: catBebidas },
    { name: 'Papas Lays 110g', barcode: '7790895000045', price: 2200, cost: 1600, categoryId: catSnacks },
    { name: 'Chocolate Milka 100g', barcode: '7790895000052', price: 3200, cost: 2400, categoryId: catSnacks },
    { name: 'Chicles Beldent', barcode: '7790895000069', price: 500, cost: 300, categoryId: catSnacks },
    { name: 'Alfajor Jorgito', barcode: '7790895000076', price: 800, cost: 500, categoryId: catSnacks },
    { name: 'Detergente Magistral 750ml', barcode: '7790895000083', price: 2500, cost: 1800, categoryId: catLimpieza },
    { name: 'Lavandina 1L', barcode: '7790895000090', price: 900, cost: 600, categoryId: catLimpieza },
    { name: 'Cigarrillos Marlboro 20', barcode: '7790895000106', price: 3500, cost: 2800, categoryId: null },
  ];

  const products: Product[] = sampleProducts.map((p) => ({
    id: uuid(),
    tenantId,
    name: p.name,
    barcode: p.barcode,
    price: p.price,
    cost: p.cost,
    categoryId: p.categoryId,
    taxRate: 21,
    active: true,
    createdAt: ts,
  }));

  // Stock inicial "grande" en mapa mutable — lo vamos bajando a medida que
  // generamos ventas para que los saldos finales queden realistas.
  const stockMap = new Map<string, { qty: number; minQty: number }>();
  for (const p of products) {
    stockMap.set(`${p.id}:${depot1Id}`, {
      qty: rand(80, 160),
      minQty: 10,
    });
    stockMap.set(`${p.id}:${depot2Id}`, {
      qty: rand(150, 300),
      minQty: 20,
    });
  }

  const sales: Sale[] = [];
  const registers: CashRegister[] = [];
  const movements: CashMovement[] = [];

  // Generamos 14 días de historia para la sucursal principal.
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const isToday = daysAgo === 0;
    const dayBase = subDays(new Date(), daysAgo);

    const openedAt = atHour(dayBase, 9, rand(0, 30));
    const registerId = uuid();
    const openingAmount = 20000;

    // Cantidad de ventas por día: más los días hábiles, menos los fines de semana
    const weekday = dayBase.getDay(); // 0 dom, 6 sab
    const weekendMul = weekday === 0 || weekday === 6 ? 0.7 : 1;
    const numSales = Math.round(rand(8, 18) * weekendMul);

    let cashSum = 0;

    for (let i = 0; i < numSales; i++) {
      const hour = rand(9, 21);
      const minute = rand(0, 59);
      const saleTime = atHour(dayBase, hour, minute);
      // El sistema valida paid === total, así que lo armamos clavado.
      const { items, subtotal } = buildRandomCart(products, stockMap, depot1Id);
      if (items.length === 0) continue;

      const discount = Math.random() < 0.12 ? roundDown(subtotal * 0.1) : 0;
      const total = subtotal - discount;

      const payments = randomPayments(total);
      cashSum += payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);

      sales.push({
        id: uuid(),
        tenantId,
        depotId: depot1Id,
        registerId,
        cashierId: Math.random() < 0.65 ? cashierId : ownerId,
        items,
        payments,
        subtotal,
        discount,
        total,
        createdAt: saleTime.toISOString(),
        voided: false,
      });
    }

    // Movimientos de caja ocasionales
    if (Math.random() < 0.35) {
      const mvAmount = rand(1000, 4000);
      movements.push({
        id: uuid(),
        tenantId,
        registerId,
        kind: 'in',
        amount: mvAmount,
        reason: 'Cambio recibido',
        createdBy: ownerId,
        createdAt: atHour(dayBase, 12, rand(0, 59)).toISOString(),
      });
    }
    if (Math.random() < 0.25) {
      const mvAmount = rand(2000, 7000);
      const reasons = ['Pago proveedor bebidas', 'Arreglo heladera', 'Retiro parcial'];
      movements.push({
        id: uuid(),
        tenantId,
        registerId,
        kind: 'out',
        amount: mvAmount,
        reason: pick(reasons),
        createdBy: ownerId,
        createdAt: atHour(dayBase, 17, rand(0, 59)).toISOString(),
      });
    }

    const mvNet = movements
      .filter((m) => m.registerId === registerId)
      .reduce((a, m) => a + (m.kind === 'in' ? m.amount : -m.amount), 0);
    const expectedCash = openingAmount + cashSum + mvNet;

    if (isToday) {
      // La caja de hoy queda abierta para que se pueda vender inmediatamente.
      registers.push({
        id: registerId,
        tenantId,
        depotId: depot1Id,
        openedBy: ownerId,
        openedAt: openedAt.toISOString(),
        openingAmount,
        closedAt: null,
        closedBy: null,
        closingAmount: null,
        expectedCash: null,
        difference: null,
        notes: null,
      });
    } else {
      // Diferencia de arqueo chica (±200) para que se vea realista
      const diff = rand(-200, 200);
      const closedAt = atHour(dayBase, 21, rand(30, 59));
      registers.push({
        id: registerId,
        tenantId,
        depotId: depot1Id,
        openedBy: ownerId,
        openedAt: openedAt.toISOString(),
        openingAmount,
        closedAt: closedAt.toISOString(),
        closedBy: ownerId,
        closingAmount: expectedCash + diff,
        expectedCash,
        difference: diff,
        notes: diff !== 0 ? 'Arqueo con diferencia menor' : '',
      });
    }
  }

  // Armar el array final de stock con los saldos ya decrementados.
  const stock: StockItem[] = [];
  for (const [key, v] of stockMap.entries()) {
    const [productId, depotId] = key.split(':');
    stock.push({
      id: uuid(),
      tenantId,
      depotId,
      productId,
      qty: v.qty,
      minQty: v.minQty,
      updatedAt: ts,
    });
  }

  // Forzamos un par de productos en stock crítico para que se vean en Dashboard
  const critical = sample(products, 2);
  for (const p of critical) {
    const row = stock.find((s) => s.productId === p.id && s.depotId === depot1Id);
    if (row) row.qty = rand(0, 3);
  }

  await db.transaction(
    'rw',
    [db.tenants, db.depots, db.users, db.categories, db.products, db.stock],
    async () => {
      await db.tenants.put(tenant);
      await db.depots.bulkPut(depots);
      await db.users.bulkPut(users);
      await db.categories.bulkPut(categories);
      await db.products.bulkPut(products);
      await db.stock.bulkPut(stock);
    },
  );

  await db.transaction('rw', [db.sales, db.registers, db.cashMovements], async () => {
    await db.sales.bulkPut(sales);
    await db.registers.bulkPut(registers);
    await db.cashMovements.bulkPut(movements);
  });
}

// ---------- helpers ----------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function atHour(date: Date, hour: number, minute: number): Date {
  const d = new Date(date);
  d.setHours(hour, minute, rand(0, 59), 0);
  return d;
}

function roundDown(n: number): number {
  return Math.floor(n / 10) * 10;
}

function buildRandomCart(
  products: Product[],
  stockMap: Map<string, { qty: number; minQty: number }>,
  depotId: string,
): { items: SaleItem[]; subtotal: number } {
  const numDistinct = rand(1, 4);
  const picked = sample(products, numDistinct);
  const items: SaleItem[] = [];
  let subtotal = 0;

  for (const p of picked) {
    const key = `${p.id}:${depotId}`;
    const stock = stockMap.get(key);
    if (!stock || stock.qty <= 0) continue;
    const qty = Math.min(rand(1, 3), stock.qty);
    stock.qty -= qty;

    const lineSub = p.price * qty;
    subtotal += lineSub;
    items.push({
      id: uuid(),
      productId: p.id,
      name: p.name,
      barcode: p.barcode,
      price: p.price,
      qty,
      discount: 0,
      subtotal: lineSub,
    });
  }

  return { items, subtotal };
}

function randomPayments(total: number): { method: PaymentMethod; amount: number }[] {
  // 75% cash, 10% debit, 8% credit, 5% qr, 2% transfer
  const r = Math.random();
  let method: PaymentMethod = 'cash';
  if (r < 0.75) method = 'cash';
  else if (r < 0.85) method = 'debit';
  else if (r < 0.93) method = 'credit';
  else if (r < 0.98) method = 'qr';
  else method = 'transfer';

  // 10% de chance de pago mixto (parte efectivo + parte tarjeta)
  if (Math.random() < 0.1 && total > 3000 && method !== 'cash') {
    const cashPart = roundDown(total * (0.3 + Math.random() * 0.4));
    return [
      { method: 'cash', amount: cashPart },
      { method, amount: total - cashPart },
    ];
  }

  return [{ method, amount: total }];
}
