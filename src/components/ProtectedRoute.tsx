import { Navigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import type { PropsWithChildren } from 'react';
import type { Permission, Role } from '@/types';
import { hasPermission } from '@/lib/permissions';

interface Props extends PropsWithChildren {
  roles?: Role[];
  permission?: Permission;
}

export function ProtectedRoute({ children, roles, permission }: Props) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">Cargando…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.role)) return <Navigate to="/pos" replace />;
  if (permission && !hasPermission(session, permission)) return <Navigate to="/pos" replace />;
  return <>{children}</>;
}
