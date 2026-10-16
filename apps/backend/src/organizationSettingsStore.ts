/**
 * Canonical per-organization settings, integrations and administrative audit
 * (tenant-boundaries PRD §7 and §12).
 *
 * SQLite rows here are authoritative. `db.tenants` in server.ts is only a
 * read projection rebuilt from them (buildTenantProjection). Every write
 * checks `expectedVersion` and appends its audit event inside the same
 * transaction, so a mutation and its audit commit together or not at all.
 */
import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { listCountryPacks, listIndustryPacks, resolveTenantSettings } from '@legalio/shared/policy';
import type { TenantSettings } from '@legalio/types/policy';
import type { OrganizationProfile, OrganizationNotifications, OrganizationSettingsPayload, OrganizationSettingsDto } from '@legalio/types/organizationSettings';
export type { OrganizationProfile, OrganizationNotifications, OrganizationSettingsPayload, OrganizationSettingsDto } from '@legalio/types/organizationSettings';
import { SUPPORTED_CURRENCIES } from '@legalio/shared/currencyUtils';
import type { AccessMode, PlatformRole } from './rbac';

type DB = Database.Database;

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(public status: number, public error: string, message?: string) {
    super(message || error);
  }
}
export const invalid = (message = 'Invalid input.') => new ApiError(400, 'INVALID_INPUT', message);

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

export const TENANT_BOUNDARIES_MIGRATION_ID = '002_tenant_boundaries';

const columnsOf = (db: DB, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);

