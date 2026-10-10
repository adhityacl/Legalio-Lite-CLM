/**
 * 002_tenant_boundaries — legacy role/settings/ownership migration
 * (tenant-boundaries PRD §14).
 *
 * analyze() is read-only and produces a redacted report with deterministic
 * conflict IDs. applyMigration() requires every blocking conflict to carry a
 * reviewed resolution from a mapping file, re-checks the source digest inside
 * its single write transaction, and records the ledger entry last. Nothing is
 * guessed: no first/default organization, no fuzzy department matching, no
 * copying global recipients to every tenant.
 *
 * Dependency-light on purpose: it never imports the auth module or the server,
 * so a dry-run cannot initialize schema or start jobs.
 */
import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { legacyMembershipRole, legacyPlatformRole, isMembershipStatus, isPlatformRole, isTenantRole, type MembershipStatus, type PlatformRole, type TenantRole } from '../rbac';
import { normalizeDepartmentName } from '../recordScope';
import {
  TENANT_BOUNDARIES_MIGRATION_ID, defaultSettingsPayload, ensureTenantBoundarySchema, markMigrationApplied,
  validateNotificationsPatch, validatePolicyPatch, validateProfilePatch, writeIntegrationRow, writeSettingsRow,
  type OrganizationSettingsPayload,
} from '../organizationSettingsStore';
import { resolveTenantSettings } from '@legalio/shared/policy';

type DB = Database.Database;

export const LEGACY_ORGANIZATION_ALIASES = new Set(['org-adapundi', 'tenant-adapundi']);
const BUSINESS_TABLES = ['partners', 'contracts', 'insertion_orders', 'notifications', 'evaluations', 'spendings', 'templates', 'activity_logs'] as const;
const RESOURCE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export type ResolutionKind = 'map-organization' | 'set-platform-role' | 'set-membership' | 'choose-source' | 'set-settings-field' | 'quarantine-resource';

export interface Conflict {
  conflictId: string;
  kind: string;
  blocking: boolean;
  /** Redacted references: table + IDs, never emails, names or secret values. */
  references: string[];
  resolutionKinds: ResolutionKind[];
  /** Options for `choose-source`. */
  sourceRefs?: string[];
  detail?: Record<string, unknown>;
}

export type Resolution =
  | { conflictId: string; decision: 'map-organization'; organizationId: string }
  | { conflictId: string; decision: 'set-platform-role'; userId: string; platformRole: PlatformRole }
  | { conflictId: string; decision: 'set-membership'; userId: string; organizationId: string; tenantRole: TenantRole; status: MembershipStatus; departmentIds: string[]; survivingMembershipId: string | null }
  | { conflictId: string; decision: 'choose-source'; sourceRef: string }
  | { conflictId: string; decision: 'set-settings-field'; organizationId: string; fieldPath: string; value: unknown }
  | { conflictId: string; decision: 'quarantine-resource' };

export interface MigrationMapping {
  formatVersion: 1;
  migrationId: typeof TENANT_BOUNDARIES_MIGRATION_ID;
  sourceDigest: string;
  resolutions: Resolution[];
}

