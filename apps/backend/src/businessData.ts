import { sql } from './db';
import { ENTITIES } from './normalizedSchema';

/** Does the organization own any business record (partners, contracts, orders, spendings, evaluations, notifications, templates)? */
export async function organizationOwnsBusinessData(organizationId: string): Promise<boolean> {
  for (const entity of ENTITIES) {
    if (entity.appendOnly) continue;
    if (await sql.get(`SELECT 1 FROM "${entity.table}" WHERE organization_id = ? LIMIT 1`, organizationId)) return true;
  }
  return false;
}

/** Is there any business record at all (an installation that was reset empty still counts as initialized by its organizations, not by this)? */
export async function anyBusinessData(): Promise<boolean> {
  for (const entity of ENTITIES) {
    if (entity.appendOnly) continue;
    if (await sql.get(`SELECT 1 FROM "${entity.table}" LIMIT 1`)) return true;
  }
  return false;
}
