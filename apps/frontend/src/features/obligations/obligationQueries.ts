import type { QueryClient } from '@tanstack/react-query';

/** Everything that shows obligations (lists, summary, calendar, contract tabs) refetches after a change. */
export const invalidateObligations = (queryClient: QueryClient) => Promise.all([
  queryClient.invalidateQueries({ queryKey: ['lists', 'obligations'] }),
  queryClient.invalidateQueries({ queryKey: ['obligations'] }),
]);

/** A one-shot hint for the Obligations page about which view to open first (set by the contract tab after an extraction). */
export const obligationsViewRequest: { view: 'review' | null } = { view: null };