export interface MigrationReport {
  formatVersion: 1;
  migrationId: string;
  sourceDigest: string;
  alreadyApplied: boolean;
  schema: { tables: string[]; memberStatusColumn: boolean };
  counts: Record<string, unknown>;
  conflicts: Conflict[];
  warnings: string[];
  plannedChanges: Record<string, number>;
  applied: boolean;
  appliedChanges?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                         */
/* ------------------------------------------------------------------ */

const tables = (db: DB) => (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as any[]).map((r) => r.name as string);
const hasTable = (db: DB, name: string) => tables(db).includes(name);
const columns = (db: DB, table: string) => (db.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((c) => c.name as string);
const all = (db: DB, sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as any[];
const parseJson = (raw: unknown): any => { try { return raw ? JSON.parse(String(raw)) : null; } catch { return null; } };
const conflictId = (kind: string, ...parts: unknown[]) =>
  `${kind}:${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)}`;

/** Deterministic digest of everything the migration reads. Never exposed beyond the hash. */
export function sourceDigest(db: DB): string {
  const hash = crypto.createHash('sha256');
  const feed = (label: string, rows: unknown) => hash.update(label).update(JSON.stringify(rows));
  feed('schema', all(db, `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`));
  feed('user', all(db, `SELECT id, role, banned FROM "user" ORDER BY id`));
  const memberCols = columns(db, 'member');
  feed('member', all(db, `SELECT id, organizationId, userId, role, createdAt${memberCols.includes('status') ? ', status' : ''} FROM member ORDER BY id`));
  feed('team', all(db, `SELECT id, organizationId, name FROM team ORDER BY id`));
  feed('teamMember', all(db, `SELECT id, teamId, userId FROM teamMember ORDER BY id`));
  feed('organization', all(db, `SELECT id, name, slug, logo, metadata FROM organization ORDER BY id`));
  if (hasTable(db, 'tenants')) feed('tenants', all(db, `SELECT id, payload FROM tenants ORDER BY id`));
  if (hasTable(db, 'app_settings')) feed('app_settings', all(db, `SELECT id, payload FROM app_settings ORDER BY id`));
  for (const table of BUSINESS_TABLES) if (hasTable(db, table)) feed(table, all(db, `SELECT id, organizationId, payload FROM ${table} ORDER BY id`));
  for (const table of ['organization_settings', 'organization_integrations']) if (hasTable(db, table)) feed(table, all(db, `SELECT * FROM ${table} ORDER BY organizationId`));
  return crypto.createHash('sha256').update(hash.digest()).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Analysis                                                             */
/* ------------------------------------------------------------------ */

interface Plan {
  platformRoles: Array<{ userId: string; platformRole: PlatformRole | null; conflictId?: string }>;
  memberships: Array<{ id: string; organizationId: string; userId: string; tenantRole: TenantRole | null; drop?: 'duplicate'; conflictId?: string }>;
  orphanMembers: Array<{ id: string; conflictId: string }>;
  orphanAssignments: Array<{ id: string; conflictId: string }>;
  duplicateAssignments: string[];
  adminAssignments: string[];
  settings: Array<{ organizationId: string; payload: OrganizationSettingsPayload; conflictId?: string; alternatives?: Record<string, OrganizationSettingsPayload> }>;
  integrations: Array<{ organizationId: string; driveFolderId: string | null; spreadsheetId: string | null; legacyAutoSync: number }>;
  resourceGroups: Array<{ table: string; organizationValue: string | null; ids: string[]; conflictId: string }>;
  departmentRefs: Array<{ table: string; organizationId: string; value: string; ids: string[]; conflictId: string; candidates: string[] }>;
  globalRecipients: { present: boolean; conflictId?: string };
  sessionCount: number;
}

function legacySettingsSources(db: DB, org: any) {
  const sources: Record<string, any> = {};
  const meta = parseJson(org.metadata);
  if (meta && typeof meta === 'object') sources['organization.metadata'] = meta;
  if (hasTable(db, 'tenants')) {
    const row = db.prepare(`SELECT payload FROM tenants WHERE id = ?`).get(org.id) as any;
    const payload = parseJson(row?.payload);
    if (payload && typeof payload === 'object') sources['tenants'] = payload;
  }
  return sources;
}

/** Normalizes a legacy tenant/metadata source into the canonical payload (no recipients: those were global). */
function payloadFromLegacy(source: any): OrganizationSettingsPayload {
  const base = defaultSettingsPayload();
  const profile = { ...base.profile };
  const safe = (key: keyof typeof profile, value: unknown) => {
    try { Object.assign(profile, validateProfilePatch({ [key]: value }, profile).profile); } catch { /* invalid legacy value: keep default */ }
  };
  if (typeof source.legalEntity === 'string') safe('legalEntity', source.legalEntity.slice(0, 200));
  if (typeof source.brandName === 'string') safe('brandName', source.brandName.slice(0, 200));
  if (typeof source.tagline === 'string') safe('tagline', source.tagline.slice(0, 500));
  if (typeof source.logoUrl === 'string' && source.logoUrl !== '/favicon.png') safe('logoUrl', source.logoUrl);
  if (typeof source.primaryColor === 'string') safe('primaryColor', source.primaryColor);
  return { ...base, profile, policy: resolveTenantSettings({ settings: source.settings, currency: source.currency }) };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function analyzeInternal(db: DB): { report: MigrationReport; plan: Plan } {
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];
  const add = (c: Conflict) => { conflicts.push(c); return c.conflictId; };
  const memberHasStatus = columns(db, 'member').includes('status');
  const plan: Plan = {
    platformRoles: [], memberships: [], orphanMembers: [], orphanAssignments: [], duplicateAssignments: [], adminAssignments: [],
    settings: [], integrations: [], resourceGroups: [], departmentRefs: [], globalRecipients: { present: false }, sessionCount: 0,
  };
  const users = all(db, `SELECT id, role FROM "user" ORDER BY id`);
  const userIds = new Set(users.map((u) => u.id));
  const orgs = all(db, `SELECT id, name, slug, logo, metadata FROM organization ORDER BY id`);
  const orgIds = new Set(orgs.map((o) => o.id));
  const teams = all(db, `SELECT id, organizationId, name FROM team ORDER BY id`);
  const teamOrg = new Map(teams.map((t) => [t.id, t.organizationId]));

  /* platform roles (§14.2 rules 3–4) */
  for (const u of users) {
    const role = legacyPlatformRole(u.role);
    if (role) { plan.platformRoles.push({ userId: u.id, platformRole: role }); continue; }
    const id = add({ conflictId: conflictId('ambiguous-platform-role', u.id), kind: 'ambiguous-platform-role', blocking: true,
      references: [`user:${u.id}`], resolutionKinds: ['set-platform-role'], detail: { storedRoleKnown: false } });
    plan.platformRoles.push({ userId: u.id, platformRole: null, conflictId: id });
  }

  /* memberships (§14.2 rules 1, 2, 7, 8) */
  const members = all(db, `SELECT id, organizationId, userId, role, createdAt${memberHasStatus ? ', status' : ''} FROM member ORDER BY createdAt, id`);
  const byPair = new Map<string, any[]>();
  for (const m of members) {
    if (!userIds.has(m.userId) || !orgIds.has(m.organizationId)) {
      plan.orphanMembers.push({ id: m.id, conflictId: add({ conflictId: conflictId('orphan-membership', m.id), kind: 'orphan-membership', blocking: true,
        references: [`member:${m.id}`], resolutionKinds: ['choose-source'], sourceRefs: ['remove-orphan'] }) });
      continue;
    }
    const key = `${m.organizationId}\u0000${m.userId}`;
    byPair.set(key, [...(byPair.get(key) || []), m]);
  }
  for (const rows of byPair.values()) {
    const normalized = rows.map((m) => ({ m, role: legacyMembershipRole(m.role), status: memberHasStatus && isMembershipStatus(m.status) ? m.status : 'active' }));
    const unknown = normalized.filter((n) => !n.role);
    const identical = !unknown.length && normalized.every((n) => n.role === normalized[0].role && n.status === normalized[0].status);
    if (rows.length > 1 && identical) {
      const [keep, ...drop] = normalized.map((n) => n.m).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
      plan.memberships.push({ id: keep.id, organizationId: keep.organizationId, userId: keep.userId, tenantRole: normalized[0].role });
      for (const d of drop) plan.memberships.push({ id: d.id, organizationId: d.organizationId, userId: d.userId, tenantRole: null, drop: 'duplicate' });
      continue;
    }
    if (rows.length > 1 || unknown.length) {
      const first = rows[0];
      const id = add({ conflictId: conflictId(rows.length > 1 ? 'conflicting-duplicate-membership' : 'unknown-membership-role', first.organizationId, first.userId),
        kind: rows.length > 1 ? 'conflicting-duplicate-membership' : 'unknown-membership-role', blocking: true,
        references: rows.map((m) => `member:${m.id}`), resolutionKinds: ['set-membership'],
        detail: { organizationId: first.organizationId, userId: first.userId } });
      for (const m of rows) plan.memberships.push({ id: m.id, organizationId: m.organizationId, userId: m.userId, tenantRole: null, conflictId: id });
      continue;
    }
    plan.memberships.push({ id: rows[0].id, organizationId: rows[0].organizationId, userId: rows[0].userId, tenantRole: normalized[0].role });
  }
  const membershipRole = new Map(plan.memberships.filter((m) => !m.drop).map((m) => [`${m.organizationId}\u0000${m.userId}`, m.tenantRole]));

  /* identities with a legacy allowlist org but no membership: informational, never auto-seeded (rule 5–6) */
  if (hasTable(db, 'allowed_users')) {
    for (const a of all(db, `SELECT id, email, role, organizationId FROM allowed_users ORDER BY id`)) {
      const user = db.prepare(`SELECT id FROM "user" WHERE LOWER(email) = LOWER(?)`).get(a.email) as any;
      if (!user || !a.organizationId || !orgIds.has(a.organizationId) || membershipRole.has(`${a.organizationId}\u0000${user.id}`)) continue;
      add({ conflictId: conflictId('missing-membership', a.organizationId, user.id), kind: 'missing-membership', blocking: false,
        references: [`user:${user.id}`, `organization:${a.organizationId}`], resolutionKinds: ['set-membership'],
        detail: { note: 'Legacy allowlist entry names this organization; no membership is created unless mapped.' } });
    }
  }

  /* department assignments */
  const seenAssignments = new Set<string>();
  for (const tm of all(db, `SELECT id, teamId, userId FROM teamMember ORDER BY createdAt, id`)) {
    const orgId = teamOrg.get(tm.teamId);
    const role = orgId ? membershipRole.get(`${orgId}\u0000${tm.userId}`) : undefined;
    if (!orgId || !userIds.has(tm.userId) || role === undefined) {
      plan.orphanAssignments.push({ id: tm.id, conflictId: add({ conflictId: conflictId('orphan-team-assignment', tm.id), kind: 'orphan-team-assignment', blocking: true,
        references: [`teamMember:${tm.id}`], resolutionKinds: ['choose-source'], sourceRefs: ['remove-orphan'] }) });
      continue;
    }
    const key = `${tm.teamId}\u0000${tm.userId}`;
    if (seenAssignments.has(key)) { plan.duplicateAssignments.push(tm.id); continue; }
    seenAssignments.add(key);
    if (role === 'admin') plan.adminAssignments.push(tm.id);
  }
  for (const m of plan.memberships) {
    if (m.drop || !m.tenantRole || m.tenantRole === 'admin') continue;
    const has = all(db, `SELECT 1 FROM teamMember tm JOIN team t ON t.id = tm.teamId WHERE tm.userId = ? AND t.organizationId = ? LIMIT 1`, m.userId, m.organizationId).length > 0;
    if (!has) warnings.push(`member:${m.id} has no department; it keeps no operational access until an administrator assigns one.`);
  }

  /* settings (§14.4) */
  const existingSettings = hasTable(db, 'organization_settings') ? new Set(all(db, `SELECT organizationId FROM organization_settings`).map((r) => r.organizationId)) : new Set();
  const driveClaims = new Map<string, string[]>();
  const sheetClaims = new Map<string, string[]>();
  for (const org of orgs) {
    const sources = legacySettingsSources(db, org);
    if (existingSettings.has(org.id)) continue; // canonical row already authoritative
    const candidates = Object.fromEntries(Object.entries(sources).map(([name, src]) => [name, payloadFromLegacy(src)]));
    const names = Object.keys(candidates);
    const entry: Plan['settings'][number] = { organizationId: org.id, payload: names.length ? candidates[names[0]] : defaultSettingsPayload() };
    if (names.length > 1 && !names.every((n) => sameJson(candidates[n], candidates[names[0]]))) {
      entry.alternatives = candidates;
      entry.conflictId = add({ conflictId: conflictId('settings-source-disagreement', org.id), kind: 'settings-source-disagreement', blocking: true,
        references: [`organization:${org.id}`], resolutionKinds: ['choose-source', 'set-settings-field'], sourceRefs: names });
    }
    plan.settings.push(entry);
    const pick = (field: 'driveFolderId' | 'spreadsheetId') => {
      const values = Array.from(new Set(Object.values(sources).map((s: any) => s?.[field]).filter((v) => typeof v === 'string' && v)));
      const valid = values.filter((v: any) => RESOURCE_ID.test(v) && !v.startsWith('Folder_'));
      if (values.length > valid.length) warnings.push(`organization:${org.id} ${field} legacy placeholder/invalid value not migrated.`);
      return valid.length === 1 ? (valid[0] as string) : null;
    };
    const drive = pick('driveFolderId');
    const sheet = pick('spreadsheetId');
    if (drive) driveClaims.set(drive, [...(driveClaims.get(drive) || []), org.id]);
    if (sheet) sheetClaims.set(sheet, [...(sheetClaims.get(sheet) || []), org.id]);
    const autoSync = Object.values(sources).some((s: any) => s?.autoSync === true) ? 1 : 0;
    plan.integrations.push({ organizationId: org.id, driveFolderId: drive, spreadsheetId: sheet, legacyAutoSync: autoSync });
  }
  for (const [label, claims] of [['driveFolderId', driveClaims], ['spreadsheetId', sheetClaims]] as const) {
    for (const [resource, owners] of claims) {
      if (owners.length < 2) continue;
      add({ conflictId: conflictId('shared-resource-mapping', label, resource), kind: 'shared-resource-mapping', blocking: true,
        references: owners.map((o) => `organization:${o}`), resolutionKinds: ['choose-source'], sourceRefs: owners,
        detail: { field: label } });
    }
  }

  /* global notification recipients (§14.4): never copied to every tenant */
  const google = hasTable(db, 'app_settings') ? parseJson((db.prepare(`SELECT payload FROM app_settings WHERE id = 'google_config'`).get() as any)?.payload) : null;
  if (google && ['notificationEmails', 'legalNotificationEmail', 'financeNotificationEmail'].some((k) => String(google[k] || '').trim())) {
    plan.globalRecipients = {
      present: true,
      conflictId: add({ conflictId: conflictId('global-notification-recipients'), kind: 'global-notification-recipients', blocking: true,
        references: ['app_settings:google_config'], resolutionKinds: ['set-settings-field', 'choose-source'], sourceRefs: ['discard-global-recipients'],
        detail: { note: 'Assign recipients per organization with set-settings-field (notifications.*), or discard.' } }),
    };
  }

  /* business resources (§14.3) */
  for (const table of BUSINESS_TABLES) {
    if (!hasTable(db, table)) continue;
    const groups = new Map<string, string[]>();
    for (const row of all(db, `SELECT id, organizationId FROM ${table} ORDER BY id`)) {
      if (row.organizationId && orgIds.has(row.organizationId)) continue;
      const key = row.organizationId ?? '';
      groups.set(key, [...(groups.get(key) || []), row.id]);
    }
    for (const [value, ids] of groups) {
      plan.resourceGroups.push({
        table, organizationValue: value || null, ids,
        conflictId: add({ conflictId: conflictId('unowned-resource', table, value), kind: 'unowned-resource', blocking: true,
          references: ids.slice(0, 50).map((id) => `${table}:${id}`), resolutionKinds: ['map-organization', 'quarantine-resource'],
          detail: { table, count: ids.length, legacyAlias: LEGACY_ORGANIZATION_ALIASES.has(value), missingOrganization: !value } }),
      });
    }
  }

  /* department references on owning records (§14.3) — exact normalized match only */
  const teamsByOrg = new Map<string, Map<string, string[]>>();
  for (const t of teams) {
    const index = teamsByOrg.get(t.organizationId) || new Map();
    const key = normalizeDepartmentName(t.name);
    index.set(key, [...(index.get(key) || []), t.id]);
    teamsByOrg.set(t.organizationId, index);
  }
  for (const table of ['partners', 'contracts'] as const) {
    if (!hasTable(db, table)) continue;
    const groups = new Map<string, { orgId: string; value: string; ids: string[] }>();
    for (const row of all(db, `SELECT id, organizationId, payload FROM ${table} ORDER BY id`)) {
      if (!row.organizationId || !orgIds.has(row.organizationId)) continue;
      const payload = parseJson(row.payload) || {};
      const value = String(payload.pic_internal || payload.internal_pic || '').trim();
      if (!value) continue;
      const matches = teamsByOrg.get(row.organizationId)?.get(normalizeDepartmentName(value)) || [];
      if (matches.length === 1) continue;
      const key = `${row.organizationId}\u0000${normalizeDepartmentName(value)}`;
      const group = groups.get(key) || { orgId: row.organizationId, value, ids: [] };
      group.ids.push(row.id);
      groups.set(key, group);
    }
    for (const g of groups.values()) {
      const candidates = teams.filter((t) => t.organizationId === g.orgId).map((t) => t.id);
      plan.departmentRefs.push({
        table, organizationId: g.orgId, value: g.value, ids: g.ids, candidates,
        conflictId: add({ conflictId: conflictId('unknown-department-reference', table, g.orgId, normalizeDepartmentName(g.value)), kind: 'unknown-department-reference', blocking: true,
          references: g.ids.slice(0, 50).map((id) => `${table}:${id}`), resolutionKinds: ['choose-source'], sourceRefs: [...candidates.map((id) => `team:${id}`), 'leave-unassigned'],
          detail: { organizationId: g.orgId, count: g.ids.length } }),
      });
    }
  }

  plan.sessionCount = (db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n;
  const plannedChanges = {
    platformRolesNormalized: plan.platformRoles.filter((p) => p.platformRole && users.find((u) => u.id === p.userId)?.role !== p.platformRole).length,
    membershipRolesNormalized: plan.memberships.filter((m) => !m.drop && m.tenantRole && members.find((x) => x.id === m.id)?.role !== m.tenantRole).length,
    duplicateMembershipsRemoved: plan.memberships.filter((m) => m.drop).length,
    duplicateAssignmentsRemoved: plan.duplicateAssignments.length,
    adminAssignmentsRemoved: plan.adminAssignments.length,
    organizationSettingsCreated: plan.settings.length,
    organizationIntegrationsCreated: plan.integrations.length,
    sessionsInvalidated: plan.sessionCount,
  };
  const report: MigrationReport = {
    formatVersion: 1,
    migrationId: TENANT_BOUNDARIES_MIGRATION_ID,
    sourceDigest: sourceDigest(db),
    alreadyApplied: hasTable(db, 'schema_migrations') && Boolean(db.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get(TENANT_BOUNDARIES_MIGRATION_ID)),
    schema: { tables: tables(db), memberStatusColumn: memberHasStatus },
    counts: {
      identities: users.length,
      organizations: orgs.length,
      departments: teams.length,
      memberships: members.length,
      legacyGlobalRoles: users.reduce<Record<string, number>>((acc, u) => { const k = String(u.role ?? '(none)').toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
      membershipRoles: members.reduce<Record<string, number>>((acc, m) => { const k = String(m.role ?? '(none)').toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
      providerSecretsPresent: {
        geminiApiKey: Boolean(google?.geminiApiKey), smtpPassword: Boolean(google?.smtpPassword),
        googleSession: Boolean(google?.accessToken || google?.refreshToken),
      },
    },
    conflicts,
    warnings,
    plannedChanges,
    applied: false,
  };
  return { report, plan };
}

export function analyze(db: DB): MigrationReport {
  return analyzeInternal(db).report;
}

/* ------------------------------------------------------------------ */
/* Mapping validation                                                   */
/* ------------------------------------------------------------------ */

const RESOLUTION_FIELDS: Record<ResolutionKind, string[]> = {
  'map-organization': ['conflictId', 'decision', 'organizationId'],
  'set-platform-role': ['conflictId', 'decision', 'userId', 'platformRole'],
  'set-membership': ['conflictId', 'decision', 'userId', 'organizationId', 'tenantRole', 'status', 'departmentIds', 'survivingMembershipId'],
  'choose-source': ['conflictId', 'decision', 'sourceRef'],
  'set-settings-field': ['conflictId', 'decision', 'organizationId', 'fieldPath', 'value'],
  'quarantine-resource': ['conflictId', 'decision'],
};

export function validateMapping(db: DB, mapping: unknown, report: MigrationReport): Map<string, Resolution[]> {
  const fail = (message: string): never => { throw new Error(`Invalid mapping: ${message}`); };
  if (!mapping || typeof mapping !== 'object') fail('not an object');
  const m = mapping as Record<string, unknown>;
  for (const key of Object.keys(m)) if (!['formatVersion', 'migrationId', 'sourceDigest', 'resolutions'].includes(key)) fail(`unknown field ${key}`);
  if (m.formatVersion !== 1 || m.migrationId !== TENANT_BOUNDARIES_MIGRATION_ID) fail('formatVersion/migrationId mismatch');
  if (m.sourceDigest !== report.sourceDigest) fail('sourceDigest does not match the database; run a new dry-run');
  if (!Array.isArray(m.resolutions)) fail('resolutions must be a list');
  const byConflict = new Map(report.conflicts.map((c) => [c.conflictId, c]));
  const out = new Map<string, Resolution[]>();
  for (const raw of m.resolutions as any[]) {
    if (!raw || typeof raw !== 'object') fail('resolution must be an object');
    const kind = raw.decision as ResolutionKind;
    if (!RESOLUTION_FIELDS[kind]) fail(`unsupported decision ${raw.decision}`);
    for (const key of Object.keys(raw)) if (!RESOLUTION_FIELDS[kind].includes(key)) fail(`unknown field ${key} on ${kind}`);
    const conflict = byConflict.get(raw.conflictId);
    if (!conflict) fail(`unknown conflictId ${raw.conflictId}`);
    if (!conflict!.resolutionKinds.includes(kind)) fail(`${kind} is not permitted for ${conflict!.kind}`);
    const refs = conflict!.references;
    switch (kind) {
      case 'map-organization':
        if (!db.prepare(`SELECT 1 FROM organization WHERE id = ?`).get(raw.organizationId)) fail('map-organization target does not exist');
        break;
      case 'set-platform-role':
        if (!isPlatformRole(raw.platformRole) || !refs.includes(`user:${raw.userId}`)) fail('set-platform-role must name the conflict identity and a valid role');
        break;
      case 'set-membership': {
        if (!isTenantRole(raw.tenantRole) || !isMembershipStatus(raw.status) || !Array.isArray(raw.departmentIds)) fail('set-membership role/status/departments invalid');
        const detail = conflict!.detail as any;
        const matchesConflict = detail?.userId === raw.userId && detail?.organizationId === raw.organizationId
          || (refs.includes(`user:${raw.userId}`) && refs.includes(`organization:${raw.organizationId}`));
        if (!matchesConflict) fail('set-membership must name the conflict identity and organization');
        if (raw.tenantRole === 'admin' ? raw.departmentIds.length > 0 : raw.departmentIds.length === 0) fail('invalid role/department combination');
        for (const d of raw.departmentIds) if (!db.prepare(`SELECT 1 FROM team WHERE id = ? AND organizationId = ?`).get(d, raw.organizationId)) fail('department outside the organization');
        if (raw.survivingMembershipId !== null && !refs.includes(`member:${raw.survivingMembershipId}`)) fail('survivingMembershipId is not one of the conflicting rows');
        if (raw.survivingMembershipId === null && conflict!.kind !== 'missing-membership') fail('survivingMembershipId null is only allowed for a missing membership');
        break;
      }
      case 'choose-source':
        if (!conflict!.sourceRefs?.includes(raw.sourceRef)) fail(`sourceRef ${raw.sourceRef} is not offered by ${raw.conflictId}`);
        break;
      case 'set-settings-field': {
        if (!db.prepare(`SELECT 1 FROM organization WHERE id = ?`).get(raw.organizationId)) fail('set-settings-field organization does not exist');
        if (typeof raw.fieldPath !== 'string' || !/^(profile|policy|notifications)\.[A-Za-z]+$/.test(raw.fieldPath)) fail('fieldPath must be profile.*, policy.* or notifications.*');
        break;
      }
      case 'quarantine-resource':
        if (conflict!.kind !== 'unowned-resource') fail('only business resources can be quarantined');
        break;
    }
    out.set(raw.conflictId, [...(out.get(raw.conflictId) || []), raw]);
  }
  for (const c of report.conflicts) {
    if (!c.blocking) continue;
    if (!out.has(c.conflictId)) fail(`blocking conflict ${c.conflictId} (${c.kind}) has no resolution`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Apply                                                                */
/* ------------------------------------------------------------------ */

function updateBusinessRows(db: DB, table: string, ids: string[], mutate: (payload: any) => void) {
  const read = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`);
  const write = db.prepare(`UPDATE ${table} SET organizationId = ?, payload = ? WHERE id = ?`);
  for (const id of ids) {
    const payload = parseJson((read.get(id) as any)?.payload) || {};
    mutate(payload);
    write.run(payload.organizationId ?? null, JSON.stringify(payload), id);
  }
}

function setSettingsField(payload: OrganizationSettingsPayload, fieldPath: string, value: unknown): OrganizationSettingsPayload {
  const [section, key] = fieldPath.split('.');
  if (section === 'profile') return { ...payload, profile: validateProfilePatch({ [key]: value }, payload.profile).profile };
  if (section === 'policy') return { ...payload, policy: validatePolicyPatch({ [key]: value }, payload.policy).policy };
  return { ...payload, notifications: validateNotificationsPatch({ [key]: value }, payload.notifications).notifications };
}

export interface ApplyResult { report: MigrationReport }

/**
 * Applies the migration inside ONE immediate transaction. The caller must
 * have taken a consistent backup first. Throws (and rolls back) on any
 * validation failure; the ledger entry is written last.
 */
export function applyMigration(db: DB, mapping: unknown | null): ApplyResult {
  const before = analyzeInternal(db);
  if (before.report.alreadyApplied) return { report: { ...before.report, applied: false, appliedChanges: {} } };
  const resolutions = validateMapping(db, mapping ?? {
    formatVersion: 1, migrationId: TENANT_BOUNDARIES_MIGRATION_ID, sourceDigest: before.report.sourceDigest, resolutions: [],
  }, before.report);
  const applied: Record<string, number> = {};
  const bump = (key: string, n = 1) => { applied[key] = (applied[key] || 0) + n; };
  const resolutionFor = (id?: string) => (id ? resolutions.get(id) || [] : []);

  db.transaction(() => {
    // Digest re-check inside the write transaction: a changed source invalidates the reviewed mapping.
    if (sourceDigest(db) !== before.report.sourceDigest) throw new Error('Source database changed after analysis; run a new dry-run.');
    const { plan } = before;
    ensureTenantBoundarySchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS migration_quarantine (table_name TEXT NOT NULL, record_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (table_name, record_id))`);

    for (const p of plan.platformRoles) {
      const role = p.platformRole ?? (resolutionFor(p.conflictId).find((r) => r.decision === 'set-platform-role') as any)?.platformRole;
      db.prepare(`UPDATE "user" SET role = ? WHERE id = ?`).run(role, p.userId);
      bump('platformRoles');
    }
    for (const o of plan.orphanMembers) { db.prepare(`DELETE FROM member WHERE id = ?`).run(o.id); bump('orphanMembershipsRemoved'); }
    for (const o of plan.orphanAssignments) { db.prepare(`DELETE FROM teamMember WHERE id = ?`).run(o.id); bump('orphanAssignmentsRemoved'); }
    for (const id of [...plan.duplicateAssignments, ...plan.adminAssignments]) { db.prepare(`DELETE FROM teamMember WHERE id = ?`).run(id); bump('assignmentsRemoved'); }

    const handledConflicts = new Set<string>();
    for (const m of plan.memberships) {
      if (m.drop) { db.prepare(`DELETE FROM member WHERE id = ?`).run(m.id); bump('duplicateMembershipsRemoved'); continue; }
      if (m.tenantRole) { db.prepare(`UPDATE member SET role = ?, status = COALESCE(status, 'active') WHERE id = ?`).run(m.tenantRole, m.id); bump('membershipRoles'); continue; }
      if (!m.conflictId || handledConflicts.has(m.conflictId)) continue;
      handledConflicts.add(m.conflictId);
      const r = resolutionFor(m.conflictId).find((x) => x.decision === 'set-membership') as Extract<Resolution, { decision: 'set-membership' }>;
      const rows = plan.memberships.filter((x) => x.conflictId === m.conflictId);
      for (const row of rows) if (row.id !== r.survivingMembershipId) db.prepare(`DELETE FROM member WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE member SET role = ?, status = ? WHERE id = ?`).run(r.tenantRole, r.status, r.survivingMembershipId);
      db.prepare(`DELETE FROM teamMember WHERE userId = ? AND teamId IN (SELECT id FROM team WHERE organizationId = ?)`).run(r.userId, r.organizationId);
      for (const teamId of r.departmentIds) db.prepare(`INSERT INTO teamMember (id, teamId, userId, createdAt) VALUES (?, ?, ?, ?)`).run(`tm_${crypto.randomUUID()}`, teamId, r.userId, new Date().toISOString());
      bump('membershipsResolved');
    }
    // Optional resolutions for non-blocking missing memberships.
    for (const c of before.report.conflicts.filter((x) => x.kind === 'missing-membership')) {
      const r = resolutionFor(c.conflictId).find((x) => x.decision === 'set-membership') as Extract<Resolution, { decision: 'set-membership' }> | undefined;
      if (!r) continue;
      const id = `mem_${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO member (id, organizationId, userId, role, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)`).run(id, r.organizationId, r.userId, r.tenantRole, new Date().toISOString(), r.status);
      for (const teamId of r.departmentIds) db.prepare(`INSERT INTO teamMember (id, teamId, userId, createdAt) VALUES (?, ?, ?, ?)`).run(`tm_${crypto.randomUUID()}`, teamId, r.userId, new Date().toISOString());
      bump('membershipsCreatedFromMapping');
    }

    for (const s of plan.settings) {
      let payload = s.payload;
      if (s.conflictId) {
        const choice = resolutionFor(s.conflictId).find((r) => r.decision === 'choose-source') as any;
        if (choice) payload = s.alternatives![choice.sourceRef];
      }
      for (const r of [...resolutions.values()].flat()) {
        if (r.decision === 'set-settings-field' && r.organizationId === s.organizationId) payload = setSettingsField(payload, r.fieldPath, r.value);
      }
      writeSettingsRow(db, s.organizationId, payload, 1, null);
      bump('organizationSettings');
    }
    for (const i of plan.integrations) {
      let { driveFolderId, spreadsheetId } = i;
      for (const c of before.report.conflicts.filter((x) => x.kind === 'shared-resource-mapping' && x.references.includes(`organization:${i.organizationId}`))) {
        const owner = (resolutionFor(c.conflictId).find((r) => r.decision === 'choose-source') as any)?.sourceRef;
        if (owner !== i.organizationId) {
          if ((c.detail as any).field === 'driveFolderId') driveFolderId = null;
          else spreadsheetId = null;
        }
      }
      writeIntegrationRow(db, { organizationId: i.organizationId, driveFolderId, spreadsheetId, legacyAutoSync: i.legacyAutoSync, version: 1 }, null);
      bump('organizationIntegrations');
    }
    if (plan.globalRecipients.present) {
      const row = db.prepare(`SELECT payload FROM app_settings WHERE id = 'google_config'`).get() as any;
      const google = parseJson(row?.payload) || {};
      delete google.notificationEmails; delete google.legalNotificationEmail; delete google.financeNotificationEmail;
      db.prepare(`UPDATE app_settings SET payload = ?, updatedAt = ? WHERE id = 'google_config'`).run(JSON.stringify(google), new Date().toISOString());
      bump('globalRecipientsRemovedFromPlatformConfig');
    }

    for (const g of plan.resourceGroups) {
      const r = resolutionFor(g.conflictId)[0];
      if (r?.decision === 'map-organization') {
        updateBusinessRows(db, g.table, g.ids, (payload) => { payload.organizationId = r.organizationId; });
        bump('resourcesMapped', g.ids.length);
      } else {
        const insert = db.prepare(`INSERT OR IGNORE INTO migration_quarantine (table_name, record_id, reason, created_at) VALUES (?, ?, ?, ?)`);
        for (const id of g.ids) insert.run(g.table, id, g.organizationValue ? 'legacy-organization-alias' : 'missing-organization', new Date().toISOString());
        bump('resourcesQuarantined', g.ids.length);
      }
    }
    for (const d of plan.departmentRefs) {
      const choice = (resolutionFor(d.conflictId)[0] as any)?.sourceRef as string;
      if (!choice || choice === 'leave-unassigned') { bump('departmentReferencesLeftUnassigned', d.ids.length); continue; }
      const team = db.prepare(`SELECT name FROM team WHERE id = ? AND organizationId = ?`).get(choice.replace(/^team:/, ''), d.organizationId) as any;
      updateBusinessRows(db, d.table, d.ids, (payload) => {
        if (payload.pic_internal !== undefined || payload.internal_pic === undefined) payload.pic_internal = team.name;
        if (payload.internal_pic !== undefined) payload.internal_pic = team.name;
      });
      bump('departmentReferencesMapped', d.ids.length);
    }

    // Cutover: stale cached global roles end with the old sessions (§14.2 rule 10).
    const removed = db.prepare(`DELETE FROM session`).run().changes;
    bump('sessionsInvalidated', removed);
    ensureTenantBoundarySchema(db); // unique indexes now that duplicates are gone
    markMigrationApplied(db, { applied, at: new Date().toISOString() });
  }).immediate();

  return { report: { ...before.report, applied: true, appliedChanges: applied } };
}
