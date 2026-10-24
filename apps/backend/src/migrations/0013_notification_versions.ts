import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Notifications become repository-backed (src/repositories/notificationRepository.ts). Existing rows are adopted in place and start
 * at version 1; the version moves with every change of a notification.
 */
export const migration: Migration = {
  id: '0013_notification_versions',
  name: 'Notifications: version column and parent lookup index',
  async up(sql: Sql) {
    await sql.exec(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_v13_notifications_parent_id ON notifications (organization_id, parent_id);
    `);
  },
};