/** Idempotent, additive schema for the canonical tables. Never rewrites existing data. */
export function ensureTenantBoundarySchema(db: DB): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_settings (
      organizationId TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      updatedBy TEXT REFERENCES "user"(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS organization_integrations (
      organizationId TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      driveFolderId TEXT NULL,
      spreadsheetId TEXT NULL,
      legacyAutoSync INTEGER NOT NULL DEFAULT 0 CHECK (legacyAutoSync IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      updatedBy TEXT REFERENCES "user"(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_org_integrations_drive
      ON organization_integrations(driveFolderId) WHERE driveFolderId IS NOT NULL AND driveFolderId <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_org_integrations_sheet
      ON organization_integrations(spreadsheetId) WHERE spreadsheetId IS NOT NULL AND spreadsheetId <> '';
    CREATE TABLE IF NOT EXISTS audit_log (
      id            TEXT PRIMARY KEY,
      actor_id      TEXT NOT NULL,
      action        TEXT NOT NULL,
      target_type   TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      tenant_id     TEXT,
      department_id TEXT,
      impersonated_by TEXT,
      metadata      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL,
      summary TEXT
    );
  `);
  if (!columnsOf(db, 'member').includes('status')) {
    db.exec(`ALTER TABLE member ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))`);
  }
  if (!columnsOf(db, 'invitation').includes('departmentIds')) {
    db.exec(`ALTER TABLE invitation ADD COLUMN departmentIds TEXT`);
  }
  // Unique constraints only once the data is conflict-free (the migration resolves duplicates).
  const tryUnique = (sql: string, duplicateProbe: string) => {
    if (!db.prepare(duplicateProbe).get()) db.exec(sql);
  };
  tryUnique(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_member_org_user ON member(organizationId, userId)`,
    `SELECT 1 FROM member GROUP BY organizationId, userId HAVING COUNT(*) > 1 LIMIT 1`,
  );
  tryUnique(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member ON teamMember(teamId, userId)`,
    `SELECT 1 FROM teamMember GROUP BY teamId, userId HAVING COUNT(*) > 1 LIMIT 1`,
  );
}

export const migrationApplied = (db: DB, id = TENANT_BOUNDARIES_MIGRATION_ID): boolean =>
  Boolean(db.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get(id));

export function markMigrationApplied(db: DB, summary: unknown, id = TENANT_BOUNDARIES_MIGRATION_ID): void {
  db.prepare(`INSERT OR IGNORE INTO schema_migrations (id, appliedAt, summary) VALUES (?, ?, ?)`)
    .run(id, new Date().toISOString(), JSON.stringify(summary ?? {}));
}

/** True when the database holds no organizations or identities yet (fresh install or test). */
export const isEmptyInstall = (db: DB): boolean =>
  !db.prepare(`SELECT 1 FROM organization LIMIT 1`).get() && !db.prepare(`SELECT 1 FROM "user" LIMIT 1`).get();

/* ------------------------------------------------------------------ */
/* Validation (§7.4)                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_PRIMARY_COLOR = '#0090FF';
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const RESOURCE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MODULE_KEYS = ['commercialDocuments', 'spending', 'evaluation', 'aiAssistant', 'newsTicker'] as const;
const POLICY_KEYS = new Set([
  'countryCode', 'industry', 'language', 'timezone', 'defaultCurrency', 'reportingCurrency',
  'expiryWarningDays', 'reminderOffsetsDays', 'modules', 'governingLaw', 'disputeVenue',
  'ddOverrides', 'customDueDiligence',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function onlyKeys(value: unknown, allowed: Iterable<string>, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalid(`${label} must be an object.`);
  const set = new Set(allowed);
  for (const key of Object.keys(value)) if (!set.has(key)) throw invalid(`Unknown field: ${label}.${key}`);
  return value;
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string.`);
  const text = value.trim();
  if (text.length > max) throw invalid(`${label} is too long.`);
  return text;
}

export function normalizeEmail(value: unknown, label = 'Email'): string {
  const text = boundedString(value, 254, label).toLowerCase();
  if (!EMAIL.test(text)) throw invalid(`${label} is not a valid email address.`);
  return text;
}

/** Empty, a raster image upload, a same-origin asset path, or an HTTPS URL. */
export function validateLogoUrl(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('data:')) {
    if (value.length > 2_800_000) throw invalid('Logo image must be at most 2 MB.');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw invalid('Logo image must be PNG, JPG or WebP.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw invalid('Logo image is invalid or exceeds 2 MB.');
    return value;
  }
  const text = boundedString(value, 2048, 'Logo URL');
  if (!text) return '';
  if (/[<>"'\s]/.test(text)) throw invalid('Logo URL is invalid.');
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return text;
  } catch { /* fall through */ }
  throw invalid('Logo URL must be an HTTPS URL or a path on this site.');
}

export function validateProfilePatch(input: unknown, current: OrganizationProfile): { profile: OrganizationProfile; changed: string[] } {
  const patch = onlyKeys(input, ['legalEntity', 'brandName', 'tagline', 'logoUrl', 'primaryColor'], 'profile');
  const next = { ...current };
  if ('legalEntity' in patch) next.legalEntity = boundedString(patch.legalEntity, 200, 'Legal entity');
  if ('brandName' in patch) next.brandName = boundedString(patch.brandName, 200, 'Brand name');
  if ('tagline' in patch) next.tagline = boundedString(patch.tagline, 500, 'Tagline');
  if ('logoUrl' in patch) next.logoUrl = validateLogoUrl(patch.logoUrl);
  if ('primaryColor' in patch) {
    const color = boundedString(patch.primaryColor, 7, 'Primary color');
    if (!HEX_COLOR.test(color)) throw invalid('Primary color must be a six-digit hex color.');
    next.primaryColor = color.toUpperCase();
  }
  return { profile: next, changed: Object.keys(patch).map((k) => `profile.${k}`) };
}

function validateDays(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 730) {
    throw invalid(`${label} must be a whole number from 1 to 730.`);
  }
  return value;
}

function validateLabel(value: unknown): { en: string; id?: string; zh?: string } {
  if (typeof value === 'string') return { en: boundedString(value, 200, 'Checklist label') };
  const label = onlyKeys(value, ['en', 'id', 'zh'], 'label');
  const en = boundedString(label.en, 200, 'Checklist label');
  if (!en) throw invalid('Checklist label is required.');
  return {
    en,
    ...(label.id !== undefined ? { id: boundedString(label.id, 200, 'Checklist label') } : {}),
    ...(label.zh !== undefined ? { zh: boundedString(label.zh, 200, 'Checklist label') } : {}),
  };
}

export function validatePolicyPatch(input: unknown, current: TenantSettings): { policy: TenantSettings; changed: string[] } {
  const patch = onlyKeys(input, POLICY_KEYS, 'policy');
  const next: any = { ...current, modules: { ...current.modules }, ddOverrides: { ...current.ddOverrides } };
  const changed: string[] = [];
  const mark = (key: string) => changed.push(`policy.${key}`);

  if ('countryCode' in patch) {
    const code = boundedString(patch.countryCode, 8, 'Country').toUpperCase();
    if (!listCountryPacks().some((c) => c.code === code)) throw invalid('Unknown country.');
    next.countryCode = code; mark('countryCode');
  }
  if ('industry' in patch) {
    const key = boundedString(patch.industry, 64, 'Industry');
    if (!listIndustryPacks().some((i) => i.key === key)) throw invalid('Unknown industry.');
    next.industry = key; mark('industry');
  }
  if ('language' in patch) {
    if (!['EN', 'ID', 'ZH'].includes(patch.language as string)) throw invalid('Unknown language.');
    next.language = patch.language; mark('language');
  }
  if ('timezone' in patch) {
    const tz = boundedString(patch.timezone, 64, 'Timezone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw invalid('Unknown timezone.'); }
    next.timezone = tz; mark('timezone');
  }
  for (const key of ['defaultCurrency', 'reportingCurrency'] as const) {
    if (key in patch) {
      const code = boundedString(patch[key], 3, 'Currency').toUpperCase();
      if (!SUPPORTED_CURRENCIES.some((c) => c.code === code)) throw invalid('Unknown currency.');
      next[key] = code; mark(key);
    }
  }
  if ('expiryWarningDays' in patch) { next.expiryWarningDays = validateDays(patch.expiryWarningDays, 'Warning window'); mark('expiryWarningDays'); }
  if ('reminderOffsetsDays' in patch) {
    const list = patch.reminderOffsetsDays;
    if (!Array.isArray(list) || list.length === 0) throw invalid('At least one reminder is required.');
    const days = list.map((d) => validateDays(d, 'Reminder'));
    if (new Set(days).size !== days.length) throw invalid('Reminder days must be unique.');
    next.reminderOffsetsDays = [...days].sort((a, b) => b - a); mark('reminderOffsetsDays');
  }
  if ('modules' in patch) {
    const modules = onlyKeys(patch.modules, MODULE_KEYS, 'modules');
    for (const [key, value] of Object.entries(modules)) {
      if (typeof value !== 'boolean') throw invalid(`modules.${key} must be true or false.`);
      next.modules[key] = value; mark(`modules.${key}`);
    }
  }
  for (const key of ['governingLaw', 'disputeVenue'] as const) {
    if (key in patch) {
      const value = patch[key] === null ? '' : boundedString(patch[key], 2000, key);
      next[key] = value || undefined; mark(key);
    }
  }
  if ('ddOverrides' in patch) {
    const overrides = onlyKeys(patch.ddOverrides, Object.keys(patch.ddOverrides as object), 'ddOverrides');
    for (const [key, value] of Object.entries(overrides)) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw invalid('Invalid checklist key.');
      if (value === null) { delete next.ddOverrides[key]; mark(`ddOverrides.${key}`); continue; }
      const o = onlyKeys(value, ['required', 'disabled'], `ddOverrides.${key}`);
      for (const [flag, flagValue] of Object.entries(o)) {
        if (typeof flagValue !== 'boolean') throw invalid(`ddOverrides.${key}.${flag} must be true or false.`);
      }
      next.ddOverrides[key] = { ...(next.ddOverrides[key] || {}), ...o };
      mark(`ddOverrides.${key}`);
    }
  }
  if ('customDueDiligence' in patch) {
    const items = patch.customDueDiligence;
    if (!Array.isArray(items) || items.length > 200) throw invalid('Custom checklist must be a list.');
    const seen = new Set<string>();
    next.customDueDiligence = items.map((raw) => {
      const item = onlyKeys(raw, ['key', 'label', 'required', 'expires', 'source'], 'customDueDiligence');
      const key = boundedString(item.key, 64, 'Checklist key');
      if (!key || seen.has(key)) throw invalid('Checklist keys must be unique and non-empty.');
      seen.add(key);
      if (item.required !== undefined && typeof item.required !== 'boolean') throw invalid('required must be true or false.');
      if (item.expires !== undefined && typeof item.expires !== 'boolean') throw invalid('expires must be true or false.');
      return { key, label: validateLabel(item.label), required: Boolean(item.required), expires: Boolean(item.expires), source: 'tenant' };
    });
    mark('customDueDiligence');
  }
  // Keep the existing normalization (pack defaults, ordering, evidence retention rules).
  return { policy: resolveTenantSettings({ settings: next }), changed };
}

export function validateNotificationsPatch(input: unknown, current: OrganizationNotifications) {
  const patch = onlyKeys(input, ['notificationEmails', 'legalNotificationEmail', 'financeNotificationEmail'], 'notifications');
  const next = { ...current, notificationEmails: [...current.notificationEmails] };
  if ('notificationEmails' in patch) {
    const list = patch.notificationEmails;
    if (!Array.isArray(list) || list.length > 100) throw invalid('Notification recipients must be a list of at most 100 emails.');
    next.notificationEmails = Array.from(new Set(list.map((e) => normalizeEmail(e, 'Recipient'))));
  }
  for (const key of ['legalNotificationEmail', 'financeNotificationEmail'] as const) {
    if (key in patch) next[key] = patch[key] === null || patch[key] === '' ? null : normalizeEmail(patch[key], 'Recipient');
  }
  return { notifications: next, changed: Object.keys(patch).map((k) => `notifications.${k}`) };
}

export function validateResourceId(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !RESOURCE_ID.test(value.trim()) || value.startsWith('Folder_')) {
    throw invalid(`${label} is not a valid Google resource ID.`);
  }
  return value.trim();
}

