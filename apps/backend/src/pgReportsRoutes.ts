/**
 * PgReport: read-only PostgreSQL monitoring for the System Admin console (superuser only, `platform.database.read`).
 *
 * Every report is a fixed catalog/statistics query. Nothing a caller sends is ever spliced into SQL: the schema is looked up
 * against pg_namespace and bound as a parameter, the sort key is picked from a whitelist, and each report runs in a READ ONLY
 * transaction with a short statement timeout. Query text is truncated because it can contain business data.
 */
import { Router, Request, Response } from 'express';
import type pg from 'pg';
import { pool } from './db';
import { forwardAsyncRouteErrors } from './asyncRoutes';
import { sendError } from './identity';

export const pgReportsRouter = Router();
forwardAsyncRouteErrors(pgReportsRouter);

const TIMEOUT_MS = 10_000;
const QUERY_TEXT_LIMIT = 500;
const ROW_LIMIT = 100;
/** Schemas that belong to PostgreSQL or the hosting platform rather than the application. */
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'realtime', 'extensions', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', 'supabase_functions', 'supabase_migrations', '_realtime', '_analytics'];
/** Roles whose statements are the platform's own housekeeping, not the application's. */
const PLATFORM_ROLE_PATTERN = '^(supabase_|authenticator$|pgbouncer$|dashboard_user$|pgsodium_)';

/** Runs `fn` on one connection inside a READ ONLY transaction with a statement timeout. */
async function readOnly<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function schemaOf(client: pg.PoolClient, requested: unknown): Promise<{ schema: string; schemas: string[] }> {
  const { rows } = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname <> ALL($1::text[]) AND nspname NOT LIKE 'pg\\_%' ORDER BY nspname`, [SYSTEM_SCHEMAS]);
  const schemas = rows.map((row) => row.nspname);
  const wanted = typeof requested === 'string' ? requested : 'public';
  return { schema: schemas.includes(wanted) ? wanted : schemas[0] ?? 'public', schemas };
}

const overview = (client: pg.PoolClient) => async () => {
  const one = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows[0] ?? {};
  const server = await one(`SELECT current_setting('server_version') AS version, pg_postmaster_start_time() AS started_at, pg_database_size(current_database())::float8 AS size_bytes,
                current_setting('max_connections')::int AS max_connections, current_database() AS database`);
  const connections = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state = 'idle')::int AS idle,
                count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction, count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting_on_locks
           FROM pg_stat_activity WHERE datname = current_database()`);
  const stats = await one(`SELECT blks_hit::float8 AS blocks_hit, blks_read::float8 AS blocks_read, xact_commit::float8 AS commits, xact_rollback::float8 AS rollbacks,
                deadlocks::float8 AS deadlocks, temp_files::float8 AS temp_files, temp_bytes::float8 AS temp_bytes, conflicts::float8 AS conflicts, stats_reset
           FROM pg_stat_database WHERE datname = current_database()`);
  const extensions = await client.query(`SELECT name, installed_version AS installed, default_version AS available FROM pg_available_extensions
                   WHERE installed_version IS NOT NULL OR name IN ('pg_stat_statements', 'pgstattuple', 'pg_buffercache') ORDER BY name`);
  const reads = stats.blocks_hit + stats.blocks_read;
  return { server, connections, stats: { ...stats, cache_hit_ratio: reads > 0 ? stats.blocks_hit / reads : null }, extensions: extensions.rows };
};

