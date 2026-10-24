import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useIdentity } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { usePermissions } from '../../lib/permissions';
import { aggregatesApi } from '../../api/aggregates';

/** Cache root of every aggregate; record mutations invalidate it (see workspaceCache). */
export const AGGREGATES_ROOT = 'aggregates';

function useScope() {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { hasPermission, organizationId: capabilityOrganization } = usePermissions();
  // Only once this organization's capabilities are ready and allow reading.
  const enabled = Boolean(identity?.id && activeTenantId && capabilityOrganization === activeTenantId && hasPermission('document.view'));
  return { identityId: identity?.id, organizationId: activeTenantId, enabled };
}

export function useDashboardAggregate() {
  const { identityId, organizationId, enabled } = useScope();
  return useQuery({
    queryKey: [AGGREGATES_ROOT, 'dashboard', identityId, organizationId],
    queryFn: ({ signal }) => aggregatesApi.dashboard({ signal, organizationId }),
    enabled, staleTime: 10_000, placeholderData: keepPreviousData,
  });
}

/** Navigation badges: contracts about to expire and unread notifications. */
export function useBadgeAggregate() {
  const { identityId, organizationId, enabled } = useScope();
  return useQuery({
    queryKey: [AGGREGATES_ROOT, 'badges', identityId, organizationId],
    queryFn: ({ signal }) => aggregatesApi.badges({ signal, organizationId }),
    enabled, staleTime: 15_000,
  });
}

/** Distinct values for filter drop-downs (categories, vendors, years, ...). */
export function useFacets() {
  const { identityId, organizationId, enabled } = useScope();
  return useQuery({
    queryKey: [AGGREGATES_ROOT, 'facets', identityId, organizationId],
    queryFn: ({ signal }) => aggregatesApi.facets({ signal, organizationId }),
    enabled, staleTime: 30_000,
  });
}
