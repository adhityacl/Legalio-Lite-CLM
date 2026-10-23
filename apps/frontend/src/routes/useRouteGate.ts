import { useMemo } from 'react';
import { needsOrganization, resolveRoute } from '../lib/appRoutes';
import { moduleDisabled } from './registry';

export type Gate =
  | { kind: 'pending' }
  | { kind: 'no-org' }
  | { kind: 'caps-error' }
  | { kind: 'denied' }
  | { kind: 'allow' }
  | { kind: 'redirect'; tab: string; intent?: string };

export interface GateInput {
  tab: string;
  isPlatformAdmin: boolean;
  selectionStatus: string;
  activeTenantId: string | null | undefined;
  capabilityStatus: 'idle' | 'loading' | 'ready' | 'error';
  can: (permission: string) => boolean;
  modules: Partial<Record<'commercialDocuments' | 'spending' | 'evaluation', boolean>>;
  tenantSettingsReady: boolean;
}

/**
 * Route decision, made before any lazy page mounts or loads data. Tabs that need an organization wait for its capabilities;
 * nothing privileged is rendered from a previous organization's or a failed capability state.
 */
export function decideGate(input: GateInput): Gate {
  const { tab, isPlatformAdmin } = input;
  if (input.selectionStatus === 'loading') return { kind: 'pending' };
  if (needsOrganization(tab, isPlatformAdmin)) {
    if (!input.activeTenantId) return isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-dashboard' } : { kind: 'no-org' };
    if (input.capabilityStatus === 'idle' || input.capabilityStatus === 'loading') return { kind: 'pending' };
    if (input.capabilityStatus === 'error') return { kind: 'caps-error' };
  }
  const decision = resolveRoute(tab, { isPlatformAdmin, organizationReady: input.capabilityStatus === 'ready', can: input.can });
  if (decision.kind !== 'allow') return decision;
  if (moduleDisabled(tab, input.modules)) return input.tenantSettingsReady ? { kind: 'denied' } : { kind: 'pending' };
  return { kind: 'allow' };
}

export function useRouteGate(input: GateInput): Gate {
  const { tab, isPlatformAdmin, selectionStatus, activeTenantId, capabilityStatus, can, modules, tenantSettingsReady } = input;
  return useMemo(
    () => decideGate({ tab, isPlatformAdmin, selectionStatus, activeTenantId, capabilityStatus, can, modules, tenantSettingsReady }),
    [tab, isPlatformAdmin, selectionStatus, activeTenantId, capabilityStatus, can, modules, tenantSettingsReady],
  );
}
