import { useState, type PropsWithChildren } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeDollarSign,
  BarChart3,
  Boxes,
  Cog,
  Contact,
  Crown,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Percent,
  Receipt,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  UsersRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { data } from '@/data';
import { AfipStatusBanner } from '@/components/afip/AfipStatusBanner';
import { cn } from '@/lib/utils';
import { hasPermission } from '@/lib/permissions';
import type { Permission, Role } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[];
  permission?: Permission;
}

const nav: NavItem[] = [
  { to: '/pos', label: 'Vender', icon: ShoppingCart },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'view_reports' },
  { to: '/products', label: 'Productos', icon: Package },
  { to: '/categories', label: 'Categorías', icon: Boxes, permission: 'manage_products' },
  { to: '/brands', label: 'Marcas', icon: Tag, permission: 'manage_products' },
  { to: '/labels', label: 'Etiquetas', icon: Tag, permission: 'manage_products' },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/transfers', label: 'Transferencias', icon: TrendingUp, permission: 'do_transfers' },
  { to: '/cash', label: 'Caja', icon: Wallet },
  { to: '/sales', label: 'Ventas', icon: Receipt },
  { to: '/comprobantes', label: 'Comprobantes', icon: FileText, permission: 'view_reports' },
  { to: '/customers', label: 'Clientes', icon: Contact },
  { to: '/customer-groups', label: 'Grupos de clientes', icon: UsersRound, permission: 'manage_settings' },
  { to: '/price-lists', label: 'Listas de precios', icon: BadgeDollarSign, permission: 'manage_products' },
  { to: '/promotions', label: 'Promociones', icon: Percent, permission: 'manage_settings' },
  { to: '/reports', label: 'Reportes', icon: BarChart3, permission: 'view_reports' },
  { to: '/branches', label: 'Sucursales', icon: Store, permission: 'manage_branches' },
  { to: '/warehouses', label: 'Depósitos', icon: Boxes, permission: 'manage_branches' },
  { to: '/users', label: 'Usuarios', icon: Users, permission: 'manage_users' },
  { to: '/settings', label: 'Configuración', icon: Cog, permission: 'manage_settings' },
  { to: '/plan', label: 'Mi plan', icon: Crown, roles: ['owner'] },
  { to: '/help', label: 'Ayuda', icon: HelpCircle },
];

export function Layout({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const { session, signOut, activeBranchId, setActiveBranch } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const branches = useLiveQuery(async () => {
    if (!session) return [];
    return data.listBranches();
  }, [session?.tenantId]);

  if (!session) return null;

  // Las branches que el switcher muestra: si tiene 'all' u owner, todas;
  // sino, solo las accesibles. Las RLS ya filtran las branches que vienen de
  // la query, pero por las dudas filtramos en cliente también.
  const accessibleBranches =
    session.role === 'owner' || session.branchAccess === 'all'
      ? branches ?? []
      : (branches ?? []).filter((b) =>
          Array.isArray(session.branchAccess) && session.branchAccess.includes(b.id),
        );
  const showSwitcher = accessibleBranches.length > 1;

  const filteredNav = nav.filter((n) => {
    if (n.roles && !n.roles.includes(session.role)) return false;
    if (n.permission && !hasPermission(session, n.permission)) return false;
    return true;
  });

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-4">
        <img src="/brand/isotipo.png" alt="TrankaSoft" className="h-9 w-9" />
        <div className="min-w-0">
          <div className="font-display text-sm font-bold leading-tight text-navy">TrankaPOS</div>
          <div className="marker text-slate-400">Software con calma</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {filteredNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-ice text-navy'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-3">
        {showSwitcher ? (
          <>
            <div className="mb-2 text-xs text-slate-500">Sucursal activa</div>
            <select
              className="mb-3 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={activeBranchId ?? ''}
              onChange={(e) => setActiveBranch(e.target.value)}
            >
              {accessibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        ) : accessibleBranches[0] ? (
          <div className="mb-3 rounded-lg bg-ice px-3 py-1.5 text-xs text-navy">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Sucursal</div>
            <div className="font-semibold">{accessibleBranches[0].name}</div>
          </div>
        ) : null}
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
            {session.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{session.name}</div>
            <div className="text-xs text-slate-500 capitalize">{session.role}</div>
          </div>
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" />
          Salir
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="relative z-50 h-full">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <button onClick={() => setOpen((v) => !v)} className="rounded-md p-2 hover:bg-slate-100">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/pos" className="flex items-center gap-2">
            <img src="/brand/isotipo.png" alt="TrankaSoft" className="h-7 w-7" />
            <span className="font-display text-sm font-bold text-navy">TrankaPOS</span>
          </Link>
          <div className="w-8" />
        </header>

        <AfipStatusBanner />

        <main
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            location.pathname === '/pos' ? 'p-0' : 'p-4 sm:p-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
