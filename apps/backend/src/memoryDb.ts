import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { IS_TEST_MODE } from './runtimePaths';
import { bindTenantStore, normalizePartnerDocuments, computeDueDiligenceStatus, tenantDefaultCurrency } from './tenantPolicy';
import { buildTenantProjection } from './organizationSettingsStore';
import { sql, isConstraintViolation } from './db';
import { normalizeContractStatus, normalizeApprovalStatus } from '@legalio/types/domainStatus';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { createCoreSaver } from './coreDataStore';
import { contractRepository } from './repositories/contractRepository';
import { partnerRepository } from './repositories/partnerRepository';
import { ioRepository } from './repositories/ioRepository';
import { spendingRepository } from './repositories/spendingRepository';
import { nextEntityId } from './ids';
import { migratePartnerContact } from './partnerContact';
import { loadCoreData } from './lib/auth';
import { componentLog } from './logger';
const log = componentLog('memoryDb');

/**
 * The in-memory projection of business data (partners, contracts, IOs, spendings, evaluations, notifications, templates,
 * platform configuration) and its persistence. One process holds one projection; PostgreSQL stays the source of truth.
 */

export const DEFAULT_BRANDING = {
  appName: "Legalio CLM",
  logoUrl: "/favicon.png",
  primaryColor: "#0090FF",
  footerText: "Legalio — open-source contract lifecycle management.",
  loginHeadline: "Contract, partner and commercial document management",
};
export const demoData = buildDemoDataset();
// APP_TEST_MODE never reseeds demo data (PRD §15); fixtures are created explicitly.
export const seedData = IS_TEST_MODE
  ? { partners: [], contracts: [], ios: [], notifications: [], activityLogs: [], evaluations: [], spendings: [] }
  : demoData;
/** Demo contracts to insert (through the repository) when a first run seeds the demo workspace; empty in test mode. */
export const seedContracts: any[] = seedData.contracts;
/** Demo partners to insert (through the repository) when a first run seeds the demo workspace; empty in test mode. */
export const seedPartners: any[] = seedData.partners;
/** Demo insertion orders to insert (through the repository) on a first run; empty in test mode. */
export const seedIos: any[] = seedData.ios;
/** Demo spendings to insert (through the repository) on a first run; empty in test mode. */
export const seedSpendings: any[] = seedData.spendings;
/** Demo evaluations to insert (through the repository) on a first run; empty in test mode. */
export const seedEvaluations: any[] = seedData.evaluations;
export const db: any = {
  allowedUsers: [],
  notifications: seedData.notifications,
  activityLogs: seedData.activityLogs,
  tenants: [],
  templates: [],
  newsTicker: { items: [] as string[], lastGeneratedAt: null as string | null },
  branding: DEFAULT_BRANDING,
  googleConfig: {
    spreadsheetId: "",
    driveFolderId: "",
    isConnected: false,
    lastSyncTime: "",
    autoSync: false,
    isLocked: false,
    notificationEmails: "",
    legalNotificationEmail: "",
    financeNotificationEmail: "",
    aiModel: "gemini-3.8-flash",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    refreshToken: "",
  },
};
// Contracts are persisted row by row by repositories/contractRepository.ts; the snapshot holds none. Touching the old
// collection would silently read an empty list or lose a write, so it fails loudly instead.
const repositoryBacked = (collection: string, repository: string) => Object.defineProperty(db, collection, {
  enumerable: false, configurable: true,
  get() { throw new Error(`db.${collection} is not in memory: use ${repository}.`); },
  set() { throw new Error(`db.${collection} is not in memory: write through ${repository}.`); },
});
repositoryBacked('contracts', 'repositories/contractRepository');
repositoryBacked('partners', 'repositories/partnerRepository');
repositoryBacked('ios', 'repositories/ioRepository');
repositoryBacked('spendings', 'repositories/spendingRepository');
repositoryBacked('evaluations', 'repositories/evaluationRepository');
bindTenantStore(() => db);

/** Rebuilds the read-only `db.tenants` projection from canonical organization rows (PRD §7.3). */
export async function refreshTenantProjection() {
  db.tenants = await buildTenantProjection(sql);
}
/**
 * Bring records written by earlier releases in line with the current model:
 * - Indonesian status labels become stable codes (see src/lib/domainStatus);
 * - due-diligence checklists are rebuilt from the tenant's policy packs,
 *   keeping every document that was already uploaded.
 * Idempotent: running it on migrated data changes nothing.
 */