/* ------------------------------------------------------------------ */
/* Settings read/write                                                  */
/* ------------------------------------------------------------------ */

export function defaultSettingsPayload(seed?: { legalEntity?: string; brandName?: string; tagline?: string; logoUrl?: string; primaryColor?: string; policy?: Partial<TenantSettings> }): OrganizationSettingsPayload {
  return {
    profile: {
      legalEntity: seed?.legalEntity || '',
      brandName: seed?.brandName || '',
      tagline: seed?.tagline || '',
      logoUrl: seed?.logoUrl || '',
      primaryColor: seed?.primaryColor && HEX_COLOR.test(seed.primaryColor) ? seed.primaryColor.toUpperCase() : DEFAULT_PRIMARY_COLOR,
    },
    policy: resolveTenantSettings({ settings: seed?.policy || {} }),
    notifications: { notificationEmails: [], legalNotificationEmail: null, financeNotificationEmail: null },
  };
}

/** Parses a stored payload strictly; corrupt configuration is a controlled error, never a default-tenant fallback. */
export function parseStoredPayload(raw: string): OrganizationSettingsPayload {
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(500, 'CONFIGURATION_INVALID', 'Stored organization settings are invalid.'); }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.profile) || !isPlainObject(parsed.policy) || !isPlainObject(parsed.notifications)) {
    throw new ApiError(500, 'CONFIGURATION_INVALID', 'Stored organization settings are invalid.');
  }
  const base = defaultSettingsPayload();
  return {
    profile: { ...base.profile, ...parsed.profile },
    policy: resolveTenantSettings({ settings: parsed.policy }),
    notifications: {
      notificationEmails: Array.isArray(parsed.notifications.notificationEmails) ? parsed.notifications.notificationEmails : [],
      legalNotificationEmail: typeof parsed.notifications.legalNotificationEmail === 'string' ? parsed.notifications.legalNotificationEmail : null,
      financeNotificationEmail: typeof parsed.notifications.financeNotificationEmail === 'string' ? parsed.notifications.financeNotificationEmail : null,
    },
  };
}

