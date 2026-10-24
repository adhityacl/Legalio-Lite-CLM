import type { NotificationLog } from '@legalio/types';
import { api } from './client';

export const notificationsApi = {
  /** The notifications the caller may see (attached to contracts and orders in their departments). */
  list: (options: { signal?: AbortSignal; organizationId?: string | null } = {}) => api.get<NotificationLog[]>('/notification-logs', { ...options, cache: 'no-store' }),
  markRead: (input: { notifId?: string; markAll?: boolean }) =>
    api.post<{ success?: boolean }>('/notification-logs/mark-read', { notif_id: input.notifId, markAll: input.markAll }),
  remove: (input: { notifId?: string; notifIds?: string[]; deleteAll?: boolean }) =>
    api.post<{ success?: boolean }>('/notification-logs/delete', { notif_id: input.notifId, notif_ids: input.notifIds, deleteAll: input.deleteAll }),
};
