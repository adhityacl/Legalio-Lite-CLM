/** Builds the payloads of the domain events and raises them. Payloads carry business identifiers and the fields an integration needs, not internal notes. */
import type { Sql } from './db';
import { emitWebhookEvent } from './webhooks';

const TRACKED_CONTRACT_FIELDS = ['contract_number', 'contract_title', 'partner_id', 'document_type', 'start_date', 'end_date', 'currency', 'contract_value', 'auto_renewal',
  'notice_period_days', 'status_approval', 'internal_pic', 'lifecycle_mode', 'termination_date'] as const;

export const contractSummary = (c: any) => ({
  contractId: c.contract_id, contractNumber: c.contract_number, title: c.contract_title, partnerId: c.partner_id, documentType: c.document_type ?? null,
  status: c.status ?? null, approvalStatus: c.status_approval ?? null, startDate: c.start_date ?? null, endDate: c.end_date ?? null, currency: c.currency ?? null,
  value: c.contract_value ?? null, autoRenewal: Boolean(c.auto_renewal), terminationDate: c.termination_date ?? null, internalPic: c.internal_pic ?? null, version: c.version ?? null,
});

/** Events for one contract write. `before` is null for a creation. Runs in the caller's transaction (as a savepoint) so the outbox rows commit with the change. */
export async function emitContractEvents(db: Sql, before: any | null, after: any, source: 'api' | 'lifecycle' = 'api') {
  const organizationId = after?.organizationId;
  if (!organizationId) return;
  await db.tx(async () => {
    if (!before) {
      await emitWebhookEvent(db, organizationId, 'contract.created', { contract: contractSummary(after) });
    } else {
      const changedFields = TRACKED_CONTRACT_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
      if (changedFields.length) await emitWebhookEvent(db, organizationId, 'contract.updated', { contract: contractSummary(after), changedFields, source });
    }
    const previous = before?.status ?? null;
    if (before && previous !== after.status) {
      await emitWebhookEvent(db, organizationId, 'contract.status_changed', { contractId: after.contract_id, contractNumber: after.contract_number, from: previous, to: after.status, source });
    }
    if (after.status === 'Terminated' && previous !== 'Terminated') {
      await emitWebhookEvent(db, organizationId, 'contract.terminated', { contract: contractSummary(after), terminationDate: after.termination_date ?? null, source });
    }
  });
}
