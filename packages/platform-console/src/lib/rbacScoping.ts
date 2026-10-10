import { Partner, Contract, InsertionOrder, PartnerSpending, UserSession } from '@legalio/types';

/**
 * Client-side record helpers (tenant-boundaries PRD §4.5, §11.1).
 *
 * The server already returns only records in the caller's organization and
 * department scope (exact canonical department ownership), so these helpers
 * never re-derive scope from display names or fuzzy department matching.
 * They only keep the existing per-role UI rules (e.g. viewers see final
 * contracts only) on top of the scoped data. Role comes from the verified
 * capability context of the selected organization.
 */
export type StandardRole = 'superuser' | 'admin' | 'manager' | 'editor' | 'viewer';

/**
 * Normalizes a capability-derived role label. Unknown values are the least
 * privileged role. `superuser` here means explicit platform management of the
 * selected organization, never a tenant role.
 */
export function normalizeRole(role?: string): StandardRole {
  const r = (role || '').toLowerCase().trim();
  if (r === 'superuser' || r === 'admin' || r === 'manager' || r === 'editor' || r === 'viewer') return r;
  return 'viewer';
}

/** Organization-wide scope in the selected organization (tenant admin or platform management). */
export function isGlobalRole(role?: string): boolean {
  const norm = normalizeRole(role);
  return norm === 'admin' || norm === 'superuser';
}

const writable = (user: UserSession | null) => Boolean(user) && normalizeRole(user!.role) !== 'viewer';

/** Records arrive pre-scoped; any record the server returned is visible. */
export function canViewPartner(_partner: Partner, user: UserSession | null): boolean {
  return Boolean(user);
}

export function canEditPartner(_partner: Partner, user: UserSession | null): boolean {
  return writable(user);
}

export function canCreatePartner(user: UserSession | null): boolean {
  return writable(user);
}

/** Partner deletion cascades to contracts and IOs; kept to organization-scope roles as before. */
export function canDeletePartner(user: UserSession | null): boolean {
  return Boolean(user) && isGlobalRole(user!.role);
}

/** Viewers only see final contracts (existing product rule), within their scoped data. */
export function canViewContract(contract: Contract, _partners: Partner[], user: UserSession | null): boolean {
  if (!user) return false;
  if (normalizeRole(user.role) !== 'viewer') return true;
  return (
    contract.status === 'Active' ||
    contract.status === 'Expiring' ||
    contract.status_approval === 'Signed' ||
    contract.status_approval === 'Active'
  );
}

export function canEditContract(_contract: Contract, _partners: Partner[], user: UserSession | null): boolean {
  return writable(user);
}

export function canCreateContract(user: UserSession | null): boolean {
  return writable(user);
}

export function canViewIO(_io: InsertionOrder, _partners: Partner[], user: UserSession | null): boolean {
  return Boolean(user);
}

export function canEditIO(_io: InsertionOrder, _partners: Partner[], user: UserSession | null): boolean {
  return writable(user);
}

export function canCreateIO(user: UserSession | null): boolean {
  return writable(user);
}

export function getApprovalCapabilities(user: UserSession | null): {
  canInternalApprove: boolean;
  canFinalApprove: boolean;
} {
  if (!user) return { canInternalApprove: false, canFinalApprove: false };
  const role = normalizeRole(user.role);
  if (role === 'admin' || role === 'superuser') return { canInternalApprove: true, canFinalApprove: true };
  if (role === 'manager') return { canInternalApprove: true, canFinalApprove: false };
  return { canInternalApprove: false, canFinalApprove: false };
}

export function canViewSpending(_spending: PartnerSpending, _partners: Partner[], user: UserSession | null): boolean {
  return Boolean(user);
}

export function canEditSpending(_spending: PartnerSpending, _partners: Partner[], user: UserSession | null): boolean {
  return writable(user);
}