const connections = (client: pg.PoolClient) => async () => {
  const sessions = await client.query(
    `SELECT a.pid, a.usename AS user, a.application_name, a.client_addr::text AS client_addr, a.state, a.wait_event_type, a.wait_event,
            a.backend_start, a.xact_start, a.query_start, a.state_change,
            EXTRACT(EPOCH FROM (now() - a.query_start))::float8 AS query_seconds, EXTRACT(EPOCH FROM (now() - a.xact_start))::float8 AS transaction_seconds,
            cardinality(pg_blocking_pids(a.pid)) AS blocked_by_count, left(a.query, ${QUERY_TEXT_LIMIT}) AS query
       FROM pg_stat_activity a WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.backend_type = 'client backend'
      ORDER BY (a.state = 'active') DESC, a.query_start NULLS LAST LIMIT ${ROW_LIMIT}`);
  const blocking = await client.query(
    `SELECT blocked.pid AS blocked_pid, blocked.usename AS blocked_user, left(blocked.query, ${QUERY_TEXT_LIMIT}) AS blocked_query,
            EXTRACT(EPOCH FROM (now() - blocked.query_start))::float8 AS blocked_seconds,
            blocker.pid AS blocking_pid, blocker.usename AS blocking_user, blocker.state AS blocking_state, left(blocker.query, ${QUERY_TEXT_LIMIT}) AS blocking_query
       FROM pg_stat_activity blocked
       JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
       JOIN pg_stat_activity blocker ON blocker.pid = b.pid
      WHERE blocked.datname = current_database() ORDER BY blocked_seconds DESC NULLS LAST LIMIT ${ROW_LIMIT}`);
  const locks = await client.query(`SELECT mode, granted, count(*)::int AS count FROM pg_locks GROUP BY mode, granted ORDER BY count DESC`);
  return { sessions: sessions.rows, blocking: blocking.rows, locks: locks.rows };
};

const tables = (client: pg.PoolClient, schemaName: unknown) => async () => {
  const { schema, schemas } = await schemaOf(client, schemaName);
  const { rows } = await client.query(
    `SELECT s.relname AS name, pg_total_relation_size(s.relid)::float8 AS total_bytes, pg_relation_size(s.relid)::float8 AS table_bytes,
            pg_indexes_size(s.relid)::float8 AS index_bytes, s.n_live_tup::float8 AS live_rows, s.n_dead_tup::float8 AS dead_rows,
            CASE WHEN s.n_live_tup + s.n_dead_tup > 0 THEN s.n_dead_tup::float8 / (s.n_live_tup + s.n_dead_tup) END AS dead_ratio,
            s.seq_scan::float8 AS seq_scans, s.idx_scan::float8 AS index_scans, s.n_tup_ins::float8 AS inserts, s.n_tup_upd::float8 AS updates, s.n_tup_del::float8 AS deletes,
            GREATEST(s.last_vacuum, s.last_autovacuum) AS last_vacuum, GREATEST(s.last_analyze, s.last_autoanalyze) AS last_analyze,
            CASE WHEN io.heap_blks_hit + io.heap_blks_read > 0 THEN io.heap_blks_hit::float8 / (io.heap_blks_hit + io.heap_blks_read) END AS cache_hit_ratio
       FROM pg_stat_user_tables s LEFT JOIN pg_statio_user_tables io ON io.relid = s.relid
      WHERE s.schemaname = $1 ORDER BY pg_total_relation_size(s.relid) DESC LIMIT ${ROW_LIMIT}`, [schema]);
  return { schema, schemas, tables: rows };
};

