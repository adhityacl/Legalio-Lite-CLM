/**
 * Tenant data export (Phase 3 / item 1): an organization administrator requests an export, a background pass builds a ZIP of JSON and
 * CSV files (optionally with the uploaded files), and the result is served from `export_job_chunks` until it expires.
 *
 * - The ZIP is produced as a stream (zipWriter.ts) and written to the database in 1 MiB chunks; no pass holds the archive in memory.
 * - A job is claimed with a conditional UPDATE, so several instances never build the same export; a job whose heartbeat stopped
 *   (instance died) is failed by the next pass.
 * - Secrets are never exported: the platform credentials and SMTP/AI settings live outside the organization's rows, API keys and
 *   webhook secrets are not part of the archive, and approval attachments (file_data) are left out.
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';
import { ENTITIES, entityFor } from './normalizedSchema';
import { createEntityRepository } from './repositories/entityRepository';
import { readOrganizationSettings } from './organizationSettingsStore';
import type { ObjectStore } from './objectStore';
import { createZipWriter, ZipLimitError } from './zipWriter';
import { emitWebhookEvent } from './webhooks';

const log = componentLog('tenantExport');

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_LOCK_KEY = 0x4c474558; // "LGEX"
const CHUNK_BYTES = 1024 * 1024;
const STALE_RUNNING_MS = 10 * 60_000;

export const exportTtlMs = (env: NodeJS.ProcessEnv = process.env) => {
  const hours = Number(env.EXPORT_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600_000;
};
export const exportMaxBytes = (env: NodeJS.ProcessEnv = process.env) => {
  const mb = Number(env.EXPORT_MAX_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 1024) * 1024 * 1024);
};

export type ExportStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';
export interface ExportJob {
  id: string; organizationId: string; requestedBy: string | null; includeFiles: boolean; status: ExportStatus;
  createdAt: string; startedAt: string | null; finishedAt: string | null; expiresAt: string | null;
  sizeBytes: number | null; entryCount: number | null; summary: Record<string, number> | null; error: string | null;
}

const toJob = (row: any): ExportJob => ({
  id: row.id, organizationId: row.organization_id, requestedBy: row.requested_by, includeFiles: Boolean(row.include_files), status: row.status,
  createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, expiresAt: row.expires_at,
  sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
  entryCount: row.entry_count ?? null, summary: row.summary ? JSON.parse(row.summary) : null, error: row.error,
});

export class ExportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Queues an export. One active job per organization: a second request while one is queued or running is a 409. */
export async function createExportJob(db: Sql, input: { organizationId: string; requestedBy: string | null; includeFiles: boolean }): Promise<ExportJob> {
  const id = `exp-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const result = await db.run(`
    INSERT INTO export_jobs (id, organization_id, requested_by, include_files, status, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?) ON CONFLICT DO NOTHING`, id, input.organizationId, input.requestedBy, input.includeFiles, now);
  if (!result.changes) throw new ExportError(409, 'EXPORT_IN_PROGRESS', 'An export of this organization is already queued or running.');
  return (await getExportJob(db, input.organizationId, id))!;
}

export async function getExportJob(db: Sql, organizationId: string, id: string): Promise<ExportJob | null> {
  const row = await db.get(`SELECT * FROM export_jobs WHERE organization_id = ? AND id = ?`, organizationId, id);
  return row ? toJob(row) : null;
}

export async function listExportJobs(db: Sql, organizationId: string, limit = 20): Promise<ExportJob[]> {
  return (await db.all(`SELECT * FROM export_jobs WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, organizationId, limit)).map(toJob);
}

/* ------------------------------ content ------------------------------ */

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Spreadsheet formula injection: a cell that starts like a formula is stored as text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';

/** A JSON array written element by element from batches of rows. */
async function* jsonArray(batches: AsyncIterable<unknown[]>, counter: { n: number }): AsyncGenerator<string> {
  yield '[\n';
  let first = true;
  for await (const batch of batches) {
    let text = '';
    for (const item of batch) {
      text += (first ? '  ' : ',\n  ') + JSON.stringify(item);
      first = false;
      counter.n++;
    }
    yield text;
  }
  yield '\n]\n';
}
async function* csvRows(columns: string[], batches: AsyncIterable<unknown[]>): AsyncGenerator<string> {
  yield csvLine(columns);
  for await (const batch of batches) {
    let text = '';
    for (const row of batch as Array<Record<string, unknown>>) text += csvLine(columns.map((column) => row[column]));
    yield text;
  }
}

async function* entityBatches(db: Sql, table: string, organizationId: string): AsyncGenerator<any[]> {
  yield* createEntityRepository(db, table).batches(500, 'organization_id = ?', [organizationId]);
}

