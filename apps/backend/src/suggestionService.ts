/**
 * Deciding on a review-queue suggestion. Accepting is the only way AI-extracted data becomes a record: the reviewer's edits are
 * validated like any form submission, the obligation (or key term) is written with the suggestion's provenance and the reviewer as
 * `confirmed_by`, and the suggestion is closed, all in one transaction under a row lock (a suggestion is decided at most once).
 */
import type { Sql } from './db';
import { PublicError } from './apiErrors';
import { z } from 'zod';
import { createObligation } from './obligations';
import { obligationCreateBody } from './obligationSchemas';
import { suggestionRepository } from './repositories/suggestionRepository';
import type { Obligation } from './repositories/obligationRepository';

/** What a reviewer may change before accepting. Unknown keys are dropped. */
export const obligationEdits = obligationCreateBody.partial().omit({ contract_id: true, io_id: true, partner_id: true, status: true });
export const keyTermEdits = z.object({ label: z.string().max(120).optional(), value: z.string().max(300).optional(), summary: z.string().max(400).optional() });

export interface Reviewer { id: string | null }
const slug = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'term';

export async function acceptSuggestion(db: Sql, organizationId: string, id: string, reviewer: Reviewer, edits: unknown): Promise<{ kind: 'obligation'; obligation: Obligation } | { kind: 'key_term'; keyTerm: Record<string, any> }> {
  return db.tx(async () => {
    const locked = await suggestionRepository.lockPending(organizationId, id);
    if (!locked) throw new PublicError('Resource not found.', 404, 'RESOURCE_NOT_FOUND');
    if (locked === 'decided') throw new PublicError('This suggestion has already been decided.', 409, 'ALREADY_DECIDED');
    const payload = JSON.parse(locked.payload) as Record<string, any>;
    const now = new Date().toISOString();
    if (locked.kind === 'obligation') {
      const parsed = obligationEdits.safeParse(edits ?? {});
      if (!parsed.success) throw new PublicError(`Invalid edit: ${parsed.error.issues[0]?.path.join('.') || 'body'} ${parsed.error.issues[0]?.message ?? ''}`.trim(), 400, 'VALIDATION_FAILED');
      const fields = { ...payload, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) };
      const party = fields.party === 'us' ? 'Our obligation' : fields.party === 'counterparty' ? 'Counterparty obligation' : fields.party === 'both' ? 'Both parties' : '';
      const obligation = await createObligation(db, organizationId, reviewer.id, {
        title: fields.title, description: [party, fields.description].filter(Boolean).join(': '), type: fields.type, due_date: fields.due_date ?? null,
        recurrence: fields.recurrence ?? 'once', recurrence_interval: fields.recurrence_interval ?? null, recurrence_until: fields.recurrence_until ?? null,
        contract_id: locked.contract_id, responsible_user_id: fields.responsible_user_id ?? null, responsible_department: fields.responsible_department ?? '', lead_days: fields.lead_days ?? null,
      }, { source: 'ai_extracted', source_quote: locked.source_quote || null, source_page: locked.source_page, source_confidence: locked.confidence, confirmed_by: reviewer.id ?? 'unknown', confirmed_at: now });
      await suggestionRepository.markDecided(organizationId, id, 'accepted', reviewer.id, obligation.id);
      return { kind: 'obligation', obligation };
    }
    const parsed = keyTermEdits.safeParse(edits ?? {});
    if (!parsed.success) throw new PublicError(`Invalid edit: ${parsed.error.issues[0]?.path.join('.') || 'body'} ${parsed.error.issues[0]?.message ?? ''}`.trim(), 400, 'VALIDATION_FAILED');
    const fields = { ...payload, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) };
    if (!String(fields.value ?? '').trim()) throw new PublicError('A key term needs a value.', 400, 'VALIDATION_FAILED');
    const termKey = payload.term_key === 'other' ? `other-${slug(String(fields.label || payload.label || 'term'))}` : String(payload.term_key);
    const keyTerm = (await suggestionRepository.upsertKeyTerm(organizationId, locked.contract_id, {
      key: termKey, label: String(fields.label || payload.label || termKey), value: String(fields.value), summary: String(fields.summary ?? ''),
      quote: locked.source_quote || null, page: locked.source_page, confidence: locked.confidence, confirmedBy: reviewer.id,
    }))!;
    await suggestionRepository.markDecided(organizationId, id, 'accepted', reviewer.id, keyTerm.id);
    return { kind: 'key_term', keyTerm };
  });
}

export async function rejectSuggestion(db: Sql, organizationId: string, id: string, reviewer: Reviewer): Promise<void> {
  await db.tx(async () => {
    const locked = await suggestionRepository.lockPending(organizationId, id);
    if (!locked) throw new PublicError('Resource not found.', 404, 'RESOURCE_NOT_FOUND');
    if (locked === 'decided') throw new PublicError('This suggestion has already been decided.', 409, 'ALREADY_DECIDED');
    await suggestionRepository.markDecided(organizationId, id, 'rejected', reviewer.id, null);
  });
}
