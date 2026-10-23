import { api } from './client';

export const notificationsApi = {
  markRead: (input: { notifId?: string; markAll?: boolean }) =>
    api.post<{ success?: boolean }>('/notification-logs/mark-read', { notif_id: input.notifId, markAll: input.markAll }),
  remove: (input: { notifId?: string; notifIds?: string[]; deleteAll?: boolean }) =>
    api.post<{ success?: boolean }>('/notification-logs/delete', { notif_id: input.notifId, notif_ids: input.notifIds, deleteAll: input.deleteAll }),
};
