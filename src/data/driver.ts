import type {
  AuthSession,
  Branch,
  CashMovement,
  CashRegister,
  Category,
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
  Warehouse,
} from '@/types';

export interface SignupInput {
  tenantName: string;
  branchName: string;
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
  initialStock?: { warehouseId: string; qty: number; minQty: number }[];
}

export interface UserInput {
  email: string;
  password?: string;
  name: string;
  role: Role;
  branchId: string | null;
  active: boolean;
}

export interface BranchInput {
  name: string;
  address: string;
  active: boolean;
}

export interface WarehouseInput {
  name: string;
  branchId: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface CategoryInput {
  name: string;
}

export interface SaleInput {
  branchId: string;
  registerId: string | null;
  items: { productId: string; qty: number; price: number; discount: number }[];
  payments: { method: Sale['payments'][number]['method']; amount: number }[];
  discount: number;
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
  items: { productId: string; qty: number }[];
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
  findProductByBarcode(barcode: string): Promise<Product | null>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  // --- stock ---
  listStock(warehouseId?: string): Promise<StockItem[]>;
  adjustStock(productId: string, warehouseId: string, deltaQty: number, minQty?: number): Promise<void>;

  // --- sales / pos ---
  createSale(input: SaleInput): Promise<Sale>;
  voidSale(id: string): Promise<void>;
  listSales(q: SalesQuery): Promise<Sale[]>;

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
}
