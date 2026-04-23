import Dexie, { type Table } from 'dexie';
import type {
  CashMovement,
  CashRegister,
  Category,
  Depot,
  Product,
  Sale,
  StockItem,
  Tenant,
  Transfer,
  User,
} from '@/types';

export interface SessionRow {
  id: 'current';
  userId: string;
  tenantId: string;
  depotId: string | null;
}

export class TrankaPosDB extends Dexie {
  tenants!: Table<Tenant, string>;
  users!: Table<User, string>;
  depots!: Table<Depot, string>;
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
  }
}

export const db = new TrankaPosDB();
