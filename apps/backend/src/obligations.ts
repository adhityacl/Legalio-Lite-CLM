/**
 * Obligation domain logic shared by the HTTP routes and the review queue (an accepted AI suggestion becomes an obligation through
 * `createObligation`): validation of the combined row, link and responsible-person checks inside the organization, completion with
 * roll-forward of recurring obligations, and the webhook events raised in the same transaction as the write.
 */
import type { Sql } from './db';
import { PublicError } from './apiErrors';
import { nextOccurrence, isIsoDate } from '@legalio/shared/obligations';
import { obligationRepository, type Obligation } from './repositories/obligationRepository';
import { emitWebhookEvent } from './webhooks';
import { obligationSummary } from './webhookEvents';

const invalid = (message: string) => new PublicError(message, 400, 'VALIDATION_FAILED');

/** Provenance of an obligation that came out of the review queue (never accepted from a request body). */
export interface ObligationProvenance {
  source: 'ai_extracted'; source_quote: string | null; source_page: number | null; source_confidence: number | null; confirmed_by: string; confirmed_at: string;
}

/**
 * Makes `row` (stored values merged with a patch) a consistent obligation or throws a 400. Returns the fields to store: recurrence
 * details that do not apply are cleared so the rule is always unambiguous.
 */
export function normalizeObligation(row: Obligation): Obligation {
  const out: Obligation = { ...row };
  out.title = String(out.title ?? '').trim();
  if (!out.title) throw invalid('title is required.');
  out.description = String(out.description ?? '');
  out.responsible_department = String(out.responsible_department ?? '').trim();
  for (const key of ['due_date', 'recurrence_until'] as const) {
    if (out[key] === '' || out[key] === undefined) out[key] = null;
    if (out[key] !== null && !isIsoDate(out[key])) throw invalid(`${key} must be a YYYY-MM-DD date.`);
  }
  out.recurrence = out.recurrence ?? 'once';
  if (out.recurrence === 'once') {
    out.recurrence_interval = null;
    out.recurrence_until = null;
  } else {
    if (!out.due_date) throw invalid('A recurring obligation needs a due date (its next occurrence).');
    if (out.recurrence === 'every_n_days') {
      const n = Number(out.recurrence_interval);
      if (!Number.isInteger(n) || n < 1) throw invalid('recurrence_interval (days) is required for "every N days".');
      out.recurrence_interval = n;
    } else out.recurrence_interval = null;
    if (out.recurrence_until && out.recurrence_until < out.due_date) throw invalid('recurrence_until cannot be before the due date.');
  }
  for (const key of ['contract_id', 'io_id', 'partner_id', 'responsible_user_id'] as const) if (!out[key]) out[key] = null;
  return out;
}

/** The linked records and the responsible person must exist in this organization (404-style errors never reveal other tenants). */
export async function assertLinks(db: Sql, organizationId: string, row: Obligation): Promise<void> {
  const checks: Array<[string, unknown, string]> = [
    ['contract_id', row.contract_id, 'SELECT 1 FROM contracts WHERE organization_id = ? AND contract_id = ?'],
    ['io_id', row.io_id, 'SELECT 1 FROM insertion_orders WHERE organization_id = ? AND io_id = ?'],
    ['partner_id', row.partner_id, 'SELECT 1 FROM partners WHERE organization_id = ? AND partner_id = ?'],
  ];
  for (const [field, value, query] of checks) {
    if (value && !(await db.get(query, organizationId, value))) throw invalid(`${field} does not refer to a record of this organization.`);
  }
  if (row.responsible_user_id) {
    const member = await db.get(`SELECT 1 FROM member WHERE "organizationId" = ? AND "userId" = ? AND status = 'active'`, organizationId, row.responsible_user_id);
    if (!member) throw invalid('responsible_user_id must be an active member of this organization.');
  }
}

/**
 * Marks the obligation done. A recurring one records the completion and moves its due date to the following occurrence (status back to
 * open) unless its rule has ended. Returns the patch to store plus what the `obligation.completed` event reports.
 */