export function migrateLegacyRecords() {
  // Organization ownership is never guessed here: records without a canonical
  // organization stay quarantined until the 002 migration maps them (PRD §14.3).
  if (!db.templates) db.templates = [];
}
/** JSON with object keys sorted at every level, to compare records regardless of key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
}
/** A valid currency on a spending written by an earlier release. */
export function normalizeSpendingRecord(sp: any) {
  sp.currency = normalizeCurrencyCode(sp.currency, tenantDefaultCurrency(sp.organizationId));
  return sp;
}
/** Brings stored spendings to a valid currency. Only rows that need it are read (SQL pre-filter). */
export async function normalizeStoredSpendings(): Promise<number> {
  let changed = 0;
  for await (const batch of spendingRepository.batches(500, `currency IS NULL OR currency !~ '^[A-Z]{3}$'`)) {
    for (const sp of batch) {
      if (normalizeSpendingRecord({ ...sp }).currency === sp.currency) continue;
      await spendingRepository.mutate(sp.organizationId, sp.id, (row) => { normalizeSpendingRecord(row); }, { bumpVersion: false });
      changed++;
    }
  }
  return changed;
}
/**
 * Spendings stored by the earliest releases carry ids like "spd-…" instead of SPnnnn: they get a number from the id sequence
 * (the row is rewritten under its new id; the old one disappears in the same transaction).
 */
export async function migrateLegacySpendingIds(): Promise<number> {
  let changed = 0;
  for await (const batch of spendingRepository.batches(500, `id LIKE 'spd-%'`)) {
    for (const sp of batch) {
      await sql.tx(async () => {
        await spendingRepository.remove(sp.organizationId, sp.id);
        await spendingRepository.insert({ ...sp, id: await nextEntityId("spending") });
      });
      changed++;
    }
  }
  return changed;
}
/** Stable status code and a valid currency on an insertion order written by an earlier release. */
export function normalizeIoRecord(io: any) {
  io.status = normalizeContractStatus(io.status);
  io.currency = normalizeCurrencyCode(io.currency, tenantDefaultCurrency(io.organizationId));
  return io;
}
/** Brings stored insertion orders to stable status codes and a valid currency. Only rows that need it are read (SQL pre-filter). */
export async function normalizeStoredIos(): Promise<number> {
  const stale = `status IS NULL OR status NOT IN ('Active','Expiring','Expired','Terminated') OR currency IS NULL OR currency !~ '^[A-Z]{3}$'`;
  const signature = (io: any) => JSON.stringify([io.status, io.currency]);
  let changed = 0;
  for await (const batch of ioRepository.batches(500, stale)) {
    for (const io of batch) {
      if (signature(normalizeIoRecord({ ...io })) === signature(io)) continue;
      await ioRepository.mutate(io.organizationId, io.io_id, (row) => { normalizeIoRecord(row); }, { bumpVersion: false });
      changed++;
    }
  }
  return changed;
}
/** Partner written by an earlier release brought in line with the model (contact fields, country, tags, due-diligence checklist). */
export function normalizePartnerRecord(p: any) {
  migratePartnerContact(p);
  if (p.country === undefined && p.legal_status_flag) {
    // BHI = "Badan Hukum Indonesia"; BHA = foreign entity of unknown country.
    p.country = p.legal_status_flag === "BHI" ? "ID" : "";
  }
  p.tags = sanitizePartnerTags(p.tags);
  p.dd_documents = normalizePartnerDocuments(p);
  p.status_dd = computeDueDiligenceStatus(p.dd_documents);
  return p;
}
/**
 * Brings stored partners to the current model (see normalizePartnerRecord). Rows that are already normal are left alone; a changed row is
 * rewritten under its row lock without a new version (nobody's open editor becomes outdated). `organizationId` limits it to one tenant
 * (after a policy change); returns the number of rows rewritten.
 */
