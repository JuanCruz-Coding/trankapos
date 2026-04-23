import { Navigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import type { PropsWithChildren } from 'react';
import type { Role } from '@/types';

interface Props extends PropsWithChildren {
  roles?: Role[];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">Cargando…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.role)) return <Navigate to="/pos" replace />;
  return <>{children}</>;
}
