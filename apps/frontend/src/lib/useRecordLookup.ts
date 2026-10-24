import { useQuery } from '@tanstack/react-query';
import { useIdentity } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { fetchPage } from '../api/records';

/**
 * One record by id, for deep links (`?tab=contracts&id=C0001`) and detail panels, without loading the whole collection: the list
 * endpoints search ids too, and the server only answers with records the caller may see. Resolves to null when there is none.
 */
export function useRecordLookup<T extends Record<string, any>>(entity: string, path: string, idKey: string, id: string | null | undefined) {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  return useQuery<T | null>({
    queryKey: ['lists', `${entity}:lookup`, identity?.id, activeTenantId, id],
    queryFn: async ({ signal }) => {
      const page = await fetchPage<T>(path, { q: id!, limit: 25, offset: 0 }, { signal, organizationId: activeTenantId });
      return page.items.find((row) => row[idKey] === id) ?? null;
    },
    enabled: Boolean(id && identity?.id && activeTenantId),
    staleTime: 5_000,
  });
}

/** Records related to one parent (e.g. the addenda or orders of a contract) through the list endpoint's filter. */
export function useRelatedRecords<T>(entity: string, path: string, filter: Record<string, string>, enabled: boolean) {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  return useQuery<T[]>({
    queryKey: ['lists', `${entity}:related`, identity?.id, activeTenantId, filter],
    queryFn: async ({ signal }) => (await fetchPage<T>(path, { ...filter, limit: 200, offset: 0 }, { signal, organizationId: activeTenantId })).items,
    enabled: enabled && Boolean(identity?.id && activeTenantId),
    staleTime: 5_000,
  });
}
