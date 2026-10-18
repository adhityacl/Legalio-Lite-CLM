/**
 * Department ownership of operational records (tenant-boundaries PRD §4.4, §4.5.3).
 *
 * Legacy records name their department in `internal_pic` (partner) and
 * inherit it through their governing partner/contract. The owning
 * department is the team in the SAME organization whose name matches
 * exactly after trimming, collapsing whitespace and case folding — never a
 * substring or fuzzy match. A record without a verifiable department is
 * visible only to organization-scope contexts (tenant admin / platform).
 */
import type Database from 'better-sqlite3';
import { departmentScope, type OrgContext } from './rbac';

export type RecordKind = 'partner' | 'contract' | 'io' | 'spending' | 'evaluation' | 'notification';

export const normalizeDepartmentName = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

export interface RecordCollections {
  partners: any[];
  contracts: any[];
  ios: any[];
}

/** Request-local resolver for one organization. Build once per request; it memoizes lookups. */
export function createOrganizationScope(db: Database.Database, organizationId: string, collections: RecordCollections) {
  const teams = db.prepare(`SELECT id, name FROM team WHERE organizationId = ?`).all(organizationId) as Array<{ id: string; name: string }>;
  const teamByName = new Map<string, string | null>();
  for (const team of teams) {
    const key = normalizeDepartmentName(team.name);
    // Ambiguous duplicates resolve to nothing rather than to whichever came first.
    teamByName.set(key, teamByName.has(key) ? null : team.id);
  }
  const owned = (row: any) => row && row.organizationId === organizationId;
  const partners = collections.partners.filter(owned);
  const contracts = collections.contracts.filter(owned);
  const ios = collections.ios.filter(owned);
  const partnerById = new Map(partners.filter((p) => p.partner_id).map((p) => [p.partner_id, p]));
  const partnerByName = new Map(partners.filter((p) => p.partner_name).map((p) => [lower(p.partner_name), p]));
  const contractById = new Map(contracts.filter((c) => c.contract_id).map((c) => [c.contract_id, c]));
  const ioById = new Map(ios.filter((i) => i.io_id).map((i) => [i.io_id, i]));

  const teamOf = (name: unknown): string | null => {
    const key = normalizeDepartmentName(name);
    return key ? teamByName.get(key) ?? null : null;
  };
  const partnerFor = (id: unknown, name: unknown) =>
    (id ? partnerById.get(String(id)) : undefined) || (name ? partnerByName.get(lower(name)) : undefined);
  const partnerDepartment = (partner: any): string | null => (partner ? teamOf(partner.internal_pic) : null);

  function contractDepartment(contract: any): string | null {
    const partner = partnerFor(contract.partner_id, contract.partner_name);
    return partnerDepartment(partner) ?? teamOf(contract.internal_pic);
  }

  function departmentOf(kind: RecordKind, record: any): string | null {
    if (!record) return null;
    switch (kind) {
      case 'partner':
        return partnerDepartment(record);
      case 'contract':
        return contractDepartment(record);
      case 'io': {
        const partner = partnerFor(record.partner_id, record.partner_name);
        if (partner) return partnerDepartment(partner);
        const contract = record.contract_id ? contractById.get(record.contract_id) : undefined;
        return contract ? contractDepartment(contract) : null;
      }
      case 'spending':
        return partnerDepartment(partnerFor(record.vendor_id || record.partner_id, record.vendor_name || record.partner_name));
      case 'evaluation':
        return partnerDepartment(partnerFor(record.partner_id || record.supplier_id, record.supplier_name));
      case 'notification': {
        const contract = record.parent_id ? contractById.get(record.parent_id) : undefined;
        if (contract) return contractDepartment(contract);
        const io = record.parent_id ? ioById.get(record.parent_id) : undefined;
        return io ? departmentOf('io', io) : null;
      }
    }
  }

  return { organizationId, teamOf, departmentOf };
}

export type OrganizationScope = ReturnType<typeof createOrganizationScope>;

/** True when the record belongs to the context's organization and (for department roles) one of its departments. */
export function recordVisible(ctx: OrgContext, scope: OrganizationScope, kind: RecordKind, record: any): boolean {
  if (!record || record.organizationId !== ctx.organizationId) return false;
  const departments = departmentScope(ctx);
  if (departments === null) return true;
  const owner = scope.departmentOf(kind, record);
  return Boolean(owner) && departments.includes(owner as string);
}

export function filterRecords<T>(ctx: OrgContext, scope: OrganizationScope, kind: RecordKind, rows: T[] | undefined): T[] {
  return (rows || []).filter((row) => recordVisible(ctx, scope, kind, row));
}
