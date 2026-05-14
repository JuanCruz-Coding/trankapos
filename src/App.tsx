import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Toaster } from 'react-hot-toast';
import { useAuth } from '@/stores/auth';

import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import Pos from '@/pages/Pos';
import Products from '@/pages/Products';
import Branches from '@/pages/Branches';
import Warehouses from '@/pages/Warehouses';
import Users from '@/pages/Users';
import Cash from '@/pages/Cash';
import Dashboard from '@/pages/Dashboard';
import Reports from '@/pages/Reports';
import Sales from '@/pages/Sales';
import Customers from '@/pages/Customers';
import Stock from '@/pages/Stock';
import Transfers from '@/pages/Transfers';
import Help from '@/pages/Help';
import Plan from '@/pages/Plan';
import PlanReturn from '@/pages/PlanReturn';
import Settings from '@/pages/Settings';
import MpCallback from '@/pages/MpCallback';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';

export function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <Outlet />
              </Layout>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/pos" replace />} />
          <Route path="pos" element={<Pos />} />
          <Route
            path="dashboard"
            element={
              <ProtectedRoute permission="view_reports">
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="products" element={<Products />} />
          <Route path="stock" element={<Stock />} />
          <Route
            path="transfers"
            element={
              <ProtectedRoute permission="do_transfers">
                <Transfers />
              </ProtectedRoute>
            }
          />
          <Route path="cash" element={<Cash />} />
          <Route path="sales" element={<Sales />} />
          <Route path="customers" element={<Customers />} />
          <Route
            path="reports"
            element={
              <ProtectedRoute permission="view_reports">
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="branches"
            element={
              <ProtectedRoute permission="manage_branches">
                <Branches />
              </ProtectedRoute>
            }
          />
          <Route
            path="warehouses"
            element={
              <ProtectedRoute permission="manage_branches">
                <Warehouses />
              </ProtectedRoute>
            }
          />
          <Route
            path="users"
            element={
              <ProtectedRoute permission="manage_users">
                <Users />
              </ProtectedRoute>
            }
          />
          <Route path="help" element={<Help />} />
          <Route
            path="plan"
            element={
              <ProtectedRoute roles={['owner']}>
                <Plan />
              </ProtectedRoute>
            }
          />
          <Route
            path="plan/return"
            element={
              <ProtectedRoute roles={['owner']}>
                <PlanReturn />
              </ProtectedRoute>
            }
          />
          <Route
            path="settings"
            element={
              <ProtectedRoute permission="manage_settings">
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="settings/integrations/mp/callback"
            element={
              <ProtectedRoute roles={['owner']}>
                <MpCallback />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error: { duration: 5000 },
        }}
      />
    </BrowserRouter>
  );
}
