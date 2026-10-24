import { sql } from './db';
import { ENTITIES } from './normalizedSchema';

/**
 * Does the organization own any business record (partners, contracts, orders, spendings, evaluations, notifications, templates)?
 * Repository-backed tables are asked directly; the rest is looked up in the in-memory projection `memory`.
 */
export async function organizationOwnsBusinessData(memory: Record<string, any>, organizationId: string): Promise<boolean> {
  for (const entity of ENTITIES) {
    if (entity.appendOnly) continue;
    if (entity.repository) {
      if (await sql.get(`SELECT 1 FROM "${entity.table}" WHERE organization_id = ? LIMIT 1`, organizationId)) return true;
    } else if ((memory[entity.collection] || []).some((row: any) => row?.organizationId === organizationId)) return true;
  }
  return false;
}
