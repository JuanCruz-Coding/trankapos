import { useState, type PropsWithChildren } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { data } from '@/data';
import { cn } from '@/lib/utils';
import type { Role } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[];
}

const nav: NavItem[] = [
  { to: '/pos', label: 'Vender', icon: ShoppingCart },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Productos', icon: Package },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/transfers', label: 'Transferencias', icon: TrendingUp, roles: ['owner', 'manager'] },
  { to: '/cash', label: 'Caja', icon: Wallet },
  { to: '/sales', label: 'Ventas', icon: Receipt },
  { to: '/reports', label: 'Reportes', icon: BarChart3, roles: ['owner', 'manager'] },
  { to: '/depots', label: 'Depósitos', icon: Store, roles: ['owner', 'manager'] },
  { to: '/users', label: 'Usuarios', icon: Users, roles: ['owner', 'manager'] },
  { to: '/help', label: 'Ayuda', icon: HelpCircle },
];

export function Layout({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const { session, signOut, activeDepotId, setActiveDepot } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const depots = useLiveQuery(async () => {
    if (!session) return [];
    return data.listDepots();
  }, [session?.tenantId]);

  if (!session) return null;

  const filteredNav = nav.filter((n) => !n.roles || n.roles.includes(session.role));

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
        <div className="rounded-lg bg-brand-600 p-2 text-white">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-900">TrankaPOS</div>
          <div className="text-xs text-slate-500">MVP</div>
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
                  'mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
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
        <div className="mb-2 text-xs text-slate-500">Depósito activo</div>
        <select
          className="mb-3 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
          value={activeDepotId ?? ''}
          onChange={(e) => setActiveDepot(e.target.value)}
        >
          {depots?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
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
            <div className="rounded-md bg-brand-600 p-1.5 text-white">
              <ShoppingCart className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold">TrankaPOS</span>
          </Link>
          <div className="w-8" />
        </header>

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
