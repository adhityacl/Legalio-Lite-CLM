import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchHitsToResults } from '@legalio/platform-console/lib/workspaceSearch';
import { useIdentity } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { usePermissions } from '../../lib/permissions';
import { searchApi } from '../../api/search';

export const SEARCH_DEBOUNCE_MS = 250;

/** Command-palette record search on the server: debounced, one request per pause, the previous answer stays until the next arrives. */
export function useWorkspaceSearch() {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { hasPermission, organizationId: capabilityOrganization } = usePermissions();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);
  const enabled = Boolean(term && identity?.id && activeTenantId && capabilityOrganization === activeTenantId && hasPermission('document.view'));
  const query = useQuery({
    queryKey: ['search', identity?.id, activeTenantId, term],
    queryFn: ({ signal }) => searchApi.query(term, { signal, organizationId: activeTenantId }),
    enabled, staleTime: 15_000, placeholderData: keepPreviousData,
  });
  const results = useMemo(() => (term && query.data ? searchHitsToResults(query.data.results, term) : []), [term, query.data]);
  return { results, loading: Boolean(input.trim()) && (query.isFetching || input.trim() !== term), setQuery: setInput };
}
