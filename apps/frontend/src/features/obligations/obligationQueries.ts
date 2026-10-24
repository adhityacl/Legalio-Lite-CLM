import type { QueryClient } from '@tanstack/react-query';

/** Everything that shows obligations (lists, summary, calendar, contract tabs) refetches after a change. */
export const invalidateObligations = (queryClient: QueryClient) => Promise.all([
  queryClient.invalidateQueries({ queryKey: ['lists', 'obligations'] }),
  queryClient.invalidateQueries({ queryKey: ['obligations'] }),
]);
