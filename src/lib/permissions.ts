import { useAuth } from '@/stores/auth';
import type { BranchAccess, Permission, PermissionsMap, Role } from '@/types';

/**
 * Sistema de permisos finos del POS.
 *
 * - PERMISSION_DEFAULTS_BY_ROLE define el comportamiento standard de cada rol.
 * - memberships.permissions (jsonb) guarda solo los OVERRIDES por user.
 * - hasPermission(session, key) combina override + default del rol.
 * - Owner siempre tiene todos los permisos (bypass).
 * - canAccessBranch(session, branchId) consulta el set de branches accesibles
 *   resuelto desde user_branch_access al login.
 */

export const PERMISSION_KEYS: readonly Permission[] = [
  'view_costs',
  'view_reports',
  'view_other_branches_stock',
  'void_sales',
  'do_transfers',
  'adjust_stock',
  'manage_products',
  'manage_branches',
  'manage_users',
  'manage_settings',
  'apply_discount_above_default',
  'cash_register_open_close',
] as const;

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_costs: 'Ver costos y márgenes',
  view_reports: 'Ver Reportes y Dashboard',
  view_other_branches_stock: 'Ver stock de otras sucursales',
  void_sales: 'Anular ventas',
  do_transfers: 'Hacer transferencias entre depósitos',
  adjust_stock: 'Ajustar stock manualmente',
  manage_products: 'Gestionar productos y categorías',
  manage_branches: 'Gestionar sucursales y depósitos',
  manage_users: 'Gestionar usuarios',
  manage_settings: 'Cambiar configuración del comercio',
  apply_discount_above_default: 'Aplicar descuentos sobre el tope general',
  cash_register_open_close: 'Abrir y cerrar cajas',
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  view_costs:
    'Si está apagado, las columnas Costo y Margen se ocultan en Productos y Reportes.',
  view_reports: 'Acceso a las páginas de Reportes y Dashboard.',
  view_other_branches_stock:
    'Permite ver stock de sucursales fuera del set asignado al usuario (útil para encargados regionales).',
  void_sales: 'Habilita el botón "Anular venta" en el historial.',
  do_transfers: 'Habilita la página Transferencias y la creación de transferencias.',
  adjust_stock: 'Habilita el ajuste manual de cantidades en Stock.',
  manage_products:
    'Permite crear, editar y eliminar productos, categorías e importar CSV.',
  manage_branches: 'Permite crear/editar sucursales y depósitos.',
  manage_users: 'Permite crear, editar y desactivar usuarios.',
  manage_settings: 'Acceso a la página Configuración del comercio.',
  apply_discount_above_default:
    'Permite aplicar descuentos mayores al "Descuento máximo" definido en Configuración → POS.',
  cash_register_open_close: 'Permite abrir y cerrar la caja del turno.',
};

const ALL_TRUE: Record<Permission, boolean> = PERMISSION_KEYS.reduce(
  (acc, k) => ({ ...acc, [k]: true }),
  {} as Record<Permission, boolean>,
);

export const PERMISSION_DEFAULTS_BY_ROLE: Record<Role, Record<Permission, boolean>> = {
  cashier: {
    view_costs: false,
    view_reports: false,
    view_other_branches_stock: false,
    void_sales: false,
    do_transfers: false,
    adjust_stock: false,
    manage_products: false,
    manage_branches: false,
    manage_users: false,
    manage_settings: false,
    apply_discount_above_default: false,
    cash_register_open_close: true,
  },
  manager: {
    view_costs: true,
    view_reports: true,
    view_other_branches_stock: false,
    void_sales: true,
    do_transfers: true,
    adjust_stock: true,
    manage_products: true,
    manage_branches: false,
    manage_users: false,
    manage_settings: false,
    apply_discount_above_default: true,
    cash_register_open_close: true,
  },
  owner: ALL_TRUE,
};

interface SessionLike {
  role: Role;
  permissionOverrides?: PermissionsMap | null;
}

/**
 * Resuelve un permiso para un user. Prioridad:
 *   1. Owner siempre true (bypass total).
 *   2. Override en memberships.permissions (si está definido).
 *   3. Default del rol.
 */
export function hasPermission(
  session: SessionLike | null | undefined,
  key: Permission,
): boolean {
  if (!session) return false;
  if (session.role === 'owner') return true;
  const override = session.permissionOverrides?.[key];
  if (override !== undefined) return override;
  return PERMISSION_DEFAULTS_BY_ROLE[session.role][key] ?? false;
}

/**
 * Devuelve el set efectivo de permisos para un usuario (todos los keys con
 * su valor resuelto). Útil para listados o para mostrar "qué tiene cada user".
 */
export function effectivePermissions(
  role: Role,
  overrides: PermissionsMap | null | undefined,
): Record<Permission, boolean> {
  if (role === 'owner') return ALL_TRUE;
  const base = PERMISSION_DEFAULTS_BY_ROLE[role];
  const out = { ...base };
  for (const k of PERMISSION_KEYS) {
    if (overrides?.[k] !== undefined) out[k] = overrides[k]!;
  }
  return out;
}

interface BranchSessionLike {
  role: Role;
  branchAccess?: BranchAccess | null;
}

/**
 * Chequea si el caller puede operar en una branch específica.
 * Owner siempre puede. 'all' = todas. Array = solo las listadas.
 */
export function canAccessBranch(
  session: BranchSessionLike | null | undefined,
  branchId: string | null | undefined,
): boolean {
  if (!session || !branchId) return false;
  if (session.role === 'owner') return true;
  if (session.branchAccess === 'all') return true;
  return Array.isArray(session.branchAccess) && session.branchAccess.includes(branchId);
}

// =====================================================================
// Hooks
// =====================================================================

export function usePermission(key: Permission): boolean {
  const session = useAuth((s) => s.session);
  return hasPermission(session, key);
}

export function useCanAccessBranch(branchId: string | null | undefined): boolean {
  const session = useAuth((s) => s.session);
  return canAccessBranch(session, branchId);
}

/**
 * Devuelve la lista de branchIds accesibles por el caller. Si tiene 'all',
 * devuelve null (significando "todas"). Las pages que filtran listas usan
 * esta info: si es null, no filtran.
 */
export function useAccessibleBranchIds(): string[] | null {
  const session = useAuth((s) => s.session);
  if (!session) return [];
  if (session.role === 'owner') return null;
  if (session.branchAccess === 'all') return null;
  return Array.isArray(session.branchAccess) ? session.branchAccess : [];
}
