import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * The Google Drive backup remembers which stored objects it has already mirrored (storage key -> the object's ETag). That index used
 * to be a JSON file next to the application, i.e. per instance; it is a table now, shared by every instance.
 */
export const migration: Migration = {
  id: '0015_drive_backup_index',
  name: 'Drive backup index in the database',
  async up(sql: Sql) {
    await sql.exec(`CREATE TABLE IF NOT EXISTS drive_backup_index (storage_key text PRIMARY KEY, stamp text NOT NULL, backed_up_at text NOT NULL);`);
  },
};
