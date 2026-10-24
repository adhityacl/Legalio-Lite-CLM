/**
 * Read-only aggregates for the dashboard, the navigation badges and the hierarchy, computed by SQL so the browser does not need every
 * record. Every figure is limited to the caller's organization and, for department roles, to the records their departments own
 * (the same rule the list endpoints apply). `final_only=1` additionally applies the viewer rule of the product (final contracts only).
 */
import express from 'express';
import { sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { hasOrganizationScope } from '../rbac';
import { recordVisible } from '../recordScope';
import { getRequestTenantId, orgContextOf, scopeCollectionsOf, scopeOf } from '../recordAccess';
import { partnerRepository } from '../repositories/partnerRepository';

interface Fragment { sql: string; params: unknown[] }
const NONE: Fragment = { sql: '', params: [] };

/** SQL restrictions that make an aggregate see only what the caller may see. */
function scopeFilters(req: express.Request) {
  const ctx = orgContextOf(req);
  const finalOnly = req.query.final_only === '1' || req.query.final_only === 'true';
  const finalContracts: Fragment = finalOnly
    ? { sql: ` AND (c.status IN ('Active', 'Expiring') OR c.status_approval IN ('Signed', 'Active'))`, params: [] }
    : NONE;
  if (hasOrganizationScope(ctx)) {
    return { contracts: finalContracts, ios: NONE, partners: NONE, spendings: NONE, evaluations: NONE, notifications: NONE };
  }
  const scope = scopeOf(req);
  const directory = scopeCollectionsOf(req);
  const visible = <T extends { organizationId: string }>(kind: 'partner' | 'contract' | 'io', rows: T[]) => rows.filter((row) => recordVisible(ctx, scope, kind, row));
  const partners = visible('partner', directory.partners as any[]);
  const contracts = visible('contract', directory.contracts as any[]);
  const ios = visible('io', directory.ios as any[]);
  const partnerIds = partners.map((p: any) => p.partner_id);
  const partnerNames = partners.map((p: any) => String(p.partner_name ?? '').trim().toLowerCase()).filter(Boolean);
  const contractIds = contracts.map((c: any) => c.contract_id);
  const ioIds = ios.map((i: any) => i.io_id);
  const vendorLike = (alias: string, idColumn: string, nameColumn: string): Fragment => ({
    sql: ` AND (${alias}.${idColumn} = ANY(?) OR lower(btrim(${alias}.${nameColumn})) = ANY(?))`, params: [partnerIds, partnerNames],
  });
  return {
    contracts: { sql: ` AND c.contract_id = ANY(?)${finalContracts.sql}`, params: [contractIds] } as Fragment,
    ios: { sql: ' AND i.io_id = ANY(?)', params: [ioIds] } as Fragment,
    partners: { sql: ' AND p.partner_id = ANY(?)', params: [partnerIds] } as Fragment,
    spendings: vendorLike('s', 'vendor_id', 'vendor_name'),
    evaluations: vendorLike('e', 'partner_id', 'supplier_name'),
    // A notification belongs to the contract or order it is attached to.
    notifications: { sql: ' AND (n.parent_id = ANY(?) OR n.parent_id = ANY(?))', params: [contractIds, ioIds] } as Fragment,
  };
}

const num = (value: unknown) => Number(value) || 0;
const countBy = (rows: Array<{ key: string | null; n: number | string }>) => Object.fromEntries(rows.map((r) => [r.key ?? '', num(r.n)]));
const USD = (alias: string, column: string) => `${alias}.${column}_minor::numeric / power(10::numeric, COALESCE(${alias}.${column}_scale, 0))`;

export function createAggregatesRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

  /** Everything the dashboard shows, in one response. */
  app.get('/api/aggregates/dashboard', async (req: express.Request, res: express.Response) => {
    const org = getRequestTenantId(req);
    const f = scopeFilters(req);
    const cWhere = `c.organization_id = ?${f.contracts.sql}`;
    const cParams = [org, ...f.contracts.params];
    const iWhere = `i.organization_id = ?${f.ios.sql}`;
    const iParams = [org, ...f.ios.params];

    const contractsByStatus = await sql.all<{ key: string; n: number }>(`SELECT c.status AS key, COUNT(*) AS n FROM contracts c WHERE ${cWhere} GROUP BY c.status`, ...cParams);
    const contractsByApproval = await sql.all<{ key: string; n: number }>(`SELECT c.status_approval AS key, COUNT(*) AS n FROM contracts c WHERE ${cWhere} GROUP BY c.status_approval`, ...cParams);
    const activeValue = await sql.all<{ currency: string | null; amount: string; amount_usd_known: string; amount_missing_usd: string }>(
      `SELECT c.currency, SUM(${USD('c', 'contract_value')}) AS amount,
         SUM(CASE WHEN c.contract_value_usd_minor IS NOT NULL THEN ${USD('c', 'contract_value_usd')} ELSE 0 END) AS amount_usd_known,
         SUM(CASE WHEN c.contract_value_usd_minor IS NULL THEN ${USD('c', 'contract_value')} ELSE 0 END) AS amount_missing_usd
       FROM contracts c WHERE ${cWhere} AND c.status IN ('Active', 'Expiring') GROUP BY c.currency`, ...cParams);
    const iosByStatus = await sql.all<{ key: string; n: number }>(`SELECT i.status AS key, COUNT(*) AS n FROM insertion_orders i WHERE ${iWhere} GROUP BY i.status`, ...iParams);
    const categories = (await sql.all<{ category: string }>(
      `SELECT DISTINCT cc.category FROM contract_categories cc JOIN contracts c ON c.contract_id = cc.contract_id WHERE ${cWhere} AND btrim(cc.category) <> '' ORDER BY cc.category`, ...cParams)).map((r) => r.category.trim());

    const pWhere = `p.organization_id = ?${f.partners.sql}`;
    const pParams = [org, ...f.partners.params];
    const partnerTotals = await sql.get<{ total: number; active: number }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM contracts ac WHERE ac.organization_id = p.organization_id AND ac.partner_id = p.partner_id AND ac.status IN ('Active', 'Expiring'))) AS active
       FROM partners p WHERE ${pWhere}`, ...pParams);
    const partnersByDd = await sql.all<{ key: string; n: number }>(`SELECT p.status_dd AS key, COUNT(*) AS n FROM partners p WHERE ${pWhere} GROUP BY p.status_dd`, ...pParams);

    const cols = `c.contract_id AS id, c.contract_title AS title, c.contract_number AS number, c.document_type, c.partner_id, pa.partner_name, c.end_date, c.extra_json::jsonb -> 'days_remaining' AS days_remaining, c.status, c.created_at`;
    const contractFrom = `contracts c LEFT JOIN partners pa ON pa.organization_id = c.organization_id AND pa.partner_id = c.partner_id`;
    const expiringContracts = await sql.all(`SELECT ${cols} FROM ${contractFrom} WHERE ${cWhere} AND c.status = 'Expiring' ORDER BY c.end_date, c.contract_id LIMIT 5`, ...cParams);
    const recentContracts = await sql.all(`SELECT ${cols} FROM ${contractFrom} WHERE ${cWhere} AND c.created_at >= ? ORDER BY c.created_at DESC, c.contract_id LIMIT 5`, ...cParams, new Date(Date.now() - 92 * 86_400_000).toISOString());
    const ioCols = `i.io_id AS id, i.io_title AS title, i.io_number AS number, i.partner_id, pa.partner_name, COALESCE(NULLIF(i.end_date, ''), i.completion_date) AS end_date, i.extra_json::jsonb -> 'days_remaining' AS days_remaining, i.status, i.created_at`;
    const ioFrom = `insertion_orders i LEFT JOIN partners pa ON pa.organization_id = i.organization_id AND pa.partner_id = i.partner_id`;
    const expiringIos = await sql.all(`SELECT ${ioCols} FROM ${ioFrom} WHERE ${iWhere} AND i.status = 'Expiring' ORDER BY i.end_date, i.io_id LIMIT 5`, ...iParams);
    const recentIos = await sql.all(`SELECT ${ioCols} FROM ${ioFrom} WHERE ${iWhere} AND i.created_at >= ? ORDER BY i.created_at DESC, i.io_id LIMIT 5`, ...iParams, new Date(Date.now() - 92 * 86_400_000).toISOString());

    const unread = await sql.get<{ total: number; unread: number }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE n.is_read IS DISTINCT FROM 1) AS unread FROM notifications n WHERE n.organization_id = ?${f.notifications.sql}`, org, ...f.notifications.params);

    const spendingRows = await spendingByMonth(org, f.spendings);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      organizationId: org,
      partners: { total: num(partnerTotals?.total), active: num(partnerTotals?.active), byDdStatus: countBy(partnersByDd) },
      contracts: {
        total: contractsByStatus.reduce((sum, r) => sum + num(r.n), 0), byStatus: countBy(contractsByStatus), byApproval: countBy(contractsByApproval),
        activeValueByCurrency: activeValue.map((r) => ({ currency: r.currency ?? '', amount: num(r.amount), amountUsdKnown: num(r.amount_usd_known), amountMissingUsd: num(r.amount_missing_usd) })),
      },
      ios: { total: iosByStatus.reduce((sum, r) => sum + num(r.n), 0), byStatus: countBy(iosByStatus) },
      notifications: { total: num(unread?.total), unread: num(unread?.unread) },
      expiring: { contracts: expiringContracts, ios: expiringIos },
      recent: { contracts: recentContracts, ios: recentIos },
      categories,
      spending: spendingRows,
    });
  });

  /** Reporting-month spending per vendor and currency, in the invoice's currency and in USD (the invoice's own exchange rate). */
  async function spendingByMonth(org: string, scope: Fragment) {
    const rows = await sql.all<{ vendor_id: string | null; partner_id: string | null; vendor_name: string | null; month: string; currency: string | null; amount: string; amount_usd: string | null }>(`
      WITH base AS (
        SELECT s.id, s.vendor_id, s.vendor_name, s.currency, s.organization_id,
               ${USD('s', 'total_amount')} AS total, ${USD('s', 'total_amount_usd')} AS total_usd, s.total_amount_usd_minor IS NOT NULL AS has_usd,
               s.invoice_date,
               EXISTS (SELECT 1 FROM spending_allocations sa WHERE sa.spending_id = s.id) AS explicit
        FROM spendings s WHERE s.organization_id = ?${scope.sql}
      ), periods AS (
        SELECT b.id, a.month, a.amount_minor::numeric / power(10::numeric, a.amount_scale) AS amount FROM base b JOIN spending_allocations a ON a.spending_id = b.id
        UNION ALL
        SELECT b.id, m.period, b.total / NULLIF(COUNT(*) OVER (PARTITION BY b.id), 0)
        FROM base b JOIN LATERAL (
          SELECT DISTINCT left(rm.month, 7) AS period FROM spending_reporting_months rm WHERE rm.spending_id = b.id AND rm.month ~ '^[0-9]{4}-[0-9]{2}'
          UNION
          SELECT left(b.invoice_date, 7) WHERE b.invoice_date ~ '^[0-9]{4}-[0-9]{2}' AND NOT EXISTS (SELECT 1 FROM spending_reporting_months rx WHERE rx.spending_id = b.id AND rx.month ~ '^[0-9]{4}-[0-9]{2}')
        ) m ON TRUE
        WHERE NOT b.explicit
      )
      SELECT b.vendor_id,
             COALESCE((SELECT pp.partner_id FROM partners pp WHERE pp.organization_id = b.organization_id AND pp.partner_id = b.vendor_id),
                      (SELECT pp.partner_id FROM partners pp WHERE pp.organization_id = b.organization_id AND lower(btrim(pp.partner_name)) = lower(btrim(b.vendor_name)) ORDER BY pp.record_position LIMIT 1)) AS partner_id,
             b.vendor_name, p.month, b.currency, SUM(p.amount) AS amount,
             SUM(CASE WHEN b.has_usd AND b.total > 0 THEN p.amount * b.total_usd / b.total END) AS amount_usd
      FROM periods p JOIN base b ON b.id = p.id
      GROUP BY b.vendor_id, 2, b.vendor_name, p.month, b.currency, b.organization_id
      ORDER BY p.month, b.vendor_name`, org, ...scope.params);
    const partnerIds = [...new Set(rows.map((r) => r.partner_id).filter((id): id is string => Boolean(id)))];
    const categories = partnerIds.length ? await sql.all<{ partner_id: string; categories: string[] }>(
      `SELECT c.partner_id, array_agg(DISTINCT cc.category) AS categories FROM contracts c JOIN contract_categories cc ON cc.contract_id = c.contract_id
       WHERE c.organization_id = ? AND c.partner_id = ANY(?) GROUP BY c.partner_id`, org, partnerIds) : [];
    const byPartner = new Map(categories.map((r) => [r.partner_id, r.categories.map((c) => c.trim()).filter(Boolean)]));
    return rows.map((r) => ({
      vendor_id: r.vendor_id ?? r.partner_id ?? null, vendor_name: r.vendor_name ?? '', month: r.month, currency: r.currency ?? '',
      amount: num(r.amount), amount_usd: r.amount_usd === null ? null : num(r.amount_usd), categories: r.partner_id ? byPartner.get(r.partner_id) ?? [] : [],
    }));
  }

  /** The two numbers the navigation badges show. */
  app.get('/api/aggregates/badges', async (req: express.Request, res: express.Response) => {
    const org = getRequestTenantId(req);
    const f = scopeFilters(req);
    const expiring = await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contracts c WHERE c.organization_id = ?${f.contracts.sql} AND c.status = 'Expiring'`, org, ...f.contracts.params);
    const unread = await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications n WHERE n.organization_id = ?${f.notifications.sql} AND n.is_read IS DISTINCT FROM 1`, org, ...f.notifications.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ expiringContracts: num(expiring?.n), unreadNotifications: num(unread?.n) });
  });

  /** Distinct values for filter drop-downs. */
  app.get('/api/aggregates/facets', async (req: express.Request, res: express.Response) => {
    const org = getRequestTenantId(req);
    const f = scopeFilters(req);
    const distinct = async (text: string, ...params: unknown[]) => (await sql.all<{ value: string | null }>(text, ...params)).map((r) => (r.value ?? '').trim()).filter(Boolean);
    const years = await sql.all<{ value: string }>(
      `SELECT DISTINCT y AS value FROM (
         SELECT left(rm.month, 4) AS y FROM spending_reporting_months rm JOIN spendings s ON s.id = rm.spending_id WHERE s.organization_id = ?${f.spendings.sql}
         UNION SELECT left(s.invoice_date, 4) FROM spendings s WHERE s.organization_id = ?${f.spendings.sql}) t
       WHERE y ~ '^[0-9]{4}$' ORDER BY y DESC`, org, ...f.spendings.params, org, ...f.spendings.params);
    res.json({
      categories: await distinct(`SELECT DISTINCT cc.category AS value FROM contract_categories cc JOIN contracts c ON c.contract_id = cc.contract_id WHERE c.organization_id = ?${f.contracts.sql} ORDER BY 1`, org, ...f.contracts.params),
      pricingModels: await distinct(`SELECT DISTINCT i.pricing_model AS value FROM insertion_orders i WHERE i.organization_id = ?${f.ios.sql} ORDER BY 1`, org, ...f.ios.params),
      chargingTypes: await distinct(`SELECT DISTINCT COALESCE(NULLIF(i.charging_type, ''), i.payment_scheme) AS value FROM insertion_orders i WHERE i.organization_id = ?${f.ios.sql} ORDER BY 1`, org, ...f.ios.params),
      vendors: await distinct(`SELECT DISTINCT s.vendor_name AS value FROM spendings s WHERE s.organization_id = ?${f.spendings.sql} ORDER BY 1`, org, ...f.spendings.params),
      spendingYears: years.map((r) => r.value),
      departments: await distinct(`SELECT DISTINCT p.internal_pic AS value FROM partners p WHERE p.organization_id = ?${f.partners.sql} ORDER BY 1`, org, ...f.partners.params),
      countries: await distinct(`SELECT DISTINCT p.country AS value FROM partners p WHERE p.organization_id = ?${f.partners.sql} ORDER BY 1`, org, ...f.partners.params),
    });
  });

  /**
   * Per-partner roll-ups for one page of partners (same parameters as GET /api/partners: limit, offset, q, deep, sort, dir, filters):
   * contract and order counts by state and value, invoices, evaluations and the nearest end date. X-Total-Count is the number of partners.
   */
  app.get('/api/aggregates/partners', async (req: express.Request, res: express.Response) => {
    const org = getRequestTenantId(req);
    const ctx = orgContextOf(req);
    const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const list = (v: unknown) => text(v, 500).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(req.query.limit)) || 50));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
    const query = {
      q: text(req.query.q) || undefined, deep: req.query.deep === '1' || req.query.deep === 'true',
      internalPic: list(req.query.internal_pic), statusDd: list(req.query.status_dd), partnerType: list(req.query.partner_type), country: list(req.query.country),
      sort: (['partner_name', 'internal_pic', 'status_dd', 'created_at'] as const).find((s) => s === text(req.query.sort, 30)) ?? 'partner_name',
      dir: text(req.query.dir, 4).toLowerCase() === 'desc' ? 'desc' as const : 'asc' as const,
    };
    let rows: any[];
    let total: number;
    if (hasOrganizationScope(ctx)) {
      ({ rows, total } = await partnerRepository.list(org, { ...query, limit, offset }));
    } else {
      const matched = (await partnerRepository.list(org, query)).rows.filter((row) => recordVisible(ctx, scopeOf(req), 'partner', row));
      total = matched.length;
      rows = matched.slice(offset, offset + limit);
    }
    const ids = rows.map((r) => r.partner_id);
    const finalOnly = req.query.final_only === '1' || req.query.final_only === 'true';
    const contracts = ids.length ? await sql.all<any>(
      `SELECT c.partner_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE c.status IN ('Active', 'Expiring')) AS active, COUNT(*) FILTER (WHERE c.status = 'Expiring') AS expiring,
              COALESCE(SUM(COALESCE(${USD('c', 'contract_value_usd')}, ${USD('c', 'contract_value')})) FILTER (WHERE c.status IN ('Active', 'Expiring')), 0) AS value_usd,
              MIN(c.end_date) FILTER (WHERE c.status IN ('Active', 'Expiring')) AS next_end_date
       FROM contracts c WHERE c.organization_id = ? AND c.partner_id = ANY(?)${finalOnly ? ` AND (c.status IN ('Active', 'Expiring') OR c.status_approval IN ('Signed', 'Active'))` : ''} GROUP BY c.partner_id`, org, ids) : [];
    const ios = ids.length ? await sql.all<any>(
      `SELECT i.partner_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE i.status IN ('Active', 'Expiring')) AS active,
              COALESCE(SUM(COALESCE(${USD('i', 'io_value_usd')}, ${USD('i', 'io_value')})) FILTER (WHERE i.status IN ('Active', 'Expiring')), 0) AS value_usd
       FROM insertion_orders i WHERE i.organization_id = ? AND i.partner_id = ANY(?) GROUP BY i.partner_id`, org, ids) : [];
    const spendings = ids.length ? await sql.all<any>(
      `SELECT s.vendor_id AS partner_id, COUNT(*) AS total, COALESCE(SUM(${USD('s', 'total_amount_usd')}), 0) AS total_usd
       FROM spendings s WHERE s.organization_id = ? AND s.vendor_id = ANY(?) GROUP BY s.vendor_id`, org, ids) : [];
    const evaluations = ids.length ? await sql.all<any>(
      `SELECT e.partner_id, COUNT(*) AS total, AVG(e.calculated_score) AS average_score, MAX(e.review_date) AS last_review_date
       FROM evaluations e WHERE e.organization_id = ? AND e.partner_id = ANY(?) GROUP BY e.partner_id`, org, ids) : [];
    const by = (list: any[]) => new Map(list.map((r) => [r.partner_id, r]));
    const c = by(contracts), i = by(ios), s = by(spendings), e = by(evaluations);
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map((p) => ({
      partner_id: p.partner_id, partner_name: p.partner_name, partner_type: p.partner_type ?? null, internal_pic: p.internal_pic ?? null, status_dd: p.status_dd ?? null, country: p.country ?? null,
      contracts: { total: num(c.get(p.partner_id)?.total), active: num(c.get(p.partner_id)?.active), expiring: num(c.get(p.partner_id)?.expiring), valueUsd: num(c.get(p.partner_id)?.value_usd), nextEndDate: c.get(p.partner_id)?.next_end_date ?? null },
      ios: { total: num(i.get(p.partner_id)?.total), active: num(i.get(p.partner_id)?.active), valueUsd: num(i.get(p.partner_id)?.value_usd) },
      spending: { count: num(s.get(p.partner_id)?.total), totalUsd: num(s.get(p.partner_id)?.total_usd) },
      evaluations: { count: num(e.get(p.partner_id)?.total), averageScore: e.get(p.partner_id)?.average_score == null ? null : num(e.get(p.partner_id)?.average_score), lastReviewDate: e.get(p.partner_id)?.last_review_date ?? null },
    })));
  });

  return app;
}
