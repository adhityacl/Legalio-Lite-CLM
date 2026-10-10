/**
 * Server-side access to tenant configuration and policy packs.
 *
 * `server.ts` keeps its in-memory `db` projection; this module is bound to it
 * once at startup so helpers never need a hardcoded tenant ID, currency, or
 * timezone (PRD §2.1, §6.1).
 */
import {
  buildDueDiligenceChecklist,
  daysUntil,
  getCountryPack,
  getIndustryPack,
  localize,
  matchesRequirement,
  resolveTenantSettings,
  type DueDiligenceRequirement,
  type TenantSettings,
} from '@legalio/shared/policy';
import {
  deriveContractStatus,
  normalizeDocumentStatus,
  normalizeDueDiligenceStatus,
  type DueDiligenceStatus,
} from '@legalio/types/domainStatus';
import { isTerminationNoticeDocument } from '@legalio/shared/dueDiligence';

/**
 * Tenant IDs used by pre-open-source deployments for records created before
 * multi-tenancy. They are treated as aliases of the default tenant so old
 * data stays visible after upgrading. Never use these for new records.
 */
export const LEGACY_DEFAULT_TENANT_ALIASES = new Set(['org-adapundi', 'tenant-adapundi']);

type DbGetter = () => any;
let getDb: DbGetter = () => ({});

export function bindTenantStore(getter: DbGetter): void {
  getDb = getter;
}

export function getDefaultTenant(): any | null {
  const db = getDb();
  const tenants: any[] = Array.isArray(db.tenants) ? db.tenants : [];
  return tenants.find((t) => t.isDefault) || tenants[0] || null;
}

/** ID of the tenant used when a record has no organization. */
export function getDefaultTenantId(): string {
  const db = getDb();
  return getDefaultTenant()?.id || db.activeTenantId || 'default';
}

export function isLegacyDefaultAlias(id: unknown): boolean {
  return typeof id === 'string' && LEGACY_DEFAULT_TENANT_ALIASES.has(id);
}

export function findTenant(tenantId?: string | null): any | null {
  const db = getDb();
  const tenants: any[] = Array.isArray(db.tenants) ? db.tenants : [];
  if (!tenantId || isLegacyDefaultAlias(tenantId)) return getDefaultTenant();
  return tenants.find((t) => t.id === tenantId || t.domainSlug === tenantId) || null;
}

export function getTenantSettings(tenantId?: string | null): TenantSettings {
  return resolveTenantSettings(findTenant(tenantId) || getDefaultTenant());
}

export function tenantDefaultCurrency(tenantId?: string | null): string {
  return getTenantSettings(tenantId).defaultCurrency;
}

export function tenantDisplayName(tenantId?: string | null): string {
  const tenant = findTenant(tenantId) || getDefaultTenant();
  return tenant?.name || tenant?.brandName || 'Organization';
}

/** Days remaining + lifecycle status, computed in the tenant's timezone. */
export function computeLifecycle(
  tenantId: string | null | undefined,
  endDate: string | undefined,
  current: unknown,
  autoRenewal?: boolean,
) {
  const settings = getTenantSettings(tenantId);
  const daysRemaining = daysUntil(endDate, settings.timezone);
  return {
    daysRemaining,
    status: deriveContractStatus({
      current,
      daysRemaining,
      expiryWarningDays: settings.expiryWarningDays,
      autoRenewal,
    }),
    settings,
  };
}

/* ------------------------------------------------------------------ */
/* Due diligence                                                       */
/* ------------------------------------------------------------------ */

export function checklistForPartner(partner: any): Array<DueDiligenceRequirement & { disabled?: boolean }> {
  const settings = getTenantSettings(partner?.organizationId);
  return buildDueDiligenceChecklist(settings, { counterpartyCountry: partner?.country || null });
}

const EXCLUDED_FROM_DD = /invoice|billing/i;

/**
 * Rebuild a partner's document list against the tenant's current checklist.
 * Documents already uploaded are always kept — items no longer required by
 * the policy are retained as optional extras instead of being dropped.
 */
