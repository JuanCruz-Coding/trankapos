import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFeature, type FeatureKey } from '@/lib/features';

interface Props {
  feature: FeatureKey;
  /** Mostrá esto en lugar del contenido si la feature no está habilitada. */
  fallback?: ReactNode;
  /** Si es true, muestra UpgradeHint default cuando no hay feature (en lugar de no renderizar nada). */
  hint?: boolean;
  children: ReactNode;
}

/**
 * Renderiza children solo si el plan actual tiene la feature habilitada.
 * Si no, renderiza fallback (custom) o UpgradeHint (si hint = true) o nada.
 *
 * Usar para:
 *   - Esconder/condicionar UI por plan: <FeatureGate feature="csv_export">...</FeatureGate>
 *   - Pages enteras: envolver el contenido y mostrar UpgradeHint si no aplica.
 */
export function FeatureGate({ feature, fallback, hint, children }: Props) {
  const enabled = useFeature(feature);
  if (enabled) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (hint) return <UpgradeHint feature={feature} />;
  return null;
}

const FEATURE_LABEL: Record<FeatureKey, string> = {
  scanner_camera: 'Scanner por cámara',
  csv_import: 'Importar CSV',
  csv_export: 'Exportar CSV',
  advanced_reports: 'Reportes avanzados',
  transfers: 'Transferencias entre depósitos',
  customers: 'Clientes / cuenta corriente',
  multi_cash: 'Múltiples cajas simultáneas',
  variants: 'Variantes de producto',
  purchases: 'Compras a proveedores',
  audit_log: 'Auditoría / logs de cambios',
  granular_perms: 'Permisos granulares por rol',
  api: 'Acceso a API',
  webhooks: 'Webhooks',
  custom_branding: 'Branding propio en ticket',
  central_warehouse: 'Depósito central',
};

export function UpgradeHint({ feature }: { feature: FeatureKey }) {
  const label = FEATURE_LABEL[feature];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
        <Crown className="h-6 w-6 text-amber-600" />
      </div>
      <h3 className="mb-1 font-display text-lg font-bold text-amber-900">
        {label} no está disponible en tu plan
      </h3>
      <p className="mb-4 text-sm text-amber-800">
        Actualizá a un plan superior para activar esta función.
      </p>
      <Link
        to="/plan"
        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
      >
        Ver planes
      </Link>
    </div>
  );
}
