import { useQueryClient, useMutation, type QueryKey } from '@tanstack/react-query';
import type { Contract, InsertionOrder, Partner } from '@legalio/types';
import { contractsApi } from '../../api/contracts';
import { ordersApi } from '../../api/orders';
import { partnersApi } from '../../api/partners';
import { notificationsApi } from '../../api/notifications';
import { collectionMutation, removeContract, removeOrder, removePartnerCascade, upsertRecord } from './workspaceCache';

/**
 * Create / edit / delete of the core records as TanStack mutations: instant optimistic update of the cached workspace, rollback on
 * failure, then a server refresh. Callers decide what to tell the user; the promise rejects with the ApiError.
 */
export function useWorkspaceMutations(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const base = { queryClient, queryKey };

  const saveContract = useMutation(collectionMutation({
    ...base,
    mutationFn: ({ data, editing }: { data: Record<string, any>; editing?: Contract | null }) => {
      // The version the user saw travels with the edit, so a copy that went stale in the meantime is refused (409) instead of overwriting.
      const body = editing?.contract_id && data.version === undefined && editing.version !== undefined ? { ...data, version: editing.version } : data;
      return contractsApi.save(editing?.contract_id, body);
    },
    optimistic: (cache, { data, editing }) => ({ contracts: upsertRecord(cache.contracts, 'contract_id', editing?.contract_id, data as Partial<Contract>, 'CTR') }),
  }));
  const deleteContract = useMutation(collectionMutation({ ...base, mutationFn: ({ id }: { id: string }) => contractsApi.remove(id), optimistic: removeContract }));

  const saveOrder = useMutation(collectionMutation({
    ...base,
    mutationFn: ({ data, editing }: { data: Record<string, any>; editing?: InsertionOrder | null }) =>
      editing?.io_id ? ordersApi.update(editing.io_id, data) : ordersApi.create(data),
    optimistic: (cache, { data, editing }) => ({ ios: upsertRecord(cache.ios, 'io_id', editing?.io_id, data as Partial<InsertionOrder>, 'IO') }),
  }));
  const deleteOrder = useMutation(collectionMutation({ ...base, mutationFn: ({ id }: { id: string }) => ordersApi.remove(id), optimistic: removeOrder }));

  const savePartner = useMutation(collectionMutation({
    ...base,
    mutationFn: ({ data, editing }: { data: Record<string, any>; editing?: Partner | null }) =>
      editing?.partner_id ? partnersApi.update(editing.partner_id, data) : partnersApi.create(data),
    optimistic: (cache, { data, editing }) => ({ partners: upsertRecord(cache.partners, 'partner_id', editing?.partner_id, data as Partial<Partner>, 'PTR') }),
  }));
  const deletePartner = useMutation(collectionMutation({ ...base, mutationFn: ({ id }: { id: string }) => partnersApi.remove(id), optimistic: removePartnerCascade }));

  const saveAmendment = useMutation(collectionMutation({
    ...base,
    mutationFn: ({ data }: { data: Record<string, any> }) => contractsApi.create(data),
    optimistic: (cache, { data }) => ({ contracts: upsertRecord(cache.contracts, 'contract_id', undefined, data as Partial<Contract>, 'AMD') }),
  }));

  const bulkDelete = useMutation(collectionMutation({
    ...base,
    mutationFn: ({ collection, ids }: { collection: 'contracts' | 'ios' | 'partners'; ids: string[] }) =>
      ({ contracts: contractsApi, ios: ordersApi, partners: partnersApi })[collection].removeMany(ids),
    // No optimistic removal: the server decides which of the selected records could be deleted.
  }));

  const markNotificationsRead = useMutation(collectionMutation({ ...base, mutationFn: (input: { notifId?: string; markAll?: boolean }) => notificationsApi.markRead(input) }));
  const deleteNotifications = useMutation(collectionMutation({ ...base, mutationFn: (input: { notifId?: string; notifIds?: string[]; deleteAll?: boolean }) => notificationsApi.remove(input) }));

  return {
    saveContract: (data: Record<string, any>, editing?: Contract | null) => saveContract.mutateAsync({ data, editing }),
    deleteContract: (id: string) => deleteContract.mutateAsync({ id }),
    saveOrder: (data: Record<string, any>, editing?: InsertionOrder | null) => saveOrder.mutateAsync({ data, editing }),
    deleteOrder: (id: string) => deleteOrder.mutateAsync({ id }),
    savePartner: (data: Record<string, any>, editing?: Partner | null) => savePartner.mutateAsync({ data, editing }),
    deletePartner: (id: string) => deletePartner.mutateAsync({ id }),
    saveAmendment: (data: Record<string, any>) => saveAmendment.mutateAsync({ data }),
    /** Returns the ids that could not be deleted. */
    bulkDelete: (collection: 'contracts' | 'ios' | 'partners', ids: string[]) => bulkDelete.mutateAsync({ collection, ids }),
    markNotificationsRead: (notifId?: string, markAll?: boolean) => markNotificationsRead.mutateAsync({ notifId, markAll }),
    deleteNotifications: (notifId?: string, notifIds?: string[], deleteAll?: boolean) => deleteNotifications.mutateAsync({ notifId, notifIds, deleteAll }),
  };
}
