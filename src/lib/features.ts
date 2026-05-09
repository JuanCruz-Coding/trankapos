import { useAuth } from '@/stores/auth';
import type { Plan, Subscription } from '@/types';

/**
 * Llaves de feature flags que se definen en `plans.features` (jsonb).
 * Mantener en sync con los valores que setea la migration 012.
 */
export type FeatureKey =
  | 'scanner_camera'
  | 'csv_import'
  | 'csv_export'
  | 'advanced_reports'
  | 'transfers'
  | 'customers'
  | 'multi_cash'
  | 'variants'
  | 'purchases'
  | 'audit_log'
  | 'granular_perms'
  | 'api'
  | 'webhooks'
  | 'custom_branding'
  | 'central_warehouse';

/** Devuelve true si el plan tiene la feature habilitada. */
export function planHasFeature(plan: Plan | undefined | null, key: FeatureKey): boolean {
  if (!plan) return false;
  return Boolean(plan.features?.[key]);
}

export function subscriptionHasFeature(
  sub: Subscription | undefined | null,
  key: FeatureKey,
): boolean {
  return planHasFeature(sub?.plan, key);
}

/**
 * Hook reactivo: devuelve true si la feature está disponible para el tenant
 * actual. Lee de `useAuth().subscription` (cacheada al login). Si la
 * subscription todavía no cargó, devuelve false (cierra puerta por default).
 */
export function useFeature(key: FeatureKey): boolean {
  const sub = useAuth((s) => s.subscription);
  return subscriptionHasFeature(sub, key);
}

/**
 * Hook que devuelve el plan completo + helpers de feature, para casos
 * donde necesitás mostrar info del plan actual junto al gate.
 */
export function usePlan(): { plan: Plan | null; has: (key: FeatureKey) => boolean } {
  const sub = useAuth((s) => s.subscription);
  const plan = sub?.plan ?? null;
  return {
    plan,
    has: (key) => planHasFeature(plan, key),
  };
}
