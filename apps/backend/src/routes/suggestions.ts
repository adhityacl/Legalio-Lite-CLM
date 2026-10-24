/**
 * AI extraction and its review queue. Extraction (`POST /api/contracts/:id/extract`) only ever creates pending suggestions; accepting one
 * (a person's decision, with optional edits) creates the obligation or key term. Everything is tenant-scoped, department roles reach only
 * the suggestions of contracts their departments own, and the extraction goes through the shared AI wrapper (per-organization budget).
 */
import crypto from 'node:crypto';
import express from 'express';
import { sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { PublicError, sendApiError } from '../apiErrors';
import { upload } from '../uploadMiddleware';
import { ensureAiAvailable } from '../aiClient';
import { aiPolicyContext } from '../tenantPolicy';
import { hasOrganizationScope } from '../rbac';
import { recordVisible } from '../recordScope';
import { assertRecordWritable, getRequestTenantId, logActivity, orgContextOf, scopeCollectionsOf, scopeOf } from '../recordAccess';
import { contractRepository } from '../repositories/contractRepository';
import { presentSuggestion, suggestionRepository } from '../repositories/suggestionRepository';
import { organizationToday } from './obligations';
import { extractFromPages } from '../contractExtraction';
import { pagesFromBuffer, pagesFromText, storedContractPages } from '../contractDocumentText';
import { acceptSuggestion, rejectSuggestion } from '../suggestionService';
import { componentLog } from '../logger';

const log = componentLog('suggestions');
const queryText = (value: unknown, max = 100) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function createSuggestionsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

  const actorId = (req: express.Request): string | null => (req as any).identity?.userId ?? orgContextOf(req).userId ?? null;
  const notFound = (req: express.Request, res: express.Response) => sendApiError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  /** The contract a suggestion belongs to must be one the caller may see. */
  const contractVisible = (req: express.Request, contract: any) => recordVisible(orgContextOf(req), scopeOf(req), 'contract', contract);
  /** Contract ids a department role may reach (null: the whole organization). */
  const reachableContracts = (req: express.Request): string[] | null => {
    if (hasOrganizationScope(orgContextOf(req))) return null;
    return scopeCollectionsOf(req).contracts.filter((c: any) => recordVisible(orgContextOf(req), scopeOf(req), 'contract', c)).map((c: any) => c.contract_id);
  };

  /**
   * Reads the contract's document (an uploaded file, pasted text, or the file stored with the contract), asks the model for obligations,
   * key dates and key clauses, and queues them for review. Nothing becomes a record here.
   */
  app.post('/api/contracts/:id/extract', upload.single('file') as any, async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const contract = await contractRepository.get(organizationId, req.params.id);
    if (!contract || !contractVisible(req, contract)) return notFound(req, res);
    const denied = assertRecordWritable(req, 'contract', contract);
    if (denied) return res.status(denied.status).json(denied.body);

    // The document first (cheap, local) so a bad request does not use up the organization's AI budget.
    let pages; let sourceName: string | null = null;
    if (req.file?.buffer) {
      ({ pages } = await pagesFromBuffer(req.file.buffer));
      sourceName = req.file.originalname ? String(req.file.originalname).slice(0, 200) : null;
    } else if (typeof req.body?.text === 'string' && req.body.text.trim()) {
      pages = pagesFromText(req.body.text);
      sourceName = 'pasted text';
    } else {
      ({ pages, sourceName } = await storedContractPages(contract));
    }
    if (!pages.length) throw new PublicError('The document has no readable text to analyse.', 422, 'NO_DOCUMENT_TEXT');

    if (!(await ensureAiAvailable(req, res))) return;
    const context = aiPolicyContext(organizationId);
    const result = await extractFromPages(pages, { organizationName: context.organizationName, countryName: context.countryName, responseLanguage: context.responseLanguage, today: organizationToday(organizationId) },
      { model: typeof req.body?.model === 'string' ? req.body.model : undefined });
    const extractionId = `ext-${crypto.randomUUID()}`;
    const drafts = [...result.obligations, ...result.keyTerms];
    const saved = await suggestionRepository.insertMany(organizationId, contract.contract_id, extractionId, drafts, { createdBy: actorId(req), sourceName, model: result.model });
    await logActivity(req, 'AI_EXTRACT', 'OBLIGATIONS', `AI extraction for ${contract.contract_number}: ${saved.created.length} suggestion(s) queued for review${saved.duplicates ? `, ${saved.duplicates} already known` : ''}`);
    log.info(`Extraction ${extractionId} for ${organizationId}/${contract.contract_id}: ${saved.created.length} queued, ${saved.duplicates} duplicates, ${result.dropped} dropped`);
    res.json({
      success: true, extractionId, created: saved.created.length, duplicates: saved.duplicates, dropped: result.dropped, truncated: result.truncated,
      unverifiedQuotes: drafts.filter((d) => d.quote_verified === false).length,
      suggestions: (await suggestionRepository.getMany(organizationId, saved.created)).map(presentSuggestion),
    });
  });

  app.get('/api/suggestions', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const status = queryText(req.query.status, 20);
    const kind = queryText(req.query.kind, 20);
    const result = await suggestionRepository.list(organizationId, {
      status: ['pending', 'accepted', 'rejected'].includes(status) ? status : undefined, kind: ['obligation', 'key_term'].includes(kind) ? kind : undefined,
      contractId: queryText(req.query.contract_id) || undefined, contractIds: reachableContracts(req) ?? undefined,
      limit: Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit)) || 50)), offset: Math.max(0, Math.trunc(Number(req.query.offset)) || 0),
    });
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.json(result.rows.map(presentSuggestion));
  });

  app.get('/api/suggestions/summary', async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await suggestionRepository.pendingCounts(getRequestTenantId(req), reachableContracts(req) ?? undefined));
  });

  const decide = async (req: express.Request, res: express.Response, accept: boolean) => {
    const organizationId = getRequestTenantId(req);
    const row = await suggestionRepository.get(organizationId, req.params.id);
    const contract = row ? await contractRepository.get(organizationId, row.contract_id) : undefined;
    if (!row || !contract || !contractVisible(req, contract)) return notFound(req, res);
    const denied = assertRecordWritable(req, 'contract', contract);
    if (denied) return res.status(denied.status).json(denied.body);
    const reviewer = { id: actorId(req) };
    if (accept) {
      const outcome = await acceptSuggestion(sql, organizationId, row.id, reviewer, req.body?.edits);
      await logActivity(req, 'SUGGESTION_ACCEPT', 'OBLIGATIONS', outcome.kind === 'obligation'
        ? `Accepted AI suggestion: obligation '${outcome.obligation.title}' for ${contract.contract_number}` : `Accepted AI suggestion: key term '${outcome.keyTerm.label}' for ${contract.contract_number}`);
      return res.json({ success: true, ...outcome });
    }
    await rejectSuggestion(sql, organizationId, row.id, reviewer);
    await logActivity(req, 'SUGGESTION_REJECT', 'OBLIGATIONS', `Rejected an AI suggestion for ${contract.contract_number}`);
    res.json({ success: true });
  };
  app.post('/api/suggestions/:id/accept', (req, res) => decide(req, res, true));
  app.post('/api/suggestions/:id/reject', (req, res) => decide(req, res, false));

  /** Key clauses a person accepted from a suggestion, with their source quote and page. */
  app.get('/api/contracts/:id/key-terms', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const contract = await contractRepository.get(organizationId, req.params.id);
    if (!contract || !contractVisible(req, contract)) return notFound(req, res);
    const rows = await suggestionRepository.listKeyTerms(organizationId, contract.contract_id);
    res.json(rows.map(({ organization_id, ...rest }: any) => ({ ...rest, organizationId: organization_id, source_page: rest.source_page == null ? null : Number(rest.source_page), source_confidence: rest.source_confidence == null ? null : Number(rest.source_confidence) })));
  });

  app.delete('/api/contracts/:id/key-terms/:termKey', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const contract = await contractRepository.get(organizationId, req.params.id);
    if (!contract || !contractVisible(req, contract)) return notFound(req, res);
    const denied = assertRecordWritable(req, 'contract', contract);
    if (denied) return res.status(denied.status).json(denied.body);
    if (!(await suggestionRepository.removeKeyTerm(organizationId, contract.contract_id, req.params.termKey))) return notFound(req, res);
    await logActivity(req, 'KEY_TERM_DELETE', 'OBLIGATIONS', `Removed key term '${req.params.termKey}' of ${contract.contract_number}`);
    res.json({ success: true });
  });

  return app;
}
