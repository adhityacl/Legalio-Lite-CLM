/**
 * What department scoping needs to resolve the owner of a record: the partners of the organization (their `internal_pic` names the
 * department), and the contracts and insertion orders that records inherit their owner from. Organization-scope roles never consult
 * it, so they get empty lists and no query.
 */
import type { Sql } from '../db';
import { departmentScope, type OrgContext } from '../rbac';
import { createContractRepository, type ContractDirectoryEntry } from './contractRepository';
import { createPartnerRepository, type PartnerDirectoryEntry } from './partnerRepository';

export interface ScopeCollections { partners: PartnerDirectoryEntry[]; contracts: ContractDirectoryEntry[]; ios: any[] }
export const EMPTY_SCOPE_COLLECTIONS: ScopeCollections = { partners: [], contracts: [], ios: [] };

export async function scopeCollectionsFor(db: Sql, ctx: OrgContext): Promise<ScopeCollections> {
  if (departmentScope(ctx) === null) return EMPTY_SCOPE_COLLECTIONS;
  return {
    partners: await createPartnerRepository(db).directory(ctx.organizationId),
    contracts: await createContractRepository(db).directory(ctx.organizationId),
    ios: [],
  };
}