export const organizationExists = (db: DB, organizationId: string): boolean =>
  typeof organizationId === 'string' && organizationId.length > 0 && organizationId.length <= 200 &&
  Boolean(db.prepare(`SELECT 1 FROM organization WHERE id = ?`).get(organizationId));

export function readOrganizationSettings(db: DB, organizationId: string): OrganizationSettingsDto {
  const org = db.prepare(`SELECT id, name, slug FROM organization WHERE id = ?`).get(organizationId) as any;
  if (!org) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  const row = db.prepare(`SELECT payload, version FROM organization_settings WHERE organizationId = ?`).get(organizationId) as any;
  const payload = row ? parseStoredPayload(row.payload) : defaultSettingsPayload();
  return { organizationId: org.id, name: org.name, slug: org.slug || '', version: row ? row.version : 0, ...payload };
}

export function writeSettingsRow(db: DB, organizationId: string, payload: OrganizationSettingsPayload, version: number, actorId: string | null) {
  db.prepare(`
    INSERT INTO organization_settings (organizationId, payload, version, updatedAt, updatedBy)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(organizationId) DO UPDATE SET payload = excluded.payload, version = excluded.version,
      updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy
  `).run(organizationId, JSON.stringify(payload), version, new Date().toISOString(), actorId);
}

