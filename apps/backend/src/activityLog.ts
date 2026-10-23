import crypto from 'node:crypto';
import type { Sql } from './db';

/**
 * Operational activity (the History drawer's dataset): one append-only INSERT per event into `activity_logs`,
 * scoped by organization and never capped. The table is not part of the in-memory projection or its full-database save.
 */
export interface ActivityEntry {
  organizationId: string | null;
  userEmail?: string | null;
  userName?: string | null;
  role?: string | null;
  actionType: string;
  module: string;
  description: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Optional structured detail (record id, file name, ...); stored with the row. */
  details?: Record<string, unknown>;
}

export interface ActivityRow {
  id: string; organizationId: string | null; timestamp: string; userEmail: string | null; userName: string | null; role: string | null;
  actionType: string; module: string; description: string; ipAddress: string | null; userAgent: string | null;
  details?: Record<string, unknown>;
}

const MAX_PAGE = 1000;
export const DEFAULT_PAGE = 500;

export async function appendActivity(db: Sql, entry: ActivityEntry): Promise<ActivityRow> {
  const row: ActivityRow = {
    id: `act-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    organizationId: entry.organizationId ?? null,
    timestamp: new Date().toISOString(),
    userEmail: entry.userEmail ?? null, userName: entry.userName ?? null, role: entry.role ?? null,
    actionType: entry.actionType, module: entry.module, description: entry.description,
    ipAddress: entry.ipAddress ?? null, userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 512) : null,
  };
  await db.run(`INSERT INTO activity_logs (id, organization_id, record_position, extra_json, timestamp, user_email, user_name, role, action_type, module, description, ip_address, user_agent)
    VALUES (@id, @organizationId, 0, @extra, @timestamp, @userEmail, @userName, @role, @actionType, @module, @description, @ipAddress, @userAgent)`,
    { ...row, extra: JSON.stringify(entry.details ? { details: entry.details } : {}) });
  if (entry.details) row.details = entry.details;
  return row;
}

export interface ActivityPage { rows: ActivityRow[]; total: number; limit: number; offset: number }

/** Newest first. `limit` is clamped to 1..1000 (default 500), `offset` to >= 0. */
export async function listActivity(db: Sql, organizationId: string, options: { limit?: unknown; offset?: unknown } = {}): Promise<ActivityPage> {
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(Number(options.limit)) || DEFAULT_PAGE));
  const offset = Math.max(0, Math.trunc(Number(options.offset)) || 0);
  const total = Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity_logs WHERE organization_id = ?', organizationId))?.n ?? 0);
  const records = await db.all<Record<string, any>>(
    'SELECT * FROM activity_logs WHERE organization_id = ? ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?', organizationId, limit, offset);
  const rows = records.map((r): ActivityRow => {
    const extra = JSON.parse(r.extra_json || '{}');
    return {
      id: r.id, organizationId: r.organization_id, timestamp: r.timestamp, userEmail: r.user_email, userName: r.user_name, role: r.role,
      actionType: r.action_type, module: r.module, description: r.description, ipAddress: r.ip_address, userAgent: r.user_agent,
      ...(extra.details ? { details: extra.details } : {}),
    };
  });
  return { rows, total, limit, offset };
}