async function* keyset(db: Sql, query: string, organizationId: string, map: (rows: any[]) => Promise<any[]> | any[], size = 500): AsyncGenerator<any[]> {
  let after = '';
  for (;;) {
    const rows = await db.all(query, organizationId, after, size);
    if (!rows.length) return;
    yield await map(rows);
    after = rows[rows.length - 1].id;
    if (rows.length < size) return;
  }
}

const ACTIVITY_COLUMNS = ['id', 'timestamp', 'userEmail', 'userName', 'role', 'actionType', 'module', 'description', 'ipAddress', 'userAgent', 'details'];
const activityRow = (r: any) => {
  let details: unknown;
  try { details = JSON.parse(r.extra_json || '{}').details; } catch { details = undefined; }
  return { id: r.id, timestamp: r.timestamp, userEmail: r.user_email, userName: r.user_name, role: r.role, actionType: r.action_type, module: r.module,
    description: r.description, ipAddress: r.ip_address, userAgent: r.user_agent, ...(details ? { details } : {}) };
};

export interface ExportDeps { store?: () => ObjectStore; maxBytes?: number; now?: () => Date }

/** Entries that are already compressed gain nothing from deflate. */
const STORED_TYPES = /\.(pdf|png|jpe?g|gif|webp|docx|xlsx|pptx|zip)$/i;