export interface AuditActor {
  actorId: string;
  actorPlatformRole: PlatformRole;
  accessMode: AccessMode | 'self' | 'system';
  requestId: string;
}

export interface SettingsPatch {
  expectedVersion?: unknown;
  name?: unknown;
  profile?: unknown;
  policy?: unknown;
  notifications?: unknown;
}

function expectVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid('expectedVersion is required.');
  return value;
}

export function patchOrganizationSettings(db: DB, organizationId: string, body: unknown, actor: AuditActor): OrganizationSettingsDto {
  const patch = onlyKeys(body, ['expectedVersion', 'name', 'profile', 'policy', 'notifications'], 'body') as SettingsPatch;
  const expectedVersion = expectVersion(patch.expectedVersion);
  if (!['name', 'profile', 'policy', 'notifications'].some((k) => k in patch)) throw invalid('Nothing to update.');
  return db.transaction(() => {
    const current = readOrganizationSettings(db, organizationId);
    if (current.version !== expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'These settings were changed by someone else. Reload to continue.');
    const changed: string[] = [];
    let name = current.name;
    if ('name' in patch) {
      name = boundedString(patch.name, 200, 'Organization name');
      if (!name) throw invalid('Organization name is required.');
      changed.push('name');
    }
    let { profile, policy, notifications } = current;
    if ('profile' in patch) { const r = validateProfilePatch(patch.profile, profile); profile = r.profile; changed.push(...r.changed); }
    if ('policy' in patch) { const r = validatePolicyPatch(patch.policy, policy); policy = r.policy; changed.push(...r.changed); }
    if ('notifications' in patch) { const r = validateNotificationsPatch(patch.notifications, notifications); notifications = r.notifications; changed.push(...r.changed); }
    const version = current.version + 1;
    writeSettingsRow(db, organizationId, { profile, policy, notifications }, version, actor.actorId);
    db.prepare(`UPDATE organization SET name = ?, logo = ? WHERE id = ?`).run(name, profile.logoUrl || null, organizationId);
    appendAudit(db, actor, {
      organizationId, action: 'organization.settings.update', targetType: 'organization', targetId: organizationId,
      outcome: 'success', changedFields: changed,
    });
    return readOrganizationSettings(db, organizationId);
  })();
}

/* ------------------------------------------------------------------ */
/* Integrations                                                         */
/* ------------------------------------------------------------------ */

