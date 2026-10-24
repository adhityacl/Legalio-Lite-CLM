/**
 * In-app notifications (reminders and notices): explicit SQL for every read and write, scoped by organization. They are not part of the
 * in-memory snapshot (see normalizedSchema.ts `repository: true`). Set-based changes (mark as read, delete a selection) are single
 * statements; each changed row moves to a new version.
 */
import { sql, type Sql } from '../db';
import { createEntityRepository, type Row } from './entityRepository';

export type Notification = Row;

export function createNotificationRepository(db: Sql) {
  const base = createEntityRepository(db, 'notifications');
  return {
    ...base,
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM notifications LIMIT 1'));
    },
    /** Marks the notifications with these ids (all of the organization's when `ids` is omitted) as read; returns the number that changed. */
    async markRead(organizationId: string, ids?: string[]): Promise<number> {
      return (await db.run(
        `UPDATE notifications SET is_read = 1, version = version + 1 WHERE organization_id = ? AND is_read IS DISTINCT FROM 1 ${ids ? 'AND notif_id = ANY(?)' : ''}`,
        organizationId, ...(ids ? [ids] : []))).changes;
    },
    /** The e-mail for this notification was delivered. Another instance may have delivered it first: the flag is simply set. */
    async markSent(organizationId: string, notifId: string): Promise<boolean> {
      return (await db.run(
        'UPDATE notifications SET is_sent = 1, version = version + 1 WHERE organization_id = ? AND notif_id = ? AND is_sent IS DISTINCT FROM 1', organizationId, notifId)).changes > 0;
    },
    /** Deletes these notifications of the organization. */
    async removeMany(organizationId: string, ids: string[]): Promise<number> {
      if (!ids.length) return 0;
      return (await db.run('DELETE FROM notifications WHERE organization_id = ? AND notif_id = ANY(?)', organizationId, ids)).changes;
    },
    /** Deletes every notification attached to one of these records (a contract, an order), whatever its type. */
    async removeByParents(organizationId: string, parentIds: string[], parentType?: string): Promise<number> {
      if (!parentIds.length) return 0;
      return (await db.run(
        `DELETE FROM notifications WHERE organization_id = ? AND parent_id = ANY(?) ${parentType ? 'AND parent_type = ?' : ''}`,
        organizationId, parentIds, ...(parentType ? [parentType] : []))).changes;
    },
    /** Reminder notifications written before the reminder ledger existed (type "Reminder 30d" / "Reminder H-30"): the ledger is seeded from them. */
    async legacyReminders(): Promise<Array<{ parent_type: string; parent_id: string; notification_type: string }>> {
      return db.all(`SELECT parent_type, parent_id, notification_type FROM notifications WHERE notification_type ~ '^Reminder (\\d+d|H-\\d+)$'`);
    },
  };
}

/** The application's notification repository (the shared SQL facade; its transactions are ambient). */
export const notificationRepository = createNotificationRepository(sql);
export type NotificationRepository = ReturnType<typeof createNotificationRepository>;
