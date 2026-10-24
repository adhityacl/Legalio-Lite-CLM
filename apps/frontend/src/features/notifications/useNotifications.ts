import { useQuery } from '@tanstack/react-query';
import type { NotificationLog } from '@legalio/types';
import { useIdentity } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { usePermissions } from '../../lib/permissions';
import { notificationsApi } from '../../api/notifications';

const NO_NOTIFICATIONS: NotificationLog[] = [];

/** The caller's notifications from `GET /api/notification-logs` (header bell and notifications page share this one query). */
export function useNotifications() {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { hasPermission, organizationId: capabilityOrganization } = usePermissions();
  const query = useQuery({
    queryKey: ['notifications', identity?.id, activeTenantId],
    queryFn: ({ signal }) => notificationsApi.list({ signal, organizationId: activeTenantId }),
    enabled: Boolean(identity?.id && activeTenantId && capabilityOrganization === activeTenantId && hasPermission('document.view')),
    staleTime: 15_000,
  });
  return { notifications: query.data ?? NO_NOTIFICATIONS, loading: query.isLoading, refetch: query.refetch, updatedAt: query.dataUpdatedAt };
}
