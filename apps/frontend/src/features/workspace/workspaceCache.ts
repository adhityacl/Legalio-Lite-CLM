/**
 * Optimistic updates of the workspace cache, as TanStack Query mutation options: `onMutate` applies the change to the cached
 * `init-data` snapshot, `onError` rolls back exactly what this mutation changed (and only if nothing newer replaced it meanwhile),
 * `onSettled` invalidates the snapshot so the server's answer becomes the truth. Pure of React, so it runs in node tests.
 */
import type { MutationOptions, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Contract, InsertionOrder, Partner } from '@legalio/types';

export interface WorkspaceCache {
  contracts: Contract[];
  ios: InsertionOrder[];
  partners: Partner[];
  [key: string]: unknown;
}
type Collections = 'contracts' | 'ios' | 'partners';
/** What a mutation does to the cached collections: only the collections it returns are touched. */
export type Optimistic<Vars> = (cache: WorkspaceCache, vars: Vars) => Partial<Pick<WorkspaceCache, Collections>>;

export interface MutationContext {
  previous: Partial<Record<Collections, unknown>>;
  applied: Partial<Record<Collections, unknown>>;
}

export interface CollectionMutation<Vars, Result> {
  queryClient: QueryClient;
  queryKey: QueryKey;
  mutationFn: (vars: Vars) => Promise<Result>;
  optimistic?: Optimistic<Vars>;
  /** Skip the post-mutation refresh (the caller refreshes itself). */
  skipInvalidate?: boolean;
}

export function collectionMutation<Vars, Result>(config: CollectionMutation<Vars, Result>): MutationOptions<Result, unknown, Vars, MutationContext> {
  const { queryClient, queryKey } = config;
  return {
    mutationFn: config.mutationFn,
    async onMutate(vars) {
      // A refetch in flight would land after the optimistic state and overwrite it with data from before the change.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const context: MutationContext = { previous: {}, applied: {} };
      const current = queryClient.getQueryData<WorkspaceCache>(queryKey);
      if (!current || !config.optimistic) return context;
      const changes = config.optimistic(current, vars);
      const stored = queryClient.setQueryData<WorkspaceCache>(queryKey, { ...current, ...changes });
      for (const key of Object.keys(changes) as Collections[]) {
        context.previous[key] = current[key];
        // What the cache really holds now (structural sharing may return other array instances than the ones passed in).
        context.applied[key] = stored?.[key];
      }
      return context;
    },
    onError(_error, _vars, context) {
      if (!context) return;
      queryClient.setQueryData<WorkspaceCache | undefined>(queryKey, (cache) => {
        if (!cache) return cache;
        const restored = { ...cache };
        for (const key of Object.keys(context.applied) as Collections[]) {
          // A newer edit or a successful refresh replaced the optimistic value: leave it alone.
          if (cache[key] === context.applied[key]) (restored as Record<string, unknown>)[key] = context.previous[key];
        }
        return restored;
      });
    },
    async onSettled() {
      if (!config.skipInvalidate) await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  };
}

const now = () => new Date().toISOString();

/** Insert-or-patch of one record in a collection, newest first for inserts. */
export function upsertRecord<Row extends Record<string, any>>(rows: Row[], idKey: keyof Row & string, id: string | undefined, data: Partial<Row>, tempPrefix: string): Row[] {
  if (id && rows.some((row) => row[idKey] === id)) {
    return rows.map((row) => (row[idKey] === id ? { ...row, ...data, updated_at: now() } : row));
  }
  const tempId = (data[idKey] as string | undefined) || `${tempPrefix}-${Date.now()}`;
  return [{ [idKey]: tempId, ...data, created_at: now(), updated_at: now() } as unknown as Row, ...rows];
}

/** What deleting a partner removes from the cached snapshot: the partner and the contracts and orders under it. */
export const removePartnerCascade: Optimistic<{ id: string }> = (cache, { id }) => ({
  partners: cache.partners.filter((p) => p.partner_id !== id),
  contracts: cache.contracts.filter((c) => c.partner_id !== id),
  ios: cache.ios.filter((i) => i.partner_id !== id),
});
export const removeContract: Optimistic<{ id: string }> = (cache, { id }) => ({ contracts: cache.contracts.filter((c) => c.contract_id !== id) });
export const removeOrder: Optimistic<{ id: string }> = (cache, { id }) => ({ ios: cache.ios.filter((i) => i.io_id !== id) });