async function buildArchive(db: Sql, job: ExportJob, zip: ReturnType<typeof createZipWriter>, deps: ExportDeps): Promise<Record<string, number>> {
  const org = job.organizationId;
  const counts: Record<string, number> = {};
  const jsonEntry = async (name: string, value: unknown) => { await zip.addEntry(name, JSON.stringify(value, null, 2) + '\n'); };

  const orgRow = await db.get(`SELECT id, name, slug FROM organization WHERE id = ?`, org);
  await jsonEntry('export-info.json', {
    format: 'legalio-tenant-export', formatVersion: EXPORT_FORMAT_VERSION, generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    organization: orgRow, includesFiles: job.includeFiles, exportId: job.id,
    notes: 'Secrets (API keys, webhook secrets, provider and SMTP credentials) and approval attachments are not part of this archive.',
  });

  // Settings without secrets: the organization policy, departments and members.
  const departments = await db.all(`SELECT id, name, "createdAt" FROM team WHERE "organizationId" = ? ORDER BY name`, org);
  const members = await db.all(`
    SELECT m.id, m."userId", u.name, u.email, m.role, m.status, m."createdAt" FROM member m JOIN "user" u ON u.id = m."userId"
    WHERE m."organizationId" = ? ORDER BY lower(u.email)`, org);
  await jsonEntry('settings.json', {
    settings: await readOrganizationSettings(db, org),
    departments, members,
  });
  counts.departments = departments.length;
  counts.members = members.length;

  // Business records: JSON keeps every field, CSV the flat columns.
  const exported: Array<[file: string, table: string]> = [
    ['partners', 'partners'], ['contracts', 'contracts'], ['orders', 'insertion_orders'], ['spendings', 'spendings'], ['evaluations', 'evaluations'],
  ];
  for (const [file, table] of exported) {
    const entity = entityFor(table);
    const counter = { n: 0 };
    await zip.addEntry(`${file}.json`, jsonArray(entityBatches(db, table, org), counter));
    counts[file] = counter.n;
    const columns = [entity.key, ...entity.fields.map((field) => field.api), 'version'];
    await zip.addEntry(`${file}.csv`, csvRows(columns, entityBatches(db, table, org)));
  }
  const notifications = { n: 0 };
  await zip.addEntry('notifications.json', jsonArray(entityBatches(db, 'notifications', org), notifications));
  counts.notifications = notifications.n;

  // Documents (metadata only; the content of drafts stays in the application) with their custom metadata fields.
  const documents = { n: 0 };
  await zip.addEntry('documents.json', jsonArray(keyset(db, `
    SELECT id, name, type, status, current_version, file_size, created_by, created_at, modified_by, modified_at FROM contract_documents
    WHERE organization_id = ? AND id > ? ORDER BY id LIMIT ?`, org, async (rows) => {
    const values = await db.all(`
      SELECT dm.contract_id, f.name, dm.field_value FROM document_metadata dm JOIN metadata_fields f ON f.id = dm.field_id
      WHERE f.organization_id = ? AND dm.contract_id = ANY(?) ORDER BY f.name`, org, rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, metadata: Object.fromEntries(values.filter((v) => v.contract_id === row.id).map((v) => [v.name, v.field_value])) }));
  }), documents));
  counts.documents = documents.n;

  // Approvals with their steps and events (no attachments).
  const approvals = { n: 0 };
  await zip.addEntry('approvals.json', jsonArray(keyset(db, `
    SELECT id, code, title, category, note, status, current_step, source, document_id, file_name, file_mime, file_size, created_by, created_at, due_at, decided_at
    FROM approval_requests WHERE organization_id = ? AND id > ? ORDER BY id LIMIT ?`, org, async (rows) => {
    const ids = rows.map((row) => row.id);
    const steps = await db.all(`SELECT request_id, step_no, approver_id, status, comment, decided_at FROM approval_steps WHERE request_id = ANY(?) ORDER BY step_no`, ids);
    const events = await db.all(`SELECT request_id, actor_id, kind, message, created_at FROM approval_events WHERE request_id = ANY(?) ORDER BY created_at, seq`, ids);
    return rows.map((row) => ({ ...row, steps: steps.filter((s) => s.request_id === row.id), events: events.filter((e) => e.request_id === row.id) }));
  }), approvals));
  counts.approvals = approvals.n;

  // Obligations and key dates (the source quote of an AI-extracted one is kept: it is the evidence).
  const obligations = { n: 0 };
  await zip.addEntry('obligations.json', jsonArray(keyset(db, `
    SELECT id, contract_id, io_id, partner_id, title, description, type, due_date, recurrence, recurrence_interval, recurrence_until, responsible_user_id, responsible_department,
      status, lead_days, source, source_quote, source_page, source_confidence, confirmed_by, confirmed_at, completed_at, completed_by, completions, version, created_by, created_at, updated_at
    FROM obligations WHERE organization_id = ? AND id > ? ORDER BY id LIMIT ?`, org, (rows) => rows), obligations));
  counts.obligations = obligations.n;

  // Clause library (approved wording, fallbacks and playbook rules).
  const clauses = { n: 0 };
  await zip.addEntry('clauses.json', jsonArray(keyset(db, `
    SELECT id, title, category, risk_level, approved_text, fallback_texts, guidance, language, jurisdiction, tags, rules, status, starter_key, version, created_by, created_at, updated_at
    FROM clauses WHERE organization_id = ? AND id > ? ORDER BY id LIMIT ?`, org, (rows) => rows), clauses));
  counts.clauses = clauses.n;

  // Activity log (operational history), JSON and CSV.
  const activityQuery = `SELECT * FROM activity_logs WHERE organization_id = ? AND id > ? ORDER BY id LIMIT ?`;
  const activity = { n: 0 };
  await zip.addEntry('activity-log.json', jsonArray(keyset(db, activityQuery, org, (rows) => rows.map(activityRow), 1000), activity));
  counts.activityLog = activity.n;
  await zip.addEntry('activity-log.csv', csvRows(ACTIVITY_COLUMNS, keyset(db, activityQuery, org, (rows) => rows.map(activityRow), 1000)));

  // Files: the manifest lists every stored object of the organization; the objects themselves only on request.
  const keys = await db.all<{ storage_key: string; source: string; created_at: string }>(
    `SELECT storage_key, source, created_at FROM upload_owners WHERE organization_id = ? ORDER BY storage_key`, org);
  const manifest: Array<Record<string, unknown>> = [];
  let included = 0;
  if (job.includeFiles && keys.length) {
    if (!deps.store) throw new ExportError(500, 'STORAGE_NOT_CONFIGURED', 'File storage is not available.');
    const store = deps.store();
    for (const key of keys) {
      const object = await store.get(key.storage_key);
      if (!object) { manifest.push({ key: key.storage_key, source: key.source, uploadedAt: key.created_at, status: 'missing' }); continue; }
      const path = `files/${key.storage_key}`;
      await zip.addEntry(path, object.body, { store: STORED_TYPES.test(key.storage_key) });
      included++;
      manifest.push({ key: key.storage_key, source: key.source, uploadedAt: key.created_at, status: 'included', path, size: object.body.length,
        sha256: crypto.createHash('sha256').update(object.body).digest('hex') });
    }
  } else {
    for (const key of keys) manifest.push({ key: key.storage_key, source: key.source, uploadedAt: key.created_at, status: 'listed' });
  }
  await jsonEntry('files-manifest.json', manifest);
  counts.files = keys.length;
  counts.filesIncluded = included;
  return counts;
}

