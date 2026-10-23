import { getRequestTenantId, orgContextOf, scopeOf } from '../recordAccess';
import { RecordKind, recordVisible } from '../recordScope';
import { searchBusinessRows, readBusinessRows, type SearchHit } from '../normalizedCoreStore';
import { sql } from '../db';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';

const KINDS: Record<string, RecordKind> = { partners: 'partner', contracts: 'contract', insertion_orders: 'io', spendings: 'spending', evaluations: 'evaluation' };
/** Matches examined per request: authorization is applied to these, so the cost per request has a ceiling. */
const SCAN_LIMIT = 500;
const MAX_RESULTS = 100;

export function createSearchRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

/**
 * Workspace search: `q` (words, all must match), optional `type` (comma list of partners, contracts, insertion_orders, spendings,
 * evaluations) and `limit` (default 50, at most 100). Matching runs in SQL on the trigram-indexed search table; only records the
 * caller may see are returned or counted, and the records of each type are fetched in one query.
 */
app.get("/api/search", async (req: express.Request, res: express.Response) => {
  const organizationId = getRequestTenantId(req);
  const types = String(req.query.type || '').split(',').map((t) => t.trim()).filter((t) => t in KINDS);
  const limit = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(Number(req.query.limit)) || 50));
  const hits = await searchBusinessRows(sql, organizationId, String(req.query.q || '').slice(0, 1000), { limit: SCAN_LIMIT, types: types.length ? types : Object.keys(KINDS) });
  const byType = new Map<string, SearchHit[]>();
  for (const hit of hits) byType.set(hit.entity_type, [...(byType.get(hit.entity_type) ?? []), hit]);
  const visible = new Set<string>();
  for (const [type, group] of byType) {
    const records = await readBusinessRows(sql, type, organizationId, group.map((hit) => hit.entity_id));
    for (const record of records) {
      if (recordVisible(orgContextOf(req), scopeOf(req), KINDS[type], record)) visible.add(`${type}\u0000${(record as any)[type === 'partners' ? 'partner_id' : type === 'contracts' ? 'contract_id' : type === 'insertion_orders' ? 'io_id' : 'id']}`);
    }
  }
  const permitted = hits.filter((hit) => visible.has(`${hit.entity_type}\u0000${hit.entity_id}`));
  res.json({ results: permitted.slice(0, limit), total: permitted.length });
});
  return app;
}