export interface IntegrationRow {
  organizationId: string;
  driveFolderId: string | null;
  spreadsheetId: string | null;
  legacyAutoSync: number;
  version: number;
}

export function readIntegration(db: DB, organizationId: string): IntegrationRow {
  if (!organizationExists(db, organizationId)) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  const row = db.prepare(`SELECT organizationId, driveFolderId, spreadsheetId, legacyAutoSync, version FROM organization_integrations WHERE organizationId = ?`).get(organizationId) as IntegrationRow | undefined;
  return row || { organizationId, driveFolderId: null, spreadsheetId: null, legacyAutoSync: 0, version: 0 };
}

export function integrationDto(row: IntegrationRow, providerConfigured: boolean) {
  return {
    organizationId: row.organizationId,
    driveFolderId: row.driveFolderId,
    spreadsheetId: row.spreadsheetId,
    providerConfigured,
    mappingConfigured: Boolean(row.driveFolderId || row.spreadsheetId),
    syncSupported: false as const,
    effectiveAutoSync: false as const,
    version: row.version,
  };
}

export function writeIntegrationRow(db: DB, row: IntegrationRow, actorId: string | null) {
  db.prepare(`
    INSERT INTO organization_integrations (organizationId, driveFolderId, spreadsheetId, legacyAutoSync, version, updatedAt, updatedBy)
    VALUES (@organizationId, @driveFolderId, @spreadsheetId, @legacyAutoSync, @version, @updatedAt, @updatedBy)
    ON CONFLICT(organizationId) DO UPDATE SET driveFolderId = excluded.driveFolderId, spreadsheetId = excluded.spreadsheetId,
      legacyAutoSync = excluded.legacyAutoSync, version = excluded.version, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy
  `).run({ ...row, updatedAt: new Date().toISOString(), updatedBy: actorId });
}

export function patchIntegration(db: DB, organizationId: string, body: unknown, actor: AuditActor): IntegrationRow {
  const patch = onlyKeys(body, ['expectedVersion', 'driveFolderId', 'spreadsheetId'], 'body');
  const expectedVersion = expectVersion(patch.expectedVersion);
  if (!('driveFolderId' in patch) && !('spreadsheetId' in patch)) throw invalid('Nothing to update.');
  const drive = 'driveFolderId' in patch ? validateResourceId(patch.driveFolderId, 'Drive folder ID') : undefined;
  const sheet = 'spreadsheetId' in patch ? validateResourceId(patch.spreadsheetId, 'Spreadsheet ID') : undefined;
  return db.transaction(() => {
    const current = readIntegration(db, organizationId);
    if (current.version !== expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'The integration was changed by someone else. Reload to continue.');
    const claimed = (column: 'driveFolderId' | 'spreadsheetId', value: string | null | undefined) =>
      value && db.prepare(`SELECT 1 FROM organization_integrations WHERE ${column} = ? AND organizationId <> ?`).get(value, organizationId);
    // Another organization's resource is rejected without disclosing whose it is.
    if (claimed('driveFolderId', drive) || claimed('spreadsheetId', sheet)) throw invalid('This resource cannot be used for this organization.');
    const next: IntegrationRow = {
      ...current,
      driveFolderId: drive === undefined ? current.driveFolderId : drive,
      spreadsheetId: sheet === undefined ? current.spreadsheetId : sheet,
      version: current.version + 1,
    };
    writeIntegrationRow(db, next, actor.actorId);
    appendAudit(db, actor, {
      organizationId, action: 'organization.integration.update', targetType: 'organization', targetId: organizationId,
      outcome: 'success',
      changedFields: [...(drive !== undefined ? ['driveFolderId'] : []), ...(sheet !== undefined ? ['spreadsheetId'] : [])],
    });
    return readIntegration(db, organizationId);
  })();
}

/* ------------------------------------------------------------------ */
/* Audit (§12)                                                          */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: 'success' | 'denied';
  changedFields?: string[];
}

