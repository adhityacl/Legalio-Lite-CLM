/**
 * Clause library and playbook check. The library is the organization's reference data (approved wording, fallbacks, the rules the playbook
 * checks), tenant-scoped like everything else: reading needs `document.view`, writing `document.edit`, deleting `document.delete`, importing the
 * starter set (an explicit per-organization opt-in) `tenant.settings.update`. The list answers a bare array with `X-Total-Count`.
 *
 * `POST /api/playbook/check` compares a contract (text from the editor, or a contract the caller may see) with the active clauses:
 * deterministic rules first, then, only when asked, the AI semantic check (through the shared wrapper and the organization's AI budget).
 * It never writes anything; the result is advisory.
 */
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { PublicError, sendApiError } from '../apiErrors';
import { validateBody } from '../validation';
import { requestedVersion } from '../requestVersion';
import { recordVisible } from '../recordScope';
import { getRequestTenantId, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { ensureAiAvailable } from '../aiClient';
import { aiPolicyContext, getTenantSettings } from '../tenantPolicy';
import { getIndustryPack } from '@legalio/shared/policy';
import { BASELINE_STARTER_CLAUSES, packStarterClauses, type StarterClause } from '@legalio/shared/clauseStarter';
import { RISK_LEVELS, type RiskLevel } from '@legalio/shared/playbook';
import { CLAUSE_SORTS, clauseRepository, presentClause, toPlaybookClause, type ClauseQuery } from '../repositories/clauseRepository';
import { contractRepository } from '../repositories/contractRepository';
import { storedContractPages } from '../contractDocumentText';
import { checkDeterministic, semanticCheck, summarize } from '../playbookCheck';
import * as schemas from '../clauseSchemas';

const queryText = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Baseline plus the clauses of the organization's industry pack. */
export function starterSet(organizationId: string): Array<StarterClause & { source: 'baseline' | 'industry' }> {
  const industry = getIndustryPack(getTenantSettings(organizationId).industry);
  return [
    ...BASELINE_STARTER_CLAUSES.map((c) => ({ ...c, source: 'baseline' as const })),
    ...packStarterClauses(industry.key, industry.criticalClauses).map((c) => ({ ...c, source: 'industry' as const })),
  ];
}

export function createClausesRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

  const actorId = (req: express.Request): string | null => (req as any).identity?.userId ?? orgContextOf(req).userId ?? null;
  const notFound = (req: express.Request, res: express.Response) => sendApiError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');

  app.get('/api/clauses', async (req: express.Request, res: express.Response) => {
    const q = req.query;
    const sort = queryText(q.sort, 30);
    const risk = queryText(q.risk, 100).split(',').map((v) => v.trim()).filter((v): v is RiskLevel => (RISK_LEVELS as readonly string[]).includes(v));
    const status = queryText(q.status, 20);
    const query: ClauseQuery = {
      q: queryText(q.q) || undefined, category: queryText(q.category, 120) || undefined, risk: risk.length ? risk : undefined,
      language: queryText(q.language, 5) || undefined, jurisdiction: queryText(q.jurisdiction, 120) || undefined, tag: queryText(q.tag, 60) || undefined,
      status: status === 'archived' ? 'archived' : status === 'all' ? undefined : 'active',
      sort: (CLAUSE_SORTS as readonly string[]).includes(sort) ? sort as ClauseQuery['sort'] : 'title',
      dir: queryText(q.dir, 4).toLowerCase() === 'desc' ? 'desc' : 'asc',
      limit: Math.min(500, Math.max(1, Math.trunc(Number(q.limit)) || 50)), offset: Math.max(0, Math.trunc(Number(q.offset)) || 0),
    };
    const { rows, total } = await clauseRepository.list(getRequestTenantId(req), query);
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.json(rows.map(presentClause));
  });

  app.get('/api/clauses/facets', async (req: express.Request, res: express.Response) => {
    res.json(await clauseRepository.facets(getRequestTenantId(req)));
  });

  /** The starter set the organization may import, with what it already has. */
  app.get('/api/clauses/starter', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const have = await clauseRepository.starterKeys(organizationId);
    res.json(starterSet(organizationId).map((c) => ({
      starter_key: c.starter_key, title: c.title, category: c.category, risk_level: c.risk_level, source: c.source, guidance: c.guidance,
      has_wording: Boolean(c.approved_text), imported: have.has(c.starter_key),
    })));
  });

  /** Opt-in import: adds the starter clauses (all, or the listed keys) that the organization does not have yet; never touches an existing clause. */
  app.post('/api/clauses/starter/import', validateBody(schemas.starterImportBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const wanted = req.body.keys ? new Set<string>(req.body.keys) : null;
    const starters = starterSet(organizationId).filter((c) => !wanted || wanted.has(c.starter_key));
    const { created, skipped } = await clauseRepository.importStarters(organizationId, starters, actorId(req));
    await logActivity(req, 'CLAUSE_IMPORT_STARTER', 'CLAUSES', `Imported ${created.length} starter clause(s)${skipped ? `, ${skipped} already present` : ''}`);
    res.status(created.length ? 201 : 200).json({ success: true, created: created.length, skipped, clauses: created.map(presentClause) });
  });

  app.get('/api/clauses/:id', async (req: express.Request, res: express.Response) => {
    const row = await clauseRepository.get(getRequestTenantId(req), req.params.id);
    if (!row) return notFound(req, res);
    res.json(presentClause(row));
  });

  app.post('/api/clauses', validateBody(schemas.clauseCreateBody), async (req: express.Request, res: express.Response) => {
    const row = await clauseRepository.insert(getRequestTenantId(req), req.body, actorId(req));
    await logActivity(req, 'CLAUSE_CREATE', 'CLAUSES', `Created clause '${row.title}'`);
    res.status(201).json({ success: true, clause: presentClause(row) });
  });

  app.put('/api/clauses/:id', validateBody(schemas.clauseUpdateBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const existing = await clauseRepository.get(organizationId, req.params.id);
    if (!existing) return notFound(req, res);
    const { version: clientVersion, ...patch } = req.body;
    const expected = requestedVersion(req, clientVersion) ?? Number(existing.version);
    const row = await clauseRepository.update(organizationId, req.params.id, patch, expected);
    await logActivity(req, 'CLAUSE_UPDATE', 'CLAUSES', `Updated clause '${row.title}' (v${row.version})`);
    res.json({ success: true, clause: presentClause(row) });
  });

  app.delete('/api/clauses/:id', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const existing = await clauseRepository.get(organizationId, req.params.id);
    if (!existing) return notFound(req, res);
    await clauseRepository.remove(organizationId, req.params.id);
    await logActivity(req, 'CLAUSE_DELETE', 'CLAUSES', `Deleted clause '${existing.title}'`);
    res.json({ success: true });
  });

  /**
   * Playbook check. `text` is the editor document (plain text) or the pasted/uploaded text; `contract_id` reads the file stored with a
   * contract the caller may see. `ai: true` adds the semantic check (needs the AI assistant to be on and consumes the AI budget).
   */
  app.post('/api/playbook/check', validateBody(schemas.playbookCheckBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    let text = String(req.body.text ?? '');
    let source = 'text';
    if (!text.trim()) {
      const contract = await contractRepository.get(organizationId, req.body.contract_id);
      if (!contract || !recordVisible(orgContextOf(req), scopeOf(req), 'contract', contract)) return notFound(req, res);
      const stored = await storedContractPages(contract);
      text = stored.pages.map((p) => p.text).join('\n\n');
      source = `contract:${contract.contract_id}`;
    }
    if (!text.trim()) throw new PublicError('The document has no readable text to check.', 422, 'NO_DOCUMENT_TEXT');
    const rows = await clauseRepository.listActive(organizationId, req.body.clause_ids);
    if (!rows.length) throw new PublicError('The clause library has no active clauses to check against. Add clauses or import the starter set.', 422, 'EMPTY_LIBRARY');
    const clauses = rows.map(toPlaybookClause);

    const result = checkDeterministic(text, clauses);
    const ai: { requested: boolean; ran: boolean; model: string | null; dropped: number; error: string | null } = { requested: Boolean(req.body.ai), ran: false, model: null, dropped: 0, error: null };
    if (req.body.ai) {
      if (!(await ensureAiAvailable(req, res))) return;
      try {
        const context = aiPolicyContext(organizationId);
        const semantic = await semanticCheck(text, clauses, { organizationName: context.organizationName, countryName: context.countryName, responseLanguage: context.responseLanguage }, result.findings);
        result.findings.push(...semantic.findings);
        result.summary = summarize(result.findings, clauses.length);
        Object.assign(ai, { ran: true, model: semantic.model, dropped: semantic.dropped });
      } catch (err: any) {
        // The deterministic result is still good: report the AI problem next to it instead of failing the whole check.
        ai.error = String(err?.message || 'The AI check failed.').slice(0, 300);
      }
    }
    await logActivity(req, 'PLAYBOOK_CHECK', 'CLAUSES', `Playbook check (${source}): ${result.summary.total} finding(s) against ${clauses.length} clause(s)${ai.ran ? ', with AI check' : ''}`);
    res.json({ success: true, ...result, ai, checked_at: new Date().toISOString() });
  });

  return app;
}
