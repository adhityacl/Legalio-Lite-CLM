import type { Sql } from './db';
import { keyFromLink, type ObjectStore } from './objectStore';

/** Collections of the in-memory projection that belong to an organization. */
const COLLECTIONS = ['partners', 'contracts', 'ios', 'spendings', 'evaluations', 'notifications', 'templates', 'activityLogs'] as const;

/** Editor documents and approvals live in their own tables; each entry deletes one organization's rows. */
const SQL_STEPS: Array<{ table: string; sql: string }> = [
  { table: 'contract_comments', sql: 'DELETE FROM contract_comments WHERE contract_id IN (SELECT id FROM contract_documents WHERE organization_id = ?)' },
  { table: 'contract_drafts', sql: 'DELETE FROM contract_drafts WHERE contract_id IN (SELECT id FROM contract_documents WHERE organization_id = ?)' },
  { table: 'document_metadata', sql: 'DELETE FROM document_metadata WHERE contract_id IN (SELECT id FROM contract_documents WHERE organization_id = ?)' },
  { table: 'contract_documents', sql: 'DELETE FROM contract_documents WHERE organization_id = ?' },
  { table: 'metadata_fields', sql: 'DELETE FROM metadata_fields WHERE organization_id = ?' },
  { table: 'approval_steps', sql: 'DELETE FROM approval_steps WHERE request_id IN (SELECT id FROM approval_requests WHERE organization_id = ?)' },
  { table: 'approval_events', sql: 'DELETE FROM approval_events WHERE request_id IN (SELECT id FROM approval_requests WHERE organization_id = ?)' },
  { table: 'approval_requests', sql: 'DELETE FROM approval_requests WHERE organization_id = ?' },
];

function collectUploadLinks(value: unknown, found: Set<string>) {
  if (typeof value === 'string') {
    if (value.startsWith('/uploads/')) found.add(value);
  } else if (Array.isArray(value)) {
    value.forEach(item => collectUploadLinks(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectUploadLinks(item, found));
  }
}

export interface OrganizationResetOptions {
  db: Sql;
  /** The in-memory projection (`db` in server.ts). */
  memory: Record<string, any[]>;
  organizationId: string;
  storage: ObjectStore;
  /** Persists the projection to the database. */
  save: () => Promise<void>;
}

/**
 * Empties one organization's business data and nothing else: the organization, its settings, members, departments,
 * invitations and integrations stay. Only upload files that this organization's own records pointed to are removed.
 */
export async function resetOrganizationData(options: OrganizationResetOptions) {
  const { db, memory, organizationId, storage, save } = options;

  const removed: Record<string, number> = {};
  const links = new Set<string>();
  for (const collection of COLLECTIONS) {
    const rows = memory[collection] || [];
    const mine = rows.filter(row => row?.organizationId === organizationId);
    removed[collection] = mine.length;
    mine.forEach(row => collectUploadLinks(row, links));
    memory[collection] = rows.filter(row => row?.organizationId !== organizationId);
  }
  await save();

  await db.tx(async () => {
    for (const step of SQL_STEPS) {
      removed[step.table] = (await db.run(step.sql, organizationId)).changes;
    }
  });

  let files = 0;
  for (const link of links) {
    const key = keyFromLink(link); // null for `..` and other links that could reach another object
    if (!key) continue;
    try {
      await storage.delete(key);
      files++;
    } catch (err) {
      // A file that cannot be removed must not undo a completed reset.
      console.error('[organization reset] Cannot delete upload', key, err);
    }
  }
  return { removed, files };
}