export async function normalizeStoredPartners(organizationId?: string): Promise<number> {
  const signature = (p: any) => stableJson(p);
  let changed = 0;
  for await (const batch of partnerRepository.batches(500, organizationId ? 'organization_id = ?' : 'TRUE', organizationId ? [organizationId] : [])) {
    for (const partner of batch) {
      if (signature(normalizePartnerRecord(structuredClone(partner))) === signature(partner)) continue;
      await partnerRepository.mutate(partner.organizationId, partner.partner_id, (row) => { normalizePartnerRecord(row); }, { bumpVersion: false });
      changed++;
    }
  }
  return changed;
}
/** Stable status codes and a valid currency on a contract written by an earlier release (contracts are repository-backed, so this is applied row by row). */
export function normalizeContractRecord(c: any) {
  c.status = normalizeContractStatus(c.status);
  c.status_approval = normalizeApprovalStatus(c.status_approval);
  c.currency = normalizeCurrencyCode(c.currency, tenantDefaultCurrency(c.organizationId));
  return c;
}
/** Brings stored contracts written by earlier releases to stable codes and a valid currency. Only rows that need it are read (SQL pre-filter). */
export async function normalizeStoredContracts(): Promise<number> {
  const stale = `status IS NULL OR status NOT IN ('Active','Expiring','Expired','Terminated')
    OR status_approval IS NULL OR status_approval NOT IN ('Draft','Review','Signed','Active')
    OR currency IS NULL OR currency !~ '^[A-Z]{3}$'`;
  const signature = (c: any) => JSON.stringify([c.status, c.status_approval, c.currency]);
  let changed = 0;
  for await (const batch of contractRepository.batches(500, stale)) {
    for (const contract of batch) {
      if (signature(normalizeContractRecord({ ...contract })) === signature(contract)) continue;
      await contractRepository.mutate(contract.organizationId, contract.contract_id, (row) => { normalizeContractRecord(row); }, { bumpVersion: false });
      changed++;
    }
  }
  return changed;
}
export function sanitizePartnerTags(tags) {
  if (!tags) return [];
  let list = [];
  if (Array.isArray(tags)) {
    list = tags.map((t) => String(t).trim());
  } else if (typeof tags === "string") {
    const trimmed = tags.trim();
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) list = arr.map((t) => String(t).trim());
      } catch (e) {
        list = trimmed.split(/[,|;]/).map((s) => s.trim());
      }
    } else {
      list = trimmed.split(/[,|;]/).map((s) => s.trim());
    }
  }
  const valid = list.filter((item) => {
    if (!item) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(item)) return false;
    return true;
  });
  return valid;
}
/** ISO 3166-1 alpha-2 code or empty string (unknown). */
export function sanitizeCountryCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
/** English country name for prompts; codes without a policy pack (US, DE…) would otherwise read as "International". */
export function countryNameForPrompt(code: string): string {
  return new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code.toUpperCase()) || code;
}
/**
 * Partner identifiers (PRD §3.2.2): `{ scheme, value, country }`. Values are
 * kept as entered — format checks are advisory only and done client-side.
 */
export function sanitizeIdentifiers(value: unknown): Array<{ scheme: string; value: string; country: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && typeof item === "object" && String(item.value || "").trim())
    .slice(0, 20)
    .map((item: any) => ({
      scheme: String(item.scheme || "other").slice(0, 64),
      value: String(item.value).trim().slice(0, 128),
      country: sanitizeCountryCode(item.country),
    }));
}
export const saveListeners: Array<() => void> = [];
/** Runs before every save: caches derived from the projection (upload index, lifecycle freshness) register here to be dropped. */
export function onDbSaved(listener: () => void) { saveListeners.push(listener); }
export const coreSaver = createCoreSaver(sql, () => db, async () => { Object.assign(db, await loadCoreData()); });
/**
 * Persists the in-memory projection: one writer at a time, never inside sql.tx. `alongside` runs in the same transaction
 * right after the sync, for repository writes that must commit or fail together with the snapshot change (e.g. deleting a
 * contract together with the insertion orders and notifications that referenced it).
 */
export async function saveDb(alongside?: () => Promise<unknown>) {
  for (const listener of saveListeners) listener();
  try {
    await coreSaver.save(alongside);
  } catch (err) {
    log.error("Failed to save core data", err);
    if (isConstraintViolation(err)) (err as any).status = 409;
    throw err;
  }
}
export function triggerAutoPushToGoogleSheet(_req?: any, _options?: any): Promise<void> {
  return Promise.resolve();
}
export function syncAdderNames() {
  const userByEmail = new Map();
  db.allowedUsers.forEach((u) => {
    if (u.email) {
      userByEmail.set(u.email.trim().toLowerCase(), u);
    }
  });
  db.allowedUsers.forEach((u) => {
    if (
      u.addedByEmail &&
      userByEmail.has(u.addedByEmail.trim().toLowerCase())
    ) {
      const creator = userByEmail.get(u.addedByEmail.trim().toLowerCase());
      u.addedBy = creator.name;
    } else if (
      u.addedBy &&
      u.addedBy !== "System Core" &&
      u.addedBy !== "System"
    ) {
      for (const creator of db.allowedUsers) {
        const creatorEmail = creator.email.trim().toLowerCase();
        const creatorName = creator.name.trim().toLowerCase();
        const currentAddedBy = u.addedBy.trim().toLowerCase();
        if (
          currentAddedBy === creatorEmail ||
          currentAddedBy === creatorName
        ) {
          u.addedByEmail = creator.email;
          u.addedBy = creator.name;
          break;
        }
      }
    }
  });
}
