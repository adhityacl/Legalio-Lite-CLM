import { getRequestTenantId, orgContextOf, scopeOf } from '../recordAccess';
import { RecordKind, recordVisible } from '../recordScope';
import { searchBusinessRows, readBusinessRows } from '../normalizedCoreStore';
import { sql } from '../db';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createSearchRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.get("/api/search", async (req: express.Request, res: express.Response) => {
  const organizationId = getRequestTenantId(req);
  const kinds: Record<string, RecordKind> = { partners: 'partner', contracts: 'contract', insertion_orders: 'io', spendings: 'spending', evaluations: 'evaluation' };
  const hits = await searchBusinessRows(sql, organizationId, String(req.query.q || '').slice(0, 1000));
  const permitted = [];
  for (const hit of hits) {
    const kind = kinds[hit.entity_type];
    if (!kind) continue;
    const record = (await readBusinessRows(sql, hit.entity_type, organizationId, [hit.entity_id]))[0];
    if (record && recordVisible(orgContextOf(req), scopeOf(req), kind, record)) permitted.push(hit);
  }
  res.json({ results: permitted.slice(0, 50), total: permitted.length });
});
  return app;
}
