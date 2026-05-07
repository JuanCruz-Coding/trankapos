import type {
  AuthSession,
  CashMovement,
  CashRegister,
  Category,
  Depot,
  Plan,
  PlanUsage,
  Product,
  Role,
  Sale,
  StockItem,
  Subscription,
  Tenant,
  Transfer,
  User,
} from '@/types';

export interface SignupInput {
  tenantName: string;
  depotName: string;
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
  price: number;
  cost: number;
  categoryId: string | null;
  taxRate: number;
  active: boolean;
  initialStock?: { depotId: string; qty: number; minQty: number }[];
}

export interface UserInput {
  email: string;
  password?: string;
  name: string;
  role: Role;
  depotId: string | null;
  active: boolean;
}

export interface DepotInput {
  name: string;
  address: string;
  active: boolean;
}

export interface CategoryInput {
  name: string;
}

export interface SaleInput {
  depotId: string;
  registerId: string | null;
  items: { productId: string; qty: number; price: number; discount: number }[];
  payments: { method: Sale['payments'][number]['method']; amount: number }[];
  discount: number;
}

export interface OpenRegisterInput {
  depotId: string;
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
  fromDepotId: string;
  toDepotId: string;
  notes: string;
  items: { productId: string; qty: number }[];
}

export interface SalesQuery {
  from?: string;
  to?: string;
  depotId?: string;
  cashierId?: string;
}

export interface DataDriver {
  // --- auth ---
  signup(input: SignupInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  logout(): Promise<void>;
  currentSession(): Promise<AuthSession | null>;

  // --- tenant ---
  getTenant(): Promise<Tenant>;

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

  // --- depots ---
  listDepots(): Promise<Depot[]>;
  createDepot(input: DepotInput): Promise<Depot>;
  updateDepot(id: string, input: Partial<DepotInput>): Promise<Depot>;
  deleteDepot(id: string): Promise<void>;

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
  findProductByBarcode(barcode: string): Promise<Product | null>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  // --- stock ---
  listStock(depotId?: string): Promise<StockItem[]>;
  adjustStock(productId: string, depotId: string, deltaQty: number, minQty?: number): Promise<void>;

  // --- sales / pos ---
  createSale(input: SaleInput): Promise<Sale>;
  voidSale(id: string): Promise<void>;
  listSales(q: SalesQuery): Promise<Sale[]>;

  // --- cash register ---
  currentOpenRegister(depotId: string): Promise<CashRegister | null>;
  openRegister(input: OpenRegisterInput): Promise<CashRegister>;
  closeRegister(input: CloseRegisterInput): Promise<CashRegister>;
  addCashMovement(input: CashMovementInput): Promise<CashMovement>;
  listCashMovements(registerId: string): Promise<CashMovement[]>;
  listRegisters(depotId?: string): Promise<CashRegister[]>;

  // --- transfers ---
  createTransfer(input: TransferInput): Promise<Transfer>;
  listTransfers(): Promise<Transfer[]>;
}