export function completionPatch(row: Obligation, actorId: string | null, now = new Date()) {
  const completedAt = now.toISOString();
  const next = row.recurrence !== 'once' && row.due_date
    ? nextOccurrence(row.due_date, { recurrence: row.recurrence, interval: row.recurrence_interval, until: row.recurrence_until })
    : null;
  return {
    patch: {
      completed_at: completedAt, completed_by: actorId, completions: Number(row.completions ?? 0) + 1,
      status: next ? 'open' : 'done', ...(next ? { due_date: next } : {}),
    } as Obligation,
    completedDueDate: row.due_date as string | null,
    nextDueDate: next,
  };
}

export async function createObligation(
  db: Sql, organizationId: string, actorId: string | null, input: Obligation, provenance?: ObligationProvenance,
): Promise<Obligation> {
  const row = normalizeObligation({ status: 'open', type: 'other', ...input, ...(provenance ?? { source: 'manual' }) });
  return db.tx(async () => {
    await assertLinks(db, organizationId, row);
    // Created already done: nothing to roll, but the completion is recorded.
    if (row.status === 'done') Object.assign(row, { completed_at: new Date().toISOString(), completed_by: actorId, completions: 1 });
    const created = await obligationRepository.insert(organizationId, row, actorId);
    await emitWebhookEvent(db, organizationId, 'obligation.created', { obligation: obligationSummary(created) });
    return created;
  });
}

/** Edit with the version the caller read. A change to `done` of a recurring obligation completes the occurrence and rolls forward. */
export async function updateObligation(db: Sql, organizationId: string, id: string, expectedVersion: number, patch: Obligation, actorId: string | null): Promise<Obligation> {
  return db.tx(async () => {
    const current = await obligationRepository.get(organizationId, id);
    if (!current) throw new PublicError('Resource not found.', 404, 'RESOURCE_NOT_FOUND');
    const merged = normalizeObligation({ ...current, ...stripUndefined(patch) });
    await assertLinks(db, organizationId, merged);
    let completed: ReturnType<typeof completionPatch> | null = null;
    if (merged.status === 'done' && current.status !== 'done') {
      completed = completionPatch(merged, actorId);
      Object.assign(merged, completed.patch);
    } else if (merged.status !== 'done' && current.status === 'done') {
      // Re-opened by hand: the completion stamp no longer applies.
      Object.assign(merged, { completed_at: null, completed_by: null });
    }
    const updated = await obligationRepository.update(organizationId, id, merged, expectedVersion);
    if (completed) await emitCompleted(db, organizationId, updated, completed, actorId);
    return updated;
  });
}

/** The "Mark done" action: same effect as editing the status to done, without needing the other fields. */
export async function completeObligation(db: Sql, organizationId: string, id: string, actorId: string | null, expectedVersion?: number): Promise<Obligation> {
  return db.tx(async () => {
    const current = await obligationRepository.get(organizationId, id);
    if (!current) throw new PublicError('Resource not found.', 404, 'RESOURCE_NOT_FOUND');
    if (current.status === 'done' || current.status === 'waived') throw new PublicError('This obligation is already closed.', 409, 'ALREADY_CLOSED');
    const completed = completionPatch(current, actorId);
    // Without a version the completion applies to the row as it is now (a locked read-modify-write), never to a stale copy.
    const updated = expectedVersion !== undefined
      ? await obligationRepository.update(organizationId, id, completed.patch, expectedVersion)
      : (await obligationRepository.mutate(organizationId, id, (row) => completionPatch(row, actorId).patch))!;
    await emitCompleted(db, organizationId, updated, completed, actorId);
    return updated;
  });
}

async function emitCompleted(db: Sql, organizationId: string, updated: Obligation, completed: ReturnType<typeof completionPatch>, actorId: string | null) {
  await emitWebhookEvent(db, organizationId, 'obligation.completed', {
    obligation: obligationSummary(updated), completedDueDate: completed.completedDueDate, nextDueDate: completed.nextDueDate, completedBy: actorId,
  });
}

const stripUndefined = (value: Obligation) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
