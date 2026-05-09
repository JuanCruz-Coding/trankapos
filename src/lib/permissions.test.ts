import { describe, it, expect } from 'vitest';
import {
  PERMISSION_DEFAULTS_BY_ROLE,
  canAccessBranch,
  effectivePermissions,
  hasPermission,
} from './permissions';

describe('hasPermission — defaults por rol', () => {
  it('cashier: cash_register_open_close = true; view_costs = false', () => {
    const session = { role: 'cashier' as const, permissionOverrides: {} };
    expect(hasPermission(session, 'cash_register_open_close')).toBe(true);
    expect(hasPermission(session, 'view_costs')).toBe(false);
    expect(hasPermission(session, 'view_reports')).toBe(false);
  });

  it('manager: view_costs/reports/transfers = true; manage_settings = false', () => {
    const session = { role: 'manager' as const, permissionOverrides: {} };
    expect(hasPermission(session, 'view_costs')).toBe(true);
    expect(hasPermission(session, 'view_reports')).toBe(true);
    expect(hasPermission(session, 'do_transfers')).toBe(true);
    expect(hasPermission(session, 'manage_settings')).toBe(false);
    expect(hasPermission(session, 'manage_branches')).toBe(false);
  });

  it('owner: bypass total — todas las keys son true', () => {
    const session = { role: 'owner' as const, permissionOverrides: {} };
    expect(hasPermission(session, 'view_costs')).toBe(true);
    expect(hasPermission(session, 'manage_branches')).toBe(true);
    expect(hasPermission(session, 'view_other_branches_stock')).toBe(true);
  });

  it('owner ignora overrides en false', () => {
    // Aunque le pongas override false, el owner sigue teniendo todo.
    const session = {
      role: 'owner' as const,
      permissionOverrides: { void_sales: false, view_costs: false },
    };
    expect(hasPermission(session, 'void_sales')).toBe(true);
    expect(hasPermission(session, 'view_costs')).toBe(true);
  });
});

describe('hasPermission — overrides', () => {
  it('override true sobre cashier (que tiene false por default)', () => {
    const session = {
      role: 'cashier' as const,
      permissionOverrides: { view_costs: true },
    };
    expect(hasPermission(session, 'view_costs')).toBe(true);
    // El resto sigue con default
    expect(hasPermission(session, 'void_sales')).toBe(false);
  });

  it('override false sobre manager (que tiene true por default)', () => {
    const session = {
      role: 'manager' as const,
      permissionOverrides: { void_sales: false },
    };
    expect(hasPermission(session, 'void_sales')).toBe(false);
  });

  it('session null → false para todo', () => {
    expect(hasPermission(null, 'view_costs')).toBe(false);
    expect(hasPermission(undefined, 'manage_settings')).toBe(false);
  });

  it('si la key no está en overrides, usa el default del rol', () => {
    const session = {
      role: 'manager' as const,
      permissionOverrides: { manage_users: true },
    };
    expect(hasPermission(session, 'manage_users')).toBe(true);
    expect(hasPermission(session, 'view_costs')).toBe(true); // default manager
  });
});

describe('effectivePermissions', () => {
  it('owner devuelve todo true', () => {
    const eff = effectivePermissions('owner', null);
    expect(eff.view_costs).toBe(true);
    expect(eff.manage_branches).toBe(true);
    expect(eff.view_other_branches_stock).toBe(true);
  });

  it('manager con override en una key', () => {
    const eff = effectivePermissions('manager', { view_other_branches_stock: true });
    expect(eff.view_other_branches_stock).toBe(true); // override
    expect(eff.view_costs).toBe(true); // default manager
    expect(eff.manage_branches).toBe(false); // default manager
  });

  it('cashier sin overrides retorna los defaults', () => {
    const eff = effectivePermissions('cashier', null);
    expect(eff).toEqual(PERMISSION_DEFAULTS_BY_ROLE.cashier);
  });
});

describe('canAccessBranch', () => {
  it('owner siempre true', () => {
    expect(canAccessBranch({ role: 'owner', branchAccess: [] }, 'b1')).toBe(true);
  });

  it("'all' permite cualquier branch", () => {
    expect(canAccessBranch({ role: 'manager', branchAccess: 'all' }, 'b1')).toBe(true);
    expect(canAccessBranch({ role: 'cashier', branchAccess: 'all' }, 'b99')).toBe(true);
  });

  it('array filtra a las listadas', () => {
    const session = { role: 'cashier' as const, branchAccess: ['b1', 'b2'] };
    expect(canAccessBranch(session, 'b1')).toBe(true);
    expect(canAccessBranch(session, 'b2')).toBe(true);
    expect(canAccessBranch(session, 'b3')).toBe(false);
  });

  it('session null o branchId null → false', () => {
    expect(canAccessBranch(null, 'b1')).toBe(false);
    expect(canAccessBranch({ role: 'manager', branchAccess: 'all' }, null)).toBe(false);
  });
});
