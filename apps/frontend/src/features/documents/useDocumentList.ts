import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { documentsApi } from '../../lib/documentsApi';

/** Document results never reuse another workspace's cache or pending request. */
export function useDocumentList(params: Record<string, string>) {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  return useQuery({
    queryKey: ['documents', user?.email, activeTenantId, params],
    queryFn: ({ signal }) => documentsApi.list(params, signal, activeTenantId),
    enabled: Boolean(user?.email && activeTenantId),
    staleTime: 0,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === user?.email && previousQuery?.queryKey[2] === activeTenantId ? previous : undefined,
  });
}