export function normalizePartnerDocuments(partner: any): any[] {
  const settings = getTenantSettings(partner?.organizationId);
  const language = settings.language;
  const checklist = checklistForPartner(partner);
  const existing: any[] = (Array.isArray(partner?.daftar_dokumen_dd) ? partner.daftar_dokumen_dd : [])
    .filter((d: any) => d && !EXCLUDED_FROM_DD.test(String(d.nama || '')));
  const used = new Set<any>();

  const normalizeDoc = (doc: any) => {
    let files = Array.isArray(doc.files) ? doc.files : [];
    if (files.length === 0 && doc.linkDrive) {
      files = [{
        id: `legacy_${Math.random().toString(36).slice(2, 9)}`,
        fileName: `${doc.nama || 'document'}.pdf`,
        linkDrive: doc.linkDrive,
        uploadedAt: doc.uploadedAt || new Date().toISOString(),
        tanggalKadaluarsa: doc.tanggalKadaluarsa,
      }];
    }
    return { ...doc, files, status: normalizeDocumentStatus(doc.status) };
  };

  const result = checklist.map((req) => {
    const matched = existing.find((d) => !used.has(d) && matchesRequirement(req, d));
    if (matched) used.add(matched);
    const base = matched ? normalizeDoc(matched) : { status: 'Missing', files: [] };
    return {
      ...base,
      key: req.key,
      nama: localize(req.label, language),
      wajib: req.required,
      ...(req.expires ? { expires: true } : {}),
    };
  });

  for (const extra of existing) {
    if (used.has(extra)) continue;
    const doc = normalizeDoc(extra);
    // Empty placeholders from an older checklist carry no evidence; drop them.
    // Anything with a file, link, number or expiry date is kept.
    const hasEvidence = doc.files.length > 0 || doc.linkDrive || doc.nomorDokumen || doc.tanggalKadaluarsa || doc.status !== 'Missing';
    if (!hasEvidence) continue;
    result.push({ ...doc, wajib: false });
  }
  return result;
}

/** Due-diligence status derived from the (normalized) document list. */
export function computeDueDiligenceStatus(documents: any[]): DueDiligenceStatus {
  const docs = Array.isArray(documents) ? documents.filter((doc) => !isTerminationNoticeDocument(doc)) : [];
  if (docs.some((d) => normalizeDocumentStatus(d.status) === 'Expired')) return 'Expired';
  const required = docs.filter((d) => d.wajib);
  if (required.length === 0) {
    return docs.length > 0 && docs.every((d) => normalizeDocumentStatus(d.status) === 'Available') ? 'Complete' : 'Incomplete';
  }
  return required.every((d) => normalizeDocumentStatus(d.status) === 'Available') ? 'Complete' : 'Incomplete';
}

export { normalizeDueDiligenceStatus };

/* ------------------------------------------------------------------ */
/* AI prompt context                                                   */
/* ------------------------------------------------------------------ */

/**
 * Jurisdiction/industry context injected into AI prompts instead of the
 * previously hardcoded company, regulator and law names.
 */
export function aiPolicyContext(tenantId?: string | null) {
  const settings = getTenantSettings(tenantId);
  const country = getCountryPack(settings.countryCode);
  const industry = getIndustryPack(settings.industry);
  const regulators = country.regulators?.[industry.key] || [];
  return {
    organizationName: tenantDisplayName(tenantId),
    countryName: country.code === 'INTL' ? 'an international (multi-jurisdiction) context' : country.name,
    governingLaw: settings.governingLaw || localize(country.governingLaw, 'EN'),
    dataProtectionLaw: country.dataProtectionLaw,
    indirectTaxName: country.indirectTaxName,
    industryName: localize(industry.name, 'EN'),
    reviewFocus: industry.criticalClauses.map((c) => c.clause.en),
    clauseRules: industry.criticalClauses.map((c) => `${c.clause.en} — ${c.rule.en}`),
    complianceStandards: industry.complianceStandards,
    taxConsiderations: industry.taxConsiderations.map((c) => c.en),
    regulators,
    commercialDocumentLabel: industry.commercialDocument.label,
    responseLanguage:
      settings.language === 'ID' ? 'Indonesian (Bahasa Indonesia)' : settings.language === 'ZH' ? 'Simplified Chinese (简体中文)' : 'English',
    defaultCurrency: settings.defaultCurrency,
  };
}