export function appendAudit(db: DB, actor: AuditActor, entry: AuditEntry): void {
  const metadata = {
    schemaVersion: 1,
    requestId: actor.requestId,
    actorPlatformRole: actor.actorPlatformRole,
    accessMode: actor.accessMode,
    outcome: entry.outcome,
    changedFields: (entry.changedFields || []).filter((f) => typeof f === 'string').slice(0, 100),
  };
  db.prepare(`
    INSERT INTO audit_log (id, actor_id, action, target_type, target_id, tenant_id, department_id, impersonated_by, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(
    `aud_${crypto.randomUUID()}`, actor.actorId, entry.action, entry.targetType, entry.targetId,
    entry.organizationId, JSON.stringify(metadata), new Date().toISOString(),
  );
}

export interface AuditQuery {
  organizationId?: string | null;
  action?: string;
  targetType?: string;
  limit: number;
  offset: number;
}

/** Sanitized read projection (§12): no raw metadata, actor email, IP or session details. */
export function listAudit(db: DB, query: AuditQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.organizationId !== undefined) { where.push('a.tenant_id IS ?'); params.push(query.organizationId); }
  if (query.action) { where.push('a.action = ?'); params.push(query.action); }
  if (query.targetType) { where.push('a.target_type = ?'); params.push(query.targetType); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${clause}`).get(...params) as any).n as number;
  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.actor_id, a.action, a.target_type, a.target_id, a.tenant_id, a.metadata,
      (SELECT u.name FROM "user" u WHERE u.id = a.actor_id) AS actor_name
    FROM audit_log a ${clause}
    ORDER BY a.created_at DESC, a.id ASC LIMIT ? OFFSET ?
  `).all(...params, query.limit, query.offset) as any[];
  const events = rows.map((r) => {
    let meta: any = {};
    try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { meta = {}; }
    return {
      id: r.id,
      createdAt: r.created_at,
      actorId: r.actor_id,
      actorName: r.actor_name || '',
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      organizationId: r.tenant_id ?? null,
      outcome: meta.outcome === 'denied' ? 'denied' : 'success',
      changedFields: Array.isArray(meta.changedFields) ? meta.changedFields.filter((f: unknown) => typeof f === 'string') : [],
      accessMode: meta.accessMode === 'platform' ? 'platform' : 'membership',
    };
  });
  return { events, total };
}

/* ------------------------------------------------------------------ */
/* Read projection for legacy server code (§7.3)                        */
/* ------------------------------------------------------------------ */

/** Rebuilds the legacy `db.tenants` shape from canonical rows. Never written back. */
export function buildTenantProjection(db: DB): any[] {
  const orgs = db.prepare(`SELECT id, name, slug, logo, createdAt FROM organization ORDER BY createdAt ASC, id ASC`).all() as any[];
  return orgs.map((org, index) => {
    let settings: OrganizationSettingsDto;
    try { settings = readOrganizationSettings(db, org.id); } catch { settings = { organizationId: org.id, name: org.name, slug: org.slug, version: 0, ...defaultSettingsPayload() }; }
    const integration = readIntegration(db, org.id);
    return {
      id: org.id,
      name: org.name,
      legalEntity: settings.profile.legalEntity,
      brandName: settings.profile.brandName || org.name,
      tagline: settings.profile.tagline,
      logoUrl: settings.profile.logoUrl || '/favicon.png',
      primaryColor: settings.profile.primaryColor,
      currency: settings.policy.defaultCurrency,
      settings: settings.policy,
      notifications: settings.notifications,
      domainSlug: org.slug || '',
      isDefault: index === 0,
      driveFolderId: integration.driveFolderId || undefined,
      driveFolderLink: integration.driveFolderId ? `https://drive.google.com/drive/folders/${integration.driveFolderId}` : undefined,
      spreadsheetId: integration.spreadsheetId || undefined,
      spreadsheetUrl: integration.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${integration.spreadsheetId}/edit` : undefined,
      created_at: org.createdAt,
    };
  });
}