/** Writes the archive in chunks of CHUNK_BYTES and refreshes the heartbeat with each one. */
async function runBuild(db: Sql, job: ExportJob, deps: ExportDeps) {
  const maxBytes = deps.maxBytes ?? exportMaxBytes();
  let seq = 0;
  let buffered: Buffer[] = [];
  let bufferedBytes = 0;
  let total = 0;
  const flush = async () => {
    if (!bufferedBytes) return;
    const data = Buffer.concat(buffered);
    buffered = []; bufferedBytes = 0;
    await db.run(`INSERT INTO export_job_chunks (job_id, seq, data) VALUES (?, ?, ?)`, job.id, seq++, data);
    await db.run(`UPDATE export_jobs SET heartbeat_at = ? WHERE id = ?`, new Date().toISOString(), job.id);
  };
  const zip = createZipWriter(async (chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new ExportError(413, 'EXPORT_TOO_LARGE', `The export exceeds the ${Math.round(maxBytes / 1048576)} MB limit${job.includeFiles ? '; try again without files' : ''}.`);
    buffered.push(chunk); bufferedBytes += chunk.length;
    if (bufferedBytes >= CHUNK_BYTES) await flush();
  }, deps.now?.());
  const counts = await buildArchive(db, job, zip, deps);
  await zip.finish();
  await flush();
  return { counts, bytes: total, entries: zip.entryCount };
}

/** Claims and runs one queued job. Returns the final state, or null when another instance claimed it first. */
export async function runExportJob(db: Sql, id: string, deps: ExportDeps = {}): Promise<ExportJob | null> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const claimed = await db.run(`UPDATE export_jobs SET status = 'running', started_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'queued'`, now, now, id);
  if (!claimed.changes) return null;
  const row = await db.get(`SELECT * FROM export_jobs WHERE id = ?`, id);
  const job = toJob(row);
  try {
    const result = await runBuild(db, job, deps);
    const finished = (deps.now?.() ?? new Date());
    await db.run(`UPDATE export_jobs SET status = 'succeeded', finished_at = ?, expires_at = ?, size_bytes = ?, entry_count = ?, summary = ?, error = NULL WHERE id = ?`,
      finished.toISOString(), new Date(finished.getTime() + exportTtlMs()).toISOString(), result.bytes, result.entries, JSON.stringify(result.counts), id);
    log.info(`Export ${id} for ${job.organizationId} finished: ${result.entries} entries, ${result.bytes} bytes.`);
    await emitWebhookEvent(db, job.organizationId, 'document.exported', { kind: 'tenant_export', exportId: id, sizeBytes: result.bytes, includesFiles: job.includeFiles, expiresAt: new Date(finished.getTime() + exportTtlMs()).toISOString() });
  } catch (err) {
    const message = err instanceof ExportError || err instanceof ZipLimitError ? err.message : 'The export failed unexpectedly.';
    if (!(err instanceof ExportError)) log.error(`Export ${id} failed:`, err);
    await db.run(`DELETE FROM export_job_chunks WHERE job_id = ?`, id);
    await db.run(`UPDATE export_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`, new Date().toISOString(), message, id);
  }
  return getExportJob(db, job.organizationId, id);
}

/** One pass: fail jobs whose heartbeat stopped, run the queued ones in order, expire finished ones (their chunks are deleted). */
export async function processExports(db: Sql, deps: ExportDeps = {}) {
  const now = deps.now?.() ?? new Date();
  const stale = await db.all(`SELECT id FROM export_jobs WHERE status = 'running' AND heartbeat_at < ?`, new Date(now.getTime() - STALE_RUNNING_MS).toISOString());
  for (const { id } of stale) {
    await db.run(`DELETE FROM export_job_chunks WHERE job_id = ?`, id);
    await db.run(`UPDATE export_jobs SET status = 'failed', finished_at = ?, error = 'The export was interrupted (the server restarted). Request it again.' WHERE id = ? AND status = 'running'`, now.toISOString(), id);
  }
  let ran = 0;
  for (const { id } of await db.all(`SELECT id FROM export_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 10`)) {
    if (await runExportJob(db, id, deps)) ran++;
  }
  const expired = await db.all(`SELECT id FROM export_jobs WHERE status = 'succeeded' AND expires_at <= ?`, now.toISOString());
  for (const { id } of expired) {
    await db.run(`DELETE FROM export_job_chunks WHERE job_id = ?`, id);
    await db.run(`UPDATE export_jobs SET status = 'expired' WHERE id = ?`, id);
  }
  return { ran, expired: expired.length, interrupted: stale.length };
}

/** The finished archive as a stream of chunks, or null when the job has no downloadable result (not finished, failed or expired). */
export async function* exportChunks(db: Sql, id: string): AsyncGenerator<Buffer> {
  for (let seq = 0; ; seq++) {
    const row = await db.get<{ data: Buffer }>(`SELECT data FROM export_job_chunks WHERE job_id = ? AND seq = ?`, id, seq);
    if (!row) return;
    yield row.data;
  }
}

export const isDownloadable = (job: ExportJob, now = new Date()) => job.status === 'succeeded' && Boolean(job.expiresAt) && new Date(job.expiresAt!).getTime() > now.getTime();

export const EXPORTED_TABLES = ENTITIES.filter((entity) => entity.repository).map((entity) => entity.table);
