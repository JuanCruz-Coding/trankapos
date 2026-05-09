import Dexie, { type Table } from 'dexie';
import type {
  Branch,
  CashMovement,
  CashRegister,
  Category,
  Product,
  Sale,
  StockItem,
  Tenant,
  Transfer,
  User,
  Warehouse,
} from '@/types';

export interface SessionRow {
  id: 'current';
  userId: string;
  tenantId: string;
  branchId: string | null;
}

// Shapes legacy usados en upgrades hacia v3 (cuando depots era una sola tabla).
interface LegacyDepotRow {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export class TrankaPosDB extends Dexie {
  tenants!: Table<Tenant, string>;
  users!: Table<User, string>;
  branches!: Table<Branch, string>;
  warehouses!: Table<Warehouse, string>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  stock!: Table<StockItem, string>;
  sales!: Table<Sale, string>;
  registers!: Table<CashRegister, string>;
  cashMovements!: Table<CashMovement, string>;
  transfers!: Table<Transfer, string>;
  session!: Table<SessionRow, string>;

  constructor() {
    super('trankapos');

    // v1: schema inicial (ya con depots fusionado)
    this.version(1).stores({
      tenants: 'id, name',
      users: 'id, tenantId, email, [tenantId+email]',
      depots: 'id, tenantId',
      categories: 'id, tenantId',
      products: 'id, tenantId, barcode, [tenantId+barcode]',
      stock: 'id, tenantId, [tenantId+depotId+productId], productId, depotId',
      sales: 'id, tenantId, depotId, cashierId, createdAt',
      registers: 'id, tenantId, depotId, openedAt, closedAt',
      cashMovements: 'id, tenantId, registerId, createdAt',
      transfers: 'id, tenantId, createdAt',
      session: 'id',
    });

    // v2: índices para reportes (filtro por anulada y por categoría)
    this.version(2).stores({
      sales: 'id, tenantId, depotId, cashierId, createdAt, voided',
      products: 'id, tenantId, barcode, [tenantId+barcode], categoryId',
    });

    // v3: separar branches (sucursales) de warehouses (depósitos).
    // Migra los `depots` legacy a 1 branch + 1 warehouse default cada uno y
    // remapea stock_items.depotId → warehouseId, sales/registers .depotId
    // → branchId, transfers from/to_depotId → from/to_warehouseId.
    this.version(3).stores({
      // Nuevas tablas
      branches: 'id, tenantId',
      warehouses: 'id, tenantId, branchId, [branchId+isDefault]',
      // Tablas remapeadas (drop índices viejos por depotId, agregar nuevos)
      stock: 'id, tenantId, [tenantId+warehouseId+productId], productId, warehouseId',
      sales: 'id, tenantId, branchId, cashierId, createdAt, voided',
      registers: 'id, tenantId, branchId, openedAt, closedAt',
      // depots se elimina explícitamente con stores: null
      depots: null,
    }).upgrade(async (tx) => {
      // Lee la tabla legacy `depots` desde la transacción (no via this.depots,
      // que ya no existe en el schema final).
      const depotsTable = tx.table<LegacyDepotRow>('depots');
      const legacyDepots = await depotsTable.toArray();

      const branchesTable = tx.table<Branch>('branches');
      const warehousesTable = tx.table<Warehouse>('warehouses');

      // Map legacy depot.id → warehouse default id (para remapear stock/transfers).
      const defaultWhByDepot = new Map<string, string>();

      for (const d of legacyDepots) {
        const branch: Branch = {
          id: d.id, // preservamos id para que el remap de sales/registers sea trivial
          tenantId: d.tenantId,
          name: d.name,
          address: d.address,
          active: d.active,
          createdAt: d.createdAt,
        };
        await branchesTable.put(branch);

        const whId = crypto.randomUUID();
        const wh: Warehouse = {
          id: whId,
          tenantId: d.tenantId,
          branchId: d.id,
          name: d.name,
          isDefault: true,
          active: d.active,
          createdAt: d.createdAt,
        };
        await warehousesTable.put(wh);
        defaultWhByDepot.set(d.id, whId);
      }

      // Stock: depotId → warehouseId (al default warehouse de esa branch)
      const stockTable = tx.table('stock');
      const allStock = await stockTable.toArray();
      for (const row of allStock as Array<StockItem & { depotId?: string }>) {
        const oldDepot = row.depotId;
        if (!oldDepot) continue;
        const whId = defaultWhByDepot.get(oldDepot);
        if (!whId) continue;
        const updated = { ...row, warehouseId: whId };
        delete (updated as { depotId?: string }).depotId;
        await stockTable.put(updated);
      }

      // Sales: depotId → branchId
      const salesTable = tx.table('sales');
      const allSales = await salesTable.toArray();
      for (const row of allSales as Array<Sale & { depotId?: string }>) {
        const oldDepot = row.depotId;
        if (!oldDepot) continue;
        const updated = { ...row, branchId: oldDepot };
        delete (updated as { depotId?: string }).depotId;
        await salesTable.put(updated);
      }

      // Registers: depotId → branchId
      const registersTable = tx.table('registers');
      const allRegs = await registersTable.toArray();
      for (const row of allRegs as Array<CashRegister & { depotId?: string }>) {
        const oldDepot = row.depotId;
        if (!oldDepot) continue;
        const updated = { ...row, branchId: oldDepot };
        delete (updated as { depotId?: string }).depotId;
        await registersTable.put(updated);
      }

      // Transfers: from/toDepotId → from/toWarehouseId (al default de cada branch)
      const transfersTable = tx.table('transfers');
      const allTransfers = await transfersTable.toArray();
      for (const row of allTransfers as Array<
        Transfer & { fromDepotId?: string; toDepotId?: string }
      >) {
        const fromOld = row.fromDepotId;
        const toOld = row.toDepotId;
        if (!fromOld || !toOld) continue;
        const fromWh = defaultWhByDepot.get(fromOld);
        const toWh = defaultWhByDepot.get(toOld);
        if (!fromWh || !toWh) continue;
        const updated = {
          ...row,
          fromWarehouseId: fromWh,
          toWarehouseId: toWh,
        };
        delete (updated as { fromDepotId?: string }).fromDepotId;
        delete (updated as { toDepotId?: string }).toDepotId;
        await transfersTable.put(updated);
      }

      // Users.depotId → branchId (no es índice, pero el shape cambió)
      const usersTable = tx.table('users');
      const allUsers = await usersTable.toArray();
      for (const row of allUsers as Array<User & { depotId?: string | null }>) {
        const updated = { ...row, branchId: row.depotId ?? null };
        delete (updated as { depotId?: string | null }).depotId;
        await usersTable.put(updated);
      }

      // Session.depotId → branchId
      const sessionTable = tx.table('session');
      const sess = (await sessionTable.get('current')) as
        | (SessionRow & { depotId?: string | null })
        | undefined;
      if (sess) {
        const updated = { ...sess, branchId: sess.depotId ?? null };
        delete (updated as { depotId?: string | null }).depotId;
        await sessionTable.put(updated);
      }
    });
  }
}

export const db = new TrankaPosDB();
