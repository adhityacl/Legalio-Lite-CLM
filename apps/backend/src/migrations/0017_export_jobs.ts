import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Tenant data export: one job row per request and the finished ZIP stored in 1 MiB chunks, so any instance can serve the download
 * and nothing depends on a local disk or on object storage being configured. Rows go with the organization (ON DELETE CASCADE).
 * At most one queued or running export per organization (partial unique index).
 */
export const migration: Migration = {
  id: '0017_export_jobs',
  name: 'Tenant data export jobs and result chunks',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS export_jobs (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        requested_by text,
        include_files boolean NOT NULL DEFAULT false,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'expired')),
        created_at text NOT NULL, started_at text, heartbeat_at text, finished_at text, expires_at text,
        size_bytes bigint, entry_count integer, summary text, error text);
      CREATE INDEX IF NOT EXISTS idx_export_jobs_org ON export_jobs (organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs (status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_export_jobs_active ON export_jobs (organization_id) WHERE status IN ('queued', 'running');
      CREATE TABLE IF NOT EXISTS export_job_chunks (
        job_id text NOT NULL REFERENCES export_jobs(id) ON DELETE CASCADE, seq integer NOT NULL, data bytea NOT NULL,
        PRIMARY KEY (job_id, seq));
    `);
  },
};
