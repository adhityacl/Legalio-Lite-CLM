import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTenant } from '../../context/TenantContext';
import { obligationsApi, type Obligation } from '../../api/obligations';
import type { CalendarEvent } from '../calendar/eventTypes';

/** Obligations whose due date falls in `range`, as calendar events (open work only: finished ones are history, not deadlines). */
export function useObligationEvents(range: { start: Date; end: Date } | null, enabled: boolean) {
  const { activeTenantId } = useTenant();
  const from = range ? format(range.start, 'yyyy-MM-dd') : '';
  const to = range ? format(range.end, 'yyyy-MM-dd') : '';
  const query = useQuery({
    queryKey: ['obligations', activeTenantId, 'calendar', from, to],
    queryFn: ({ signal }) => obligationsApi.page({ limit: 500, dueFrom: from, dueTo: to, status: ['open', 'in_progress', 'overdue'], sort: 'due_date' }, { signal, organizationId: activeTenantId }),
    enabled: enabled && Boolean(activeTenantId && range),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const events = useMemo<CalendarEvent[]>(() => (query.data?.items ?? []).filter((o: Obligation) => o.due_date).map((o) => ({
    id: `obligation:${o.id}`, type: 'obligation' as const, date: o.due_date!, title: o.title, partnerName: o.partner_name || undefined, documentId: o.id, documentKind: 'obligation' as const,
  })), [query.data]);
  return { events, isLoading: query.isLoading, isError: query.isError, truncated: (query.data?.total ?? 0) > 500 };
}