const indexes = (client: pg.PoolClient, schemaName: unknown) => async () => {
  const { schema, schemas } = await schemaOf(client, schemaName);
  const unused = await client.query(
    `SELECT s.relname AS table, s.indexrelname AS index, pg_relation_size(s.indexrelid)::float8 AS size_bytes, s.idx_scan::float8 AS scans
       FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
      WHERE s.schemaname = $1 AND s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid
      ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT ${ROW_LIMIT}`, [schema]);
  const duplicate = await client.query(
    `SELECT c.relname AS table, array_agg(ic.relname ORDER BY ic.relname) AS indexes, sum(pg_relation_size(i.indexrelid))::float8 AS size_bytes
       FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND i.indisvalid
      GROUP BY c.relname, i.indrelid, i.indkey::text, i.indclass::text, i.indcollation::text, coalesce(pg_get_expr(i.indexprs, i.indrelid), ''), coalesce(pg_get_expr(i.indpred, i.indrelid), '')
     HAVING count(*) > 1 ORDER BY sum(pg_relation_size(i.indexrelid)) DESC LIMIT ${ROW_LIMIT}`, [schema]);
  const invalid = await client.query(
    `SELECT c.relname AS table, ic.relname AS index, pg_relation_size(i.indexrelid)::float8 AS size_bytes
       FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND NOT i.indisvalid ORDER BY c.relname, ic.relname LIMIT ${ROW_LIMIT}`, [schema]);
  const seqHeavy = await client.query(
    `SELECT s.relname AS table, s.seq_scan::float8 AS seq_scans, coalesce(s.idx_scan, 0)::float8 AS index_scans, s.n_live_tup::float8 AS live_rows
       FROM pg_stat_user_tables s WHERE s.schemaname = $1 AND s.n_live_tup > 1000 AND s.seq_scan > coalesce(s.idx_scan, 0) * 2 AND s.seq_scan > 100
      ORDER BY s.seq_scan * s.n_live_tup DESC LIMIT ${ROW_LIMIT}`, [schema]);
  return { schema, schemas, unused: unused.rows, duplicate: duplicate.rows, invalid: invalid.rows, seqHeavy: seqHeavy.rows };
};

const SORT_KEYS: Record<string, string> = { total: 'total_exec_time', mean: 'mean_exec_time', calls: 'calls', rows: 'rows' };

const queries = (client: pg.PoolClient, sortKey: unknown) => async () => {
  const installed = (await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`)).rowCount;
  if (!installed) return { available: false, sort: 'total', rows: [] };
  const sort = typeof sortKey === 'string' && SORT_KEYS[sortKey] ? sortKey : 'total';
  const { rows } = await client.query(
    `SELECT left(s.query, ${QUERY_TEXT_LIMIT}) AS query, r.rolname AS user, s.calls::float8 AS calls, s.total_exec_time::float8 AS total_ms, s.mean_exec_time::float8 AS mean_ms,
            s.max_exec_time::float8 AS max_ms, s.rows::float8 AS rows,
            CASE WHEN s.shared_blks_hit + s.shared_blks_read > 0 THEN s.shared_blks_hit::float8 / (s.shared_blks_hit + s.shared_blks_read) END AS cache_hit_ratio
       FROM pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid
      WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND r.rolname !~ $1 AND s.query NOT LIKE '%pg\\_stat\\_statements%'
      ORDER BY s.${SORT_KEYS[sort]} DESC LIMIT ${ROW_LIMIT}`, [PLATFORM_ROLE_PATTERN]);
  return { available: true, sort, rows };
};

const REPORTS: Record<string, (client: pg.PoolClient, req: Request) => () => Promise<unknown>> = {
  overview: (client) => overview(client),
  connections: (client) => connections(client),
  tables: (client, req) => tables(client, req.query.schema),
  indexes: (client, req) => indexes(client, req.query.schema),
  queries: (client, req) => queries(client, req.query.sort),
};

pgReportsRouter.get('/:report', async (req: Request, res: Response) => {
  const report = Object.prototype.hasOwnProperty.call(REPORTS, req.params.report) ? REPORTS[req.params.report] : undefined;
  if (!report) return sendError(req, res, 404, 'NOT_FOUND', 'Unknown report.');
  try {
    const data = await readOnly((client) => report(client, req)());
    res.setHeader('Cache-Control', 'no-store');
    res.json({ report: req.params.report, generatedAt: new Date().toISOString(), data });
  } catch (err: any) {
    const timedOut = err?.code === '57014';
    return sendError(req, res, timedOut ? 504 : 500, timedOut ? 'REPORT_TIMEOUT' : 'REPORT_FAILED',
      timedOut ? `The report took longer than ${TIMEOUT_MS / 1000} seconds.` : 'The report could not be generated.');
  }
});
