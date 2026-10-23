import { normalizeSpendingMonths } from './spendingMonths';
import { computeEvaluationScore } from './evaluationScoring';
import { createSpendingsRouter } from "./routes/spendings";
import { generateRedlineAnalysis, runContractRedlineAnalysis } from './redlineAnalysis';
import { createEvaluationsRouter } from "./routes/evaluations";
import { createPartnersRouter } from "./routes/partners";
import { upload } from './uploadMiddleware';
import { recalculateStatuses, seedReminderLedger, reminderScheduler, refreshContractLifecycles, rollForwardAutoRenewal, runReminderPass, stopReminderScheduler } from './reminderJobs';
import { generateContentWithRetryAndFallback, getEffectiveGeminiApiKey, ensureAiAvailable, getValidAiModel, withDocumentTranscriptField, extractAndCacheDocumentTranscript, formatGeminiError, aiLimits } from './aiClient';
import { normalizeParsedDate, computeContractEndDateFromDuration } from './documentParsing';
import { formatAmountForTenant, buildReminderEmail, sendSmtpEmail, daysUntilForTenant, mailTemplates, sendPlatformMail } from './mailHelpers';
import { ensureAllPartnersFolders, resolveActiveGoogleToken, getOrgFolderId, getPartnerCategoryFolderId, getFreshGoogleAccessToken, autoEnsureTenantGoogleResources } from './googleDrive';
import { backupLocalFilesToGoogleDrive } from './driveBackup';
import { authorizeUpload, serveUpload, getStore, getMimeType, UPLOAD_KINDS, saveUpload } from './uploadStorage';
import { googleCredentials } from './googleCredentialStore';
import { addActivityLog, isMatchingOrg, getRequestTenantId, orgContextOf, scopeOf, scopedRecords, assertRecordAccess, assertRecordWritable, logActivity } from './recordAccess';
import { refreshTenantProjection, db, saveDb, onDbSaved, demoData, migrateLegacyRecords, sanitizePartnerTags, syncAdderNames, DEFAULT_BRANDING, triggerAutoPushToGoogleSheet, sanitizeCountryCode, countryNameForPrompt, sanitizeIdentifiers, generateNextPartnerId, generateNextSpendingId, generateNextContractId, generateNextIOId, coreSaver } from './memoryDb';
import { createMailTemplateStore } from "./mailTemplateStore";
import { aiContext, AiLimitError, AiRateLimiter, aiLimitsFromEnv, boundChatHistory, boundWorkspaceContext, currentAiOrganization, recordAiTokens, reserveAiCall, runModelChain } from "./aiLimits";
import { verifyGoogleAccessToken } from "./googleAudience";
import { smtpTlsOptions } from "./smtpTls";
import { appendActivity, listActivity } from "./activityLog";
import { seedLedgerFromLegacy, createReminderScheduler, deliverDue as deliverDueReminders, enqueue as enqueueReminder, existingKeys as existingReminderKeys, planReminders, REMINDER_LOCK_KEY, schedulerOptionsFromEnv, type ReminderSender } from "./reminders";
import { backfillUploadOwners, eligibleOwners, newUploadKey, recordUploadOwner } from "./uploadOwnership";
import { componentLog, errorResponder, requestLogging } from "./logger";
import { sendApiError, sendRouteError, PublicError } from "./apiErrors";
import { validateBody } from "./validation";
import * as bodySchemas from "./schemas";
const log = componentLog("server");
import { forwardAsyncRouteErrors } from './asyncRoutes';
import { renameLegacyKeys, renameLegacyKeyTokens } from '@legalio/shared/fieldNames';
import { BULK_DATE_FIELDS, bulkDate, bulkNumber } from '@legalio/shared/bulkParse';
import { readBusinessRows, searchBusinessRows } from './normalizedCoreStore';
import "dotenv/config";
import { getPublicBaseUrl, normalizePublicUrl, saveInstallationPublicUrl } from './installationSettings';
import type { UITextOverrides } from '@legalio/types/uiTexts';
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import express from "express";
import { createSensitiveRateLimiter, trustProxySetting } from "./edgeConfig";
import { allocationInvoiceMonths, validateSpendingAllocations } from "@legalio/shared/spendingAllocations";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { buildMatrix as buildRbacMatrix, can, hasOrganizationScope, type OrgContext } from "./rbac";
import {
  RequestDenied, accessibleOrganizations, identityOf, isIdentityBanned, resolveIdentity, resolveLegacyContext, resolveOrganizationContext, sendError,
} from "./identity";
import { isConstraintViolation, isUniqueViolation, sql, withAdvisoryLock } from "./db";
import { ensureSchema } from "./schema";
import { BETTER_AUTH_ALLOWED, createAuthorizationMiddleware, isBetterAuthPathAllowed } from "./routePolicies";
import { createOrganizationScope, filterRecords, recordVisible, normalizeDepartmentName, teamsOf, type RecordKind } from "./recordScope";
import { IS_TEST_MODE, APP_DATA_DIR } from "./runtimePaths";
import { cosStore, keyFromLink, memoryStore, type CosConfig, type ObjectStore } from "./objectStore";
import {
  ApiError, appendAudit, buildTenantProjection, isEmptyInstall, readIntegration, writeIntegrationRow, patchOrganizationSettings, readOrganizationSettings, patchIntegration,
} from "./organizationSettingsStore";
import { auditActorFor, capabilitiesOf, createOrganizationAdminRouter, hasApprovalInvitation, identityResponse, selectActiveOrganization } from "./organizationAdminRoutes";
import { createOrganizationRecord, seedOrganizationsFromDataset } from "./organizationProvisioning";
import { GoogleGenAI, Type } from "@google/genai";
import { OAuth2Client } from "google-auth-library";
import { toNodeHandler } from "better-auth/node";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  auth as betterAuthInstance,
  saveCoreData,
  loadCoreData,
  setVerificationMailer,
  reloadAuthConfiguration,
} from "./lib/auth";
import {
  authConsoleRouter,
  setConsoleDbReference,
  ensureUserAccountsExist,
} from "./authConsoleRoutes";
import { createDocumentRouter } from "./documentRoutes";
import { createApprovalRouter } from "./approvalRoutes";
import { createCoreSaver } from "./coreDataStore";
import { resetSyncCache } from "./normalizedCoreStore";
import { isDemoAccountEmail, removeDemoAccounts } from "./demoAccounts";
import {
  formatContractFileName,
  formatIOFileName,
  formatInvoiceFileName,
  formatBillingFileName,
  formatDueDiligenceFileName,
} from "@legalio/shared/fileNaming";
import {
  getExchangeRates,
  getHistoricalExchangeRate,
  getUsdRate,
} from "@legalio/shared/currencyRates";
import {
  createDriveFolder,
  createNewDriveFolderInParent,
  getOrCreateDriveFolder,
  uploadFileToDrive,
  extractFolderIdFromLink,
  sanitizeParentFolderId,
  setInvalidTokenCallback,
  setRefreshTokenGetter,
  createSpreadsheetInFolder,
  createGoogleDocInFolder,
} from "./lib/googleDriveSync";
import {
  loadServiceAccountCredentials,
  hasServiceAccountCredentials,
  getGoogleSheetsClient,
  setStoredServiceAccountProvider,
} from "./lib/googleServiceAccountAuth";
import { checkCosInput, createGoogleCredentialStore, createGoogleCredentialsRouter } from "./googleCredentials";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { contractLifecycle, contractLifecycleMode, validateContractTermination } from "@legalio/shared/contractLifecycle";
import { parseTerminationFile, type TerminationFile } from "./contractTermination";
import { CONTRACT_TERMINATION_TRANSLATIONS } from "@legalio/shared/i18n/contractTermination";
import {
  bindTenantStore,
  getDefaultTenantId,
  getTenantSettings,
  tenantDefaultCurrency,
  tenantDisplayName,
  computeLifecycle,
  normalizePartnerDocuments,
  computeDueDiligenceStatus,
  aiPolicyContext,
  findTenant,
  isLegacyDefaultAlias,
} from "./tenantPolicy";
import {
  resolveTenantSettings,
  todayInTimezone,
  listCountryPacks,
  listIndustryPacks,
  buildDueDiligenceChecklist,
  getCountryPack,
  getIndustryPack,
  localize,
} from "@legalio/shared/policy";
import {
  normalizeContractStatus,
  normalizeApprovalStatus,
  normalizeDueDiligenceStatus,
  normalizeDocumentStatus,
} from "@legalio/types/domainStatus";
import {
  convertToUsdWithFallback,
  getDefaultUsdRate,
  normalizeCurrencyCode,
} from "@legalio/shared/currencyUtils";
import { buildDemoDataset, DEMO_TENANTS } from "@legalio/shared/data/demoDataset";
import { localizeApiMessages } from "./serverMessages";
import {
  buildCheapOcrContents,
  globalOcrCache,
  computeInputSha256,
  setCachedTranscript,
} from "./lib/cheapOcrPipeline";

const app = express();
forwardAsyncRouteErrors(app);
// This app is only ever meant to run behind a reverse proxy (nginx, Cloud
// Run, Codespaces' tunnel — see README: "keep port 3000 closed to the
// internet"), so trust X-Forwarded-* only from loopback/private-range hops
// (override with TRUST_PROXY: a hop count or address list; see edgeConfig.ts).
// `true` would let any client choose its own req.ip with a forged header.
app.set("trust proxy", trustProxySetting());
app.use(requestLogging());
app.use(createSensitiveRateLimiter());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
// Older clients and CSV files still send the Indonesian field names; they are mapped once, here. Responses never use them.
const LEGACY_FIELD_ROUTES = /^\/api\/(partners|contracts|ios|partner-spendings|partner-evaluations|bulk-import|notification-logs)(\/|$)/;
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.body && typeof req.body === "object" && LEGACY_FIELD_ROUTES.test(req.path)) req.body = renameLegacyKeys(req.body);
  next();
});
// Error/status messages follow the UI language (x-app-language header).
app.use("/api", localizeApiMessages);

/*
 * Tenant-boundaries PRD §5/§10: Better Auth is reachable only through the
 * enumerated sign-in/self-service endpoints; Admin- and Organization-plugin
 * routes are denied in favour of the canonical services. Every other /api
 * operation passes the declared route policy (server/routePolicies.ts).
 */
app.all(["/api/auth", "/api/auth/*"], async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith("/api/auth/google/")) return next();
  const path = req.path.replace(/\/$/, "");
  if (!isBetterAuthPathAllowed(path)) return sendError(req, res, 404, "RESOURCE_NOT_FOUND");
  if (BETTER_AUTH_ALLOWED[path] === "self") {
    try {
      await resolveIdentity(sql, req);
    } catch (err: any) {
      if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
      throw err;
    }
  }
  return toNodeHandler(betterAuthInstance)(req, res);
});
app.use(createAuthorizationMiddleware(sql));
// Lets AI budgets and caches know the organization without threading it through every helper.
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  aiContext.run({ organizationId: (req as any).orgContext?.organizationId ?? null }, next);
});

/* Legacy RBAC adapters (PRD §10.1): server-resolved actor, explicit catalogs, no wildcard. */
app.get("/api/rbac/me", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  let ctx: OrgContext | null = null;
  try { ctx = await resolveLegacyContext(sql, identity, req, { includeBody: false }); } catch { ctx = null; }
  res.json({
    ok: true,
    identity: { id: identity.userId, platformRole: identity.platformRole },
    platformPermissions: identity.platformPermissions,
    context: ctx ? capabilitiesOf(ctx) : null,
    permissions: ctx ? ctx.permissions : [],
  });
});
app.get("/api/rbac/matrix", (_req: express.Request, res: express.Response) => res.json({ ok: true, ...buildRbacMatrix() }));
app.get("/api/rbac/roles", (_req: express.Request, res: express.Response) => {
  const matrix = buildRbacMatrix();
  res.json({ ok: true, platformRoles: matrix.platformRoles.map((r) => r.role), tenantRoles: matrix.tenantRoles.map((r) => r.role) });
});
app.post("/api/rbac/check", async (req: express.Request, res: express.Response) => {
  const permission = req.body?.permission;
  if (typeof permission !== "string") return sendError(req, res, 400, "INVALID_INPUT", "permission is required.");
  try {
    const ctx = await resolveLegacyContext(sql, identityOf(req), req, { includeBody: false });
    return res.json({ ok: true, allow: can(ctx, permission) });
  } catch (err: any) {
    if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
    throw err;
  }
});
app.use("/uploads", (req: express.Request, res: express.Response, next: express.NextFunction) => { authorizeUpload(req, res, next).catch(next); },
  (req: express.Request, res: express.Response, next: express.NextFunction) => { serveUpload(req, res, next).catch(next); });
/*
 * There are no default credentials. The first admin is created on the
 * first-run setup page (POST /api/system/setup). For automated deploys,
 * setting both DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD pre-creates it
 * instead; SEED_DEMO_ADMIN=false stops that once your own admin exists.
 */
const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || "").trim().toLowerCase();
const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || "";
const shouldSeedDemoAdmin = process.env.SEED_DEMO_ADMIN !== "false";
// The password older releases seeded the admin with; only kept to warn installs still using it.
const LEGACY_DEFAULT_ADMIN_PASSWORD = "123456789";
/*
 * Startup (PRD §14.1): creates or completes the schema on the connected pool, and on a fresh install seeds the demo workspace.
 * Everything that reads or writes the database runs here; main.ts connects first and awaits it before serving this app.
 */
export async function init() {
  // Onboarding retries init() after a failure, possibly against another database: forget what an earlier attempt wrote.
  resetSyncCache(sql);
  await ensureSchema();
  await reloadAuthConfiguration();
  await googleCredentials.init();
  const freshInstall = await isEmptyInstall(sql);
  if (freshInstall && !IS_TEST_MODE) {
    await seedOrganizationsFromDataset(sql, demoData, {
      bootstrapSuperuser: shouldSeedDemoAdmin && demoAdminEmail && demoAdminPassword
        ? { id: "demo-admin", email: demoAdminEmail, name: "Legalio Admin" }
        : undefined,
    });
  }
  if (!IS_TEST_MODE && shouldSeedDemoAdmin && demoAdminEmail && demoAdminPassword
    && !await sql.get(`SELECT 1 FROM "user" WHERE id = 'demo-admin' OR LOWER(email) = ?`, demoAdminEmail)) {
    await seedOrganizationsFromDataset(sql, { tenants: [], departments: [], allowedUsers: [] }, {
      bootstrapSuperuser: { id: "demo-admin", email: demoAdminEmail, name: "Legalio Admin" },
    });
    log.info(`Seeded bootstrap superuser: ${demoAdminEmail}`);
  }
  const initialData = await loadCoreData();
  const hasCoreData = ["partners", "contracts", "ios", "spendings", "evaluations", "notifications", "templates", "activityLogs"]
    .some((key) => Array.isArray((initialData as any)[key]) && (initialData as any)[key].length > 0);

  // An initialized workspace may intentionally contain no business records after a reset.
  if (hasCoreData || !freshInstall) {
    Object.assign(db, initialData, {
      branding: initialData.branding ?? db.branding,
      googleConfig: initialData.googleConfig ?? db.googleConfig,
      newsTicker: initialData.newsTicker ?? db.newsTicker,
    });
    log.info("Database loaded from PostgreSQL as the source of truth.");
  } else {
    Object.assign(db, {
      allowedUsers: initialData.allowedUsers || [],
      branding: initialData.branding || db.branding,
      googleConfig: initialData.googleConfig || db.googleConfig,
      newsTicker: initialData.newsTicker || db.newsTicker,
    });
    log.info("The database is empty; using seed defaults for the first initialization.");
  }
  // Only the canonical tables define organizations; legacy snapshot rows are migration input.
  db.tenants = [];
  delete db.departments;
  delete db.activeTenantId;
  await refreshTenantProjection();
  migrateLegacyRecords();
  // Demo-dataset logins share DEMO_ADMIN_PASSWORD, so a production server never keeps them —
  // including servers that created them before this rule existed.
  if (process.env.NODE_ENV === "production") {
    const { allowedUsers, removed } = await removeDemoAccounts(sql, db.allowedUsers || []);
    db.allowedUsers = allowedUsers;
    if (removed) log.info(`Production: removed ${removed} demo login account(s).`);
  }
  await saveDb();
  await backfillUploadOwners(sql, UPLOAD_KINDS.flatMap(([, collection]) => (db[collection] || []).map((record: any) => ({ organizationId: record.organizationId, record }))));
  // The auth console reads platform configuration (SMTP) from `db`; it no longer
  // hydrates identities, memberships or organizations from this projection.
  setConsoleDbReference(db, saveDb, getStore, async (organizationId?: string) => {
    if (organizationId) await onOrganizationChanged(organizationId);
    else await refreshTenantProjection();
  });
  if (!IS_TEST_MODE) {
    await ensureUserAccountsExist();
    ensureAllPartnersFolders().catch((err) =>
      log.error("Startup category folder provisioning error:", err),
    );
  }
  if (db.spendings && db.spendings.length > 0) {
    let legacyCounter = 1;
    let changed = false;
    for (const sp of db.spendings) {
      if (!sp.id || sp.id.startsWith("spd-")) {
        sp.id = `SP${String(legacyCounter).padStart(4, "0")}`;
        legacyCounter++;
        changed = true;
      }
    }
    if (changed) {
      await saveDb();
    }
  }
  if (db.partners && Array.isArray(db.partners)) {
    db.partners = db.partners.map((p) => ({
      ...p,
      tags: sanitizePartnerTags(p.tags),
    }));
    await saveDb();
  }
  syncAdderNames();
  await saveDb();
  await recalculateStatuses();
  await seedReminderLedger();
  reminderScheduler.start();
}
async function getBetterAuthSession(req) {
  try {
    const identity = identityOf(req);
    return { user: { id: identity.userId, email: identity.email, name: identity.name, platformRole: identity.platformRole } };
  } catch {
    return null;
  }
}
async function getClerkUserEmail(req) {
  return (await getBetterAuthSession(req))?.user?.email || null;
}
/**
 * Identity adapter (PRD §10.1): explicit platformRole and own memberships.
 * GET never creates allowlist rows, memberships or selections.
 */
app.get("/api/user/my-role", async (req: express.Request, res: express.Response) => {
  let identity;
  try {
    identity = identityOf(req);
  } catch (err: any) {
    // The start-up probe treats "signed out" as an expected answer.
    if (req.query.probe === "1") return res.status(204).end();
    return sendError(req, res, err?.status || 401, err?.error || "UNAUTHENTICATED");
  }
  const me = await identityResponse(sql, identity);
  res.json({ ...me, email: identity.email, name: identity.name, platformRole: identity.platformRole, loginTime: new Date().toISOString() });
});
// Dashboard news ticker (optional module, off by default): 5 short
// regulatory headlines for the tenant's industry and country, written in the
// tenant's configured language (Settings > Organization & region). Refreshed
// via the AI provider at most once every 7 days, cached per tenant, and
// regenerated immediately if the tenant's language or industry pack changes.
const NEWS_TICKER_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
function newsTickerPrompt(tenantId: string, grounded: boolean): string {
  const settings = getTenantSettings(tenantId);
  const ctx = aiPolicyContext(tenantId);
  const topic = getIndustryPack(settings.industry).newsTopic;
  const regulators = ctx.regulators.length > 0 ? ` Prioritise updates from: ${ctx.regulators.join(", ")}.` : "";
  return `You are a regulatory research assistant. ${grounded ? "Use Google Search to find" : "From your knowledge, describe"} RECENT developments (last few months) in ${topic} relevant to organizations operating in ${ctx.countryName}.${regulators}

Write EXACTLY 5 short news-ticker headlines (at most about 20 words each) in ${ctx.responseLanguage}.

Output format: ONLY the 5 headlines separated by " | " (space-pipe-space), no numbering, no markdown, no introduction or closing.

${grounded ? "Every headline must be supported by the search results." : "Speak in general terms."} Never invent regulation numbers or dates you are not certain of.`;
}

async function generateNewsTickerText(tenantId: string): Promise<string> {
  try {
    const response = await generateContentWithRetryAndFallback({
      contents: newsTickerPrompt(tenantId, true),
      config: { tools: [{ googleSearch: {} }] },
    });
    return String((response as any).text || "").trim();
  } catch (groundedErr: any) {
    // The search-grounding tool has a much stricter quota than plain
    // generation; fall back to an un-grounded call rather than failing.
    log.warn(
      `[News Ticker] Grounded generation failed (${(groundedErr?.message || "").slice(0, 160)}), falling back to plain generation...`,
    );
    const response = await generateContentWithRetryAndFallback({
      contents: newsTickerPrompt(tenantId, false),
    });
    return String((response as any).text || "").trim();
  }
}

app.get("/api/dashboard/news-ticker", async (req: express.Request, res: express.Response) => {
  const tenantId = getRequestTenantId(req);
  const settings = getTenantSettings(tenantId);
  if (!settings.modules.newsTicker || !settings.modules.aiAssistant) {
    return res.json({ items: [], disabled: true });
  }
  if (!db.newsTicker || typeof db.newsTicker !== "object" || !db.newsTicker.byTenant) {
    db.newsTicker = { byTenant: {} };
  }
  const ticker = db.newsTicker.byTenant[tenantId] || { items: [], lastGeneratedAt: null };
  // Regenerate right away if the org's language or industry pack changed since the cached
  // headlines were written — otherwise a settings change would keep showing old-language or
  // wrong-industry news for up to 7 days.
  const settingsChanged = ticker.language !== settings.language || ticker.industry !== settings.industry;
  const isStale =
    !ticker.lastGeneratedAt ||
    !Array.isArray(ticker.items) ||
    ticker.items.length === 0 ||
    settingsChanged ||
    Date.now() - new Date(ticker.lastGeneratedAt).getTime() > NEWS_TICKER_REFRESH_MS;

  if (!isStale) {
    return res.json({ items: ticker.items, lastGeneratedAt: ticker.lastGeneratedAt, cached: true });
  }
  if (!getEffectiveGeminiApiKey()) {
    return res.json({ items: [], disabled: true });
  }

  try {
    const rawText = await generateNewsTickerText(tenantId);
    const items = rawText
      .split("|")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (items.length === 0) {
      throw new Error("The AI provider returned no headlines.");
    }

    const entry = { items, lastGeneratedAt: new Date().toISOString(), language: settings.language, industry: settings.industry };
    db.newsTicker.byTenant[tenantId] = entry;
    await saveDb();
    res.json({ items: entry.items, lastGeneratedAt: entry.lastGeneratedAt, cached: false });
  } catch (err: any) {
    log.error("Error generating news ticker:", err);
    // A stale cache in the previous language/industry beats nothing, unless the
    // settings just changed and no fresh headlines exist yet for the new choice.
    if (Array.isArray(ticker.items) && ticker.items.length > 0 && !settingsChanged) {
      return res.json({ items: ticker.items, lastGeneratedAt: ticker.lastGeneratedAt, cached: true, stale: true });
    }
    sendRouteError(req, res, err, "request failed", "Failed to load the news ticker.", { status: 500 });
  }
});

/** Department names for operational forms: the verified organization, scoped to the caller (no fallback). */
app.get("/api/departments", async (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const rows = await sql.all('SELECT id, name FROM team WHERE "organizationId" = ? ORDER BY lower(name), id', ctx.organizationId) as any[];
  const visible = hasOrganizationScope(ctx) ? rows : rows.filter((r) => ctx.departmentIds.includes(r.id));
  res.json({ success: true, departments: visible.map((r) => r.name), items: visible });
});
/** Records the caller's own sign-in/sign-out in their session's organization (if any). */
app.post("/api/user/log-activity", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const actionType = req.body?.actionType === "LOGOUT" ? "LOGOUT" : "LOGIN";
  const orgId = identity.sessionDefaultOrganizationId;
  let ctx: OrgContext | null = null;
  try { ctx = orgId ? await resolveOrganizationContext(sql, identity, orgId) : null; } catch { ctx = null; }
  await addActivityLog("", "", "", actionType, "AUTH", actionType === "LOGOUT" ? "Signed out" : "Signed in", req, ctx?.organizationId ?? null);
  res.json({ success: true });
});
/**
 * Resolve the verified e-mail behind a Google OAuth access token: the token must have been issued to this
 * installation's OAuth client (tokeninfo audience) and Google must report the e-mail as verified.
 * `verifyGoogleToken` is swappable so tests can run without contacting Google.
 */
let verifyGoogleToken: (accessToken: unknown, clientId: string | null | undefined) => Promise<string | null> = verifyGoogleAccessToken;
function verifyGoogleAccessTokenEmail(accessToken: unknown): Promise<string | null> {
  return verifyGoogleToken(accessToken, googleCredentials.getOAuthClient().clientId);
}
/*
 * Provider secrets never leave the server (PRD §5.1). Clients receive a
 * masked hint; a masked value posted back means "keep the stored secret".
 */
const SECRET_MASK_CHAR = "•";
function maskSecret(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return "";
  return `${SECRET_MASK_CHAR.repeat(8)}${text.length > 8 ? text.slice(-4) : ""}`;
}
function isMaskedSecret(value: unknown): boolean {
  const text = String(value ?? "");
  return text.includes(SECRET_MASK_CHAR) || /^\*{4,}$/.test(text);
}
function redactProviderConfig(config: any) {
  const { accessToken, refreshToken, smtpPassword, geminiApiKey, ...rest } = config || {};
  return {
    ...rest,
    geminiApiKey: maskSecret(geminiApiKey),
    hasGeminiApiKey: Boolean(geminiApiKey),
    smtpPassword: maskSecret(smtpPassword),
    hasSmtpPassword: Boolean(smtpPassword),
    hasGoogleSession: Boolean(accessToken || refreshToken),
  };
}
/**
 * Admin check based ONLY on the verified session identity. Earlier versions
 * also trusted e-mail addresses supplied in headers, body or query string;
 * the unused `_fallback*` parameters are kept for call-site compatibility.
 */
/**
 * Platform-administrator check from the verified identity only. Routes that
 * call this are already gated by a platform policy; this is defence in depth.
 * A tenant admin membership never makes this true.
 */
async function checkIsAdmin(req: express.Request, _fallbackEmail?: string, _fallbackName?: string) {
  try {
    const identity = identityOf(req);
    return { isAdmin: identity.platformRole === "superuser", adminEmail: identity.email, adminName: identity.name || "Admin" };
  } catch {
    return { isAdmin: false, adminEmail: "", adminName: "" };
  }
}
app.get("/api/user/allowed-users", (req: express.Request, res: express.Response) => {
  syncAdderNames();
  res.json(db.allowedUsers);
});
app.post("/api/user/allowed-users", async (req: express.Request, res: express.Response) => {
  const { email, name, role, department, adminEmail, adminName } = req.body;
  const adminCheck = await checkIsAdmin(req, adminEmail, adminName);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can manage whitelist." });
  }
  if (!email || !name || !role) {
    return res
      .status(400)
      .json({ error: "Email, Nama, dan Role wajib diisi." });
  }
  const exists = db.allowedUsers.some(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (exists) {
    return res
      .status(400)
      .json({ error: `Email '${email}' sudah ada dalam daftar whitelist.` });
  }
  const newUser = {
    id: `usr-${Date.now()}`,
    email: email.trim().toLowerCase(),
    name,
    role,
    department: department || "Umum",
    status: "Active",
    addedBy: adminCheck.adminName || "Admin",
    addedByEmail: adminCheck.adminEmail,
    createdAt: new Date().toISOString(),
  };
  db.allowedUsers.unshift(newUser);
  syncAdderNames();
  await saveDb();
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "ADD_USER",
    "ADMIN",
    `Menambahkan email '${email}' (${name} - ${role}) ke whitelist akses`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, user: newUser });
});
app.put("/api/user/allowed-users/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { role, department, status, name, adminEmail, adminName } = req.body;
  const adminCheck = await checkIsAdmin(req, adminEmail, adminName);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can manage whitelist." });
  }
  const user = db.allowedUsers.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  }
  if (user.role === "Admin" && role && role !== "Admin") {
    const adminCount = db.allowedUsers.filter((u) => u.role === "Admin").length;
    if (adminCount <= 1) {
      return res
        .status(400)
        .json({
          error:
            "Sistem membutuhkan minimal 1 akun Admin aktif. Buat Admin lain terlebih dahulu sebelum mengubah role akun ini.",
        });
    }
  }
  if (role) user.role = role;
  if (department) user.department = department;
  if (status) user.status = status;
  if (name) user.name = name;
  syncAdderNames();
  await saveDb();
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "UPDATE",
    "ADMIN",
    `Memperbarui hak akses/role pengguna '${user.email}' (${user.name}) menjadi '${user.role}'`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, user });
});
app.delete("/api/user/allowed-users/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { adminEmail, adminName } = req.query;
  const adminCheck = await checkIsAdmin(req, adminEmail as string, adminName as string);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can manage whitelist." });
  }
  const user = db.allowedUsers.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  }
  if (
    adminCheck.adminEmail &&
    user.email.toLowerCase() === adminCheck.adminEmail.toLowerCase()
  ) {
    return res
      .status(400)
      .json({
        error:
          "Anda tidak dapat menghapus akun Anda sendiri saat sedang login.",
      });
  }
  if (user.role === "Admin") {
    const adminCount = db.allowedUsers.filter((u) => u.role === "Admin").length;
    if (adminCount <= 1) {
      return res
        .status(400)
        .json({
          error:
            "Tidak dapat menghapus satu-satunya akun Admin yang tersisa di sistem.",
        });
    }
  }
  db.allowedUsers = db.allowedUsers.filter((u) => u.id !== id);
  await saveDb();
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "REMOVE_USER",
    "ADMIN",
    `Mencabut akses email '${user.email}' (${user.name}) dari whitelist`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.post("/api/user/reset-password", async (req: express.Request, res: express.Response) => {
  const { email, newPassword, adminEmail, adminName } = req.body;
  const adminCheck = await checkIsAdmin(req, adminEmail, adminName);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({
        error: "Forbidden: Hanya Admin yang dapat mereset password pengguna.",
      });
  }
  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ error: "Email dan Password Baru wajib diisi." });
  }
  if (newPassword.trim().length < 6) {
    return res.status(400).json({ error: "Password minimal 6 karakter." });
  }
  try {
    const authDb = sql;
    const trimmedEmail = email.trim().toLowerCase();
    let targetUser: any = await authDb.get('SELECT id, name, email FROM "user" WHERE LOWER(email) = ?', trimmedEmail);
    const hashedPassword = await hashPassword(newPassword.trim());
    const nowIso = new Date().toISOString();
    if (!targetUser) {
      const allowedUser = db.allowedUsers.find(
        (u) => u.email.toLowerCase() === trimmedEmail,
      );
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const userName = allowedUser?.name || email.split("@")[0];
      const userRole = "user"; // platform role only; organization access comes from memberships
      await authDb.run(`
        INSERT INTO "user" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
        VALUES (?, ?, ?, true, ?, false, ?, ?)
      `, userId, userName, trimmedEmail, userRole, nowIso, nowIso);
      const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await authDb.run(`
        INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (?, ?, 'credential', ?, ?, ?, ?)
      `, accountId, userId, userId, hashedPassword, nowIso, nowIso);
      targetUser = { id: userId, name: userName, email: trimmedEmail };
    } else {
      const existingAccount: any = await authDb.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'credential'`, targetUser.id);
      if (existingAccount) {
        await authDb.run('UPDATE account SET password = ?, "updatedAt" = ? WHERE id = ?', hashedPassword, nowIso, existingAccount.id);
      } else {
        const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        await authDb.run(`
          INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
          VALUES (?, ?, 'credential', ?, ?, ?, ?)
        `, accountId, targetUser.id, targetUser.id, hashedPassword, nowIso, nowIso);
      }
      await authDb.run('UPDATE "user" SET banned = false, "banReason" = NULL, "updatedAt" = ? WHERE id = ?', nowIso, targetUser.id);
    }
    await addActivityLog(
      adminCheck.adminEmail || "admin@app",
      adminCheck.adminName || "Admin",
      "Admin",
      "UPDATE",
      "ADMIN",
      `Mereset password untuk pengguna '${email}'`,
      req,
    );
    res.json({
      success: true,
      message: `Password untuk '${email}' berhasil direset!`,
    });
  } catch (err) {
    log.error("Server error resetting password:", err);
    sendRouteError(req, res, err, "request failed", "Terjadi kesalahan saat mereset password.", { status: 500 });
  }
});
/** Operational activity for the selected organization only (History drawer, tenant.audit.read). */
app.get("/api/activity-logs", async (req: express.Request, res: express.Response) => {
  const page = await listActivity(sql, getRequestTenantId(req), { limit: req.query.limit, offset: req.query.offset });
  // Body stays the array older clients expect (newest first); paging metadata travels in headers.
  res.set({ "X-Total-Count": String(page.total), "X-Limit": String(page.limit), "X-Offset": String(page.offset) });
  res.json(page.rows);
});
app.get("/api/search", async (req: express.Request, res: express.Response) => {
  const organizationId = getRequestTenantId(req);
  const kinds: Record<string, RecordKind> = { partners: 'partner', contracts: 'contract', insertion_orders: 'io', spendings: 'spending', evaluations: 'evaluation' };
  const hits = await searchBusinessRows(sql, organizationId, String(req.query.q || '').slice(0, 1000));
  const permitted = [];
  for (const hit of hits) {
    const kind = kinds[hit.entity_type];
    if (!kind) continue;
    const record = (await readBusinessRows(sql, hit.entity_type, organizationId, [hit.entity_id]))[0];
    if (record && recordVisible(orgContextOf(req), scopeOf(req), kind, record)) permitted.push(hit);
  }
  res.json({ results: permitted.slice(0, 50), total: permitted.length });
});
app.get("/api/exchange-rates", async (req: express.Request, res: express.Response) => {
  try {
    const currencies = Array.from(
      new Set([
        ...(db.spendings || []).map((s) => s.currency),
        ...(db.contracts || []).map((c) => c.currency),
        ...(db.ios || []).map((i) => i.currency),
      ].filter(Boolean).map((c) => normalizeCurrencyCode(c))),
    );
    const rates = await getExchangeRates("", "", currencies);
    res.json({ USD: 1, ...rates });
  } catch (err) {
    sendRouteError(req, res, err, "request failed", "Could not load exchange rates.", { status: 500 });
  }
});
app.get("/api/exchange-rate-historical", async (req: express.Request, res: express.Response) => {
  try {
    const currency = normalizeCurrencyCode(req.query.currency, "USD");
    const date = String(req.query.date || "");
    const { rate, isFallback } = await getUsdRate(currency);
    res.json({ currency, date, rate, isFallback });
  } catch (err) {
    sendRouteError(req, res, err, "request failed", "Could not load the exchange rate.", { status: 500 });
  }
});

app.post("/api/contracts/export-google-docs", async (req: express.Request, res: express.Response) => {
  try {
    const title = req.body.title || req.body.docTitle || "Partnership Agreement";
    const contentHtml = req.body.contentHtml || req.body.htmlContent || req.body.html;
    const partnerName = req.body.partnerName || req.body.partner_name || req.body.partnerId;

    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Title dan contentHtml wajib diisi." });
    }
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] ||
      req.body.accessToken ||
      db.googleConfig?.accessToken
    );
    const targetOrgId = getRequestTenantId(req);

    // Only this organization's folder tree — never the platform master root.
    let targetFolderId = (await getOrgFolderId(targetOrgId, token)).id;
    if (partnerName) {
      try {
        const partner = (await scopedRecords(req, "partner", db.partners)).find(
          (p: any) => p.partner_name?.toLowerCase() === String(partnerName).toLowerCase() || p.partner_id === partnerName
        );
        if (partner) {
          targetFolderId = await getPartnerCategoryFolderId(
            partner,
            "Folder Kontrak",
            token,
            targetOrgId
          );
        }
      } catch (fErr) {
        log.warn("Folder resolve fallback:", fErr);
      }
    }

    if (!targetFolderId) {
      return res.status(409).json({ error: "GOOGLE_FOLDER_UNAVAILABLE", message: "This organization has no Google Drive folder mapping." });
    }
    const docResult = await createGoogleDocInFolder(
      title,
      contentHtml,
      targetFolderId,
      token
    );

    await addActivityLog("", "", "", "DOCUMENT_EXPORT", "DOCUMENTS", `Exported '${title}' to Google Docs`, req, undefined, { documentId: docResult.id }).catch((err) => log.warn("Could not record export activity:", err));
    res.json({
      success: true,
      documentId: docResult.id,
      documentUrl: docResult.documentUrl,
      webViewLink: docResult.documentUrl,
      data: {
        documentId: docResult.id,
        documentUrl: docResult.documentUrl,
        webViewLink: docResult.documentUrl,
      },
    });
  } catch (error: any) {
    log.error("Error creating Google Doc:", error);
    sendRouteError(req, res, error, "request failed", "Gagal membuat dokumen Google Docs.", { status: 500 });
  }
});

// Aggregation Endpoint for Fast Initial Data Load (replaces multi-endpoint polling)
/**
 * Operational workspace payload (PRD §11.4): one verified organization,
 * department-scoped before any client aggregation, no tenant directory and
 * no provider configuration — only non-sensitive service availability.
 */
/** Admin UI-text overrides saved before the field rename carry old keys; they follow their texts to the new keys. */
function withCurrentUiTextKeys(overrides: Record<string, Record<string, string>>) {
  return Object.fromEntries(Object.entries(overrides).map(([language, texts]) => [
    language,
    Object.fromEntries(Object.entries(texts || {})
      .filter(([key]) => renameLegacyKeyTokens(key) === key || !(renameLegacyKeyTokens(key) in texts))
      .map(([key, text]) => [renameLegacyKeyTokens(key), text])),
  ]));
}
app.get("/api/init-data", async (req: express.Request, res: express.Response) => {
  await refreshContractLifecycles();
  const organizationId = getRequestTenantId(req);
  const settings = getTenantSettings(organizationId);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    organizationId,
    contracts: await scopedRecords(req, "contract", db.contracts),
    ios: await scopedRecords(req, "io", db.ios),
    partners: await scopedRecords(req, "partner", db.partners),
    notifications: await scopedRecords(req, "notification", db.notifications),
    evaluations: await scopedRecords(req, "evaluation", db.evaluations),
    spendings: await scopedRecords(req, "spending", db.spendings),
    services: {
      aiAvailable: Boolean(getEffectiveGeminiApiKey()) && settings.modules.aiAssistant,
      googleUploadsAvailable: Boolean(sanitizeParentFolderId(db.googleConfig?.driveFolderId)) &&
        Boolean(db.googleConfig?.accessToken || db.googleConfig?.refreshToken || hasServiceAccountCredentials()),
    },
    timestamp: Date.now(),
  });
});

app.get("/api/contracts", async (req: express.Request, res: express.Response) => {
  await refreshContractLifecycles();
  const contractsList = await scopedRecords(req, "contract", db.contracts);
  const result = contractsList.map((c) => {
    const cur = normalizeCurrencyCode(c.currency, tenantDefaultCurrency(c.organizationId));
    const amt = Number(c.contract_value) || 0;
    const usdVal =
      c.contract_value_usd !== void 0 && c.contract_value_usd !== null
        ? c.contract_value_usd
        : cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
    return {
      ...c,
      currency: cur,
      contract_value_usd: usdVal,
    };
  });
  res.json(result);
});
app.post("/api/contracts/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `contracts:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const startTime = Date.now();
    const prompt = `You are an expert legal contract analyst. Our organization is "${ctx.organizationName}" (${ctx.industryName}, primary jurisdiction: ${ctx.countryName}). Extract the following from this contract so it can be registered in our contract repository. The contract may be written in any language and governed by any jurisdiction.

1. "document_type": "Agreement Addendum" if this is an amendment, addendum, variation or extension; otherwise "Master Agreement".
2. "contract_title": the full official title of the agreement.
3. "partner_name": the full legal name of the counterparty — the party that is NOT ${ctx.organizationName}.
4. "contract_number": the contract reference number issued by ${ctx.organizationName}. When the document carries two reference numbers (ours and the counterparty's), prefer the one issued by ${ctx.organizationName}; if ours cannot be identified, return the first reference number shown.
5. "parent_contract_number": for an addendum, the reference number of the master agreement it amends; otherwise "".
6. "start_date": the effective (or signing) date as ISO 8601 "YYYY-MM-DD".
7. "end_date": the expiry date as "YYYY-MM-DD", computed precisely:
   a. An explicit end date without automatic renewal: use it as written.
   b. A relative term ("valid for 1 year from the start date"): end date = start date + term − 1 day (e.g. start 2024-11-04, 1 year → 2025-11-03; 6 months → 2025-05-03).
   c. A fixed end date plus automatic renewal for another period: add one renewal period to the written end date and set auto_renewal to true.
   d. Evergreen / renews until terminated by either party: return the day before the start date in year 9999 (start 2024-11-04 → "9999-11-03") and set auto_renewal to true.
   e. An extension addendum: compute the new end date from the previous term's end date.
8. "term_clause": quote verbatim the term/renewal clause.
9. "agreement_duration": the term as short text (e.g. "1 year", "6 months", "Until terminated").
10. "contract_value": the total committed contract value as a number, or 0 when the value is variable, commission-based, or not stated.
11. "currency": the ISO 4217 code of the contract value (e.g. "USD", "SGD", "IDR", "INR", "JPY"); "${ctx.defaultCurrency}" if no currency is stated.
12. "auto_renewal": true when the contract renews automatically or runs until terminated; otherwise false.
13. "notice_period_days": the notice period in days for termination or non-renewal (default 30 when not specified).
14. "change_summary": for an addendum, a clear summary of which clauses changed and how; otherwise "".
15. "changed_fields": for an addendum, an array containing any of exactly these codes: "Nilai Kontrak / IO", "Jangka Waktu Periode", "Ruang Lingkup / Deliverables", "Syarat Pembayaran", "Pihak Berwenang". Otherwise [].
16. "internal_notes": a structured Markdown summary written in ${ctx.responseLanguage}, acting as a senior legal analyst.
   STRICT RULE: do not use the comma character (,) anywhere in internal_notes — use "and", "or", parentheses or hyphens instead — so the text can be exported to CSV safely.
   Use exactly these sections (translate the headings into ${ctx.responseLanguage}):
   # AGREEMENT SUMMARY — [counterparty or product name]
   - Title / our reference / counterparty reference / effective date / expiry date / term
   ## PARTIES — for each party: legal name / address / signatory and title / notice e-mail
   ## SCOPE AND PURPOSE — 3 to 4 bullets on purpose / responsibilities / limits of liability
   ## COMMERCIAL TERMS — fees or commissions / payment terms and currency / taxes (${ctx.indirectTaxName} and withholding)
   ## EXCLUSIVITY AND NON-COMPETE — or state that none is provided
   ## CONFIDENTIALITY AND DATA PROTECTION — NDA reference / confidentiality duties / data-breach notification / reference to ${ctx.dataProtectionLaw} or the law actually cited
   ## GOVERNING LAW AND DISPUTES — governing law as written / dispute resolution steps and forum

Return strictly one valid JSON object matching the schema. Use "" for any text field not found in the document.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector Contract Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
    );
    const selectedModel = getValidAiModel(model);
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: ocrContents,
      config: {
        responseMimeType: "application/json",
        responseSchema: withDocumentTranscriptField(
          {
            type: Type.OBJECT,
            properties: {
              document_type: { type: Type.STRING },
              contract_title: { type: Type.STRING },
              partner_name: { type: Type.STRING },
              contract_number: { type: Type.STRING },
              parent_contract_number: { type: Type.STRING },
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
              term_clause: { type: Type.STRING },
              agreement_duration: { type: Type.STRING },
              contract_value: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              auto_renewal: { type: Type.BOOLEAN },
              notice_period_days: { type: Type.NUMBER },
              change_summary: { type: Type.STRING },
              changed_fields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              internal_notes: { type: Type.STRING },
            },
            required: ["internal_notes"],
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.start_date) {
      parsedData.start_date = normalizeParsedDate(parsedData.start_date);
    }
    if (parsedData.end_date) {
      parsedData.end_date = normalizeParsedDate(
        parsedData.end_date,
      );
    }
    const clauseText = `${parsedData.agreement_duration || ""} ${parsedData.term_clause || ""}`;
    const isPerpetualClause =
      /sampai pengakhiran|until terminated|salah satu pihak mengakhiri|terus menerus|tanpa batas|unlimited|perpetual/i.test(
        clauseText,
      );
    if (isPerpetualClause && parsedData.start_date) {
      parsedData.auto_renewal = true;
      const parts = parsedData.start_date.split("-").map(Number);
      if (parts.length === 3) {
        const prevDay = new Date(parts[0], parts[1] - 1, parts[2]);
        prevDay.setDate(prevDay.getDate() - 1);
        const prevMonth = String(prevDay.getMonth() + 1).padStart(2, "0");
        const prevDate = String(prevDay.getDate()).padStart(2, "0");
        parsedData.end_date = `9999-${prevMonth}-${prevDate}`;
      }
    } else if (
      parsedData.start_date &&
      (!parsedData.end_date ||
        parsedData.end_date === parsedData.start_date ||
        new Date(parsedData.end_date) <=
          new Date(parsedData.start_date))
    ) {
      const computedResult = computeContractEndDateFromDuration(
        parsedData.start_date,
        clauseText || (parsedData.auto_renewal ? "1 tahun" : ""),
        Boolean(parsedData.auto_renewal),
      );
      if (computedResult) {
        parsedData.end_date = computedResult.endDate;
        if (computedResult.isAutoRenewal) {
          parsedData.auto_renewal = true;
        }
      }
    }
    if (parsedData.internal_notes) {
      parsedData.internal_notes = String(parsedData.internal_notes)
        .replace(/,/g, " ")
        .trim();
    }
    const durationMs = Date.now() - startTime;
    const responsePayload = {
      success: true,
      data: parsedData,
      performance: { durationMs, ...ocrStats },
    };
    if (ocrStats.fileHash) {
      await globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    log.error("Error parsing contract:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse contract document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
app.get("/api/contracts/:id/redline-analysis", (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const contract = db.contracts.find((c) => c.contract_id === id);
  if (!contract || assertRecordAccess(req, "contract", contract)) {
    return res.status(404).json({ error: "Contract not found." });
  }
  res.json({
    success: true,
    hasAnalysis: Boolean(contract.redline_analysis),
    analysis: contract.redline_analysis || null,
    analyzed_at: contract.redline_analyzed_at || null,
  });
});

/** Redline review of the contract form's current values; a new contract saves the result together with the contract. */
app.post("/api/contracts/redline-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.contract;
  if (!draft || typeof draft !== "object") return res.status(400).json({ error: "Contract data is required." });
  const organizationId = getRequestTenantId(req);
  const partner = db.partners.find((p) => p.partner_id === draft.partner_id && p.organizationId === organizationId);
  if (!partner || assertRecordAccess(req, "partner", partner)) return res.status(400).json({ error: "Partner tidak ditemukan." });
  // Editing an existing contract: the result is stored on it right away so it survives leaving without saving.
  const saved = draft.contract_id ? db.contracts.find((c) => c.contract_id === String(draft.contract_id)) : undefined;
  if (draft.contract_id && (!saved || assertRecordAccess(req, "contract", saved) || assertRecordWritable(req, "contract", saved))) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const pick = (k: string) => (draft[k] == null ? undefined : String(draft[k]).slice(0, 20000));
  const contract = {
    organizationId,
    partner_id: partner.partner_id,
    contract_number: pick("contract_number"),
    contract_title: pick("contract_title"),
    document_type: pick("document_type"),
    cooperation_categories: Array.isArray(draft.cooperation_categories) ? draft.cooperation_categories.map(String).slice(0, 50) : [],
    currency: pick("currency"),
    contract_value: Number(draft.contract_value) || 0,
    start_date: pick("start_date"),
    end_date: pick("end_date"),
    auto_renewal: Boolean(draft.auto_renewal),
    notice_period_days: Number(draft.notice_period_days) || undefined,
    notice_type_required: pick("notice_type_required"),
    internal_notes: pick("internal_notes"),
    change_summary: pick("change_summary"),
  };
  try {
    const analysis = await runContractRedlineAnalysis(req, contract, partner);
    if (saved) {
      saved.redline_analysis = analysis;
      saved.redline_analyzed_at = analysis.analyzed_at;
      saved.updated_at = analysis.analyzed_at;
      await saveDb();
    }
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(saved) });
  } catch (error) {
    log.error("Error during draft redline analysis:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis redline AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/contracts/:id/redline-analysis", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const contract = db.contracts.find((c) => c.contract_id === id);
  if (!contract || assertRecordAccess(req, "contract", contract)) {
    return res.status(404).json({ error: "Contract not found." });
  }
  const force = Boolean(req.body.force);
  const hasCustomClause = Boolean(
    req.body.customClauseText && req.body.customClauseText.trim(),
  );
  if (!force && !hasCustomClause && contract.redline_analysis) {
    return res.json({
      success: true,
      cached: true,
      analysis: contract.redline_analysis,
      analyzed_at: contract.redline_analyzed_at || contract.updated_at,
    });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const partner = db.partners.find((p) => p.partner_id === contract.partner_id && p.organizationId === contract.organizationId);
  try {
    const parsed = await runContractRedlineAnalysis(req, contract, partner);
    const nowIso = parsed.analyzed_at;
    contract.redline_analysis = parsed;
    contract.redline_analyzed_at = nowIso;
    contract.updated_at = nowIso;
    await saveDb();
    res.json({
      success: true,
      cached: false,
      analysis: parsed,
      analyzed_at: nowIso,
    });
  } catch (error) {
    log.error("Error during redline analysis:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis redline AI. Silakan coba kembali.", { status: 500 });
  }
});

/**
 * AI Redlining for the Contract Creator editor: reviews the whole document
 * against the tenant's country/industry rules (same aiPolicyContext used by
 * the contract-level redline analysis above) and files each finding as an
 * ordinary suggestion in contract_comments — so it shows up, and is
 * accepted/rejected, exactly like a manually authored "Suggest Change".
 *
 * The client sends plain text (editor.getText({blockSeparator: ' '})) rather
 * than this route deriving it from the stored HTML: that guarantees the text
 * the model reviews is byte-for-byte what the client will later search
 * within to anchor each suggestion back into the live document.
 */
app.post("/api/documents/:id/ai-redline", async (req: express.Request, res: express.Response) => {
  const document = await sql.get(`SELECT id, organization_id, name FROM contract_documents WHERE id = ?`, req.params.id) as { id: string; organization_id: string; name: string } | undefined;
  if (!document || !isMatchingOrg(document.organization_id, getRequestTenantId(req))) {
    return res.status(404).json({ error: "Document not found." });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const plainText = String(req.body?.plainText || "").trim().slice(0, 40000);
  if (!plainText) {
    return res.status(400).json({ error: "The document has no text to review yet." });
  }
  const actor = (req as any).actor;
  if (!actor) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const selectedModel = getValidAiModel(req.body.model);
    const ctx = aiPolicyContext(document.organization_id);
    const regulatorLine = ctx.regulators.length > 0
      ? `Regulators relevant to our industry in ${ctx.countryName}: ${ctx.regulators.join(", ")}. Flag wording that conflicts with outsourcing, audit-right or reporting expectations they typically impose.`
      : "No specific sector regulator is configured; assess against general commercial law and good practice.";
    const prompt = `You are a senior corporate legal counsel performing AI-assisted contract redlining for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName}.
Review the ENTIRE document below and propose specific clause-level redlines needed to align it with our governing-law position (${ctx.governingLaw}), our data-protection posture (${ctx.dataProtectionLaw}), and these industry rules — apply every rule that is actually triggered by the document's wording:
${ctx.clauseRules.map((rule) => `- ${rule}`).join("\n")}
${regulatorLine}
Compliance standards to check against: ${ctx.complianceStandards.join("; ")}.
Tax points to consider (${ctx.indirectTaxName} and withholding): ${ctx.taxConsiderations.join(" ")}
Write every "rationale" in ${ctx.responseLanguage}. Do not invent statute or regulation numbers — cite them only when certain, otherwise describe the requirement in general terms. Skip clauses that are already compliant. Return at most 20 suggestions, most severe first.

Each "quote" MUST be copied EXACTLY, character-for-character, from the document text below — a short excerpt (at most one sentence or clause), never paraphrased, never with added or removed whitespace, because it is used to locate the clause in the live document. "new_text" is the balanced replacement wording for that exact excerpt (or an empty string to recommend deleting it outright).

=== DOCUMENT: ${document.name} ===
${plainText}
`;
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  quote: { type: Type.STRING },
                  new_text: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ["quote", "new_text", "rationale"],
              },
            },
          },
          required: ["suggestions"],
        },
      },
    });
    const parsed = JSON.parse((response as any).text);
    const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const nowIso = new Date().toISOString();
    const created: Array<{ id: string; quote: string; new_text: string }> = [];
    let skipped = 0;
    for (const item of rawSuggestions.slice(0, 20)) {
      const quote = String(item?.quote || "").trim();
      const newText = String(item?.new_text ?? "").trim();
      const rationale = String(item?.rationale || "").trim();
      // The model sometimes paraphrases despite instructions; a quote that isn't a
      // literal substring can never be anchored back into the document, so drop it
      // rather than filing an orphaned suggestion nobody can act on.
      if (!quote || !plainText.includes(quote)) {
        skipped++;
        continue;
      }
      const id = `cmt-${crypto.randomUUID()}`;
      await sql.run(`
        INSERT INTO contract_comments (id, contract_id, parent_id, comment_type, body, quote, new_text, status, author_id, created_at)
        VALUES (?, ?, NULL, 'suggestion', ?, ?, ?, 'open', ?, ?)
      `, id, document.id, rationale ? `AI Redlining: ${rationale}` : "AI Redlining suggestion.", quote, newText, actor.id, nowIso);
      created.push({ id, quote, new_text: newText });
    }
    res.status(201).json({ success: true, created, skipped });
  } catch (error: any) {
    log.error("Error during AI redlining:", error);
    sendRouteError(req, res, error, "request failed", "AI redlining failed. Please try again.", { status: 500 });
  }
});

// Custom Template & Translation Endpoints
// Contract templates are tenant-scoped (PRD §3.3.3, §3.4.1).
app.get("/api/templates", (req, res) => {
  const tenantId = getRequestTenantId(req);
  res.json((db.templates || []).filter((t: any) => isMatchingOrg(t.organizationId, tenantId)));
});

app.post("/api/templates", async (req, res) => {
  try {
    const { id, name, contentId, customFields } = req.body;
    if (!name || !contentId) {
      return res.status(400).json({ error: "Name and content are required." });
    }
    const tenantId = getRequestTenantId(req);
    const templateId = id || `tpl-${Date.now()}`;
    const nowIso = new Date().toISOString();

    if (!db.templates) {
      db.templates = [];
    }

    const existingIndex = db.templates.findIndex((t: any) => t.id === templateId);
    if (existingIndex >= 0 && !isMatchingOrg(db.templates[existingIndex].organizationId, tenantId)) {
      return res.status(404).json({ error: "Template not found." });
    }
    const previous = existingIndex >= 0 ? db.templates[existingIndex] : null;
    const templateData = {
      id: templateId,
      organizationId: previous?.organizationId || tenantId,
      name: String(name).slice(0, 200),
      contentId,
      customFields: Array.isArray(customFields) ? customFields : [],
      version: (Number(previous?.version) || 0) + 1,
      createdAt: previous?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    if (existingIndex >= 0) {
      db.templates[existingIndex] = templateData;
    } else {
      db.templates.push(templateData);
    }

    await saveDb();
    res.json({ success: true, template: templateData });
  } catch (err: any) {
    sendRouteError(req, res, err, "request failed", "Could not save the template.", { status: 500 });
  }
});

app.delete("/api/templates/:id", async (req, res) => {
  const tenantId = getRequestTenantId(req);
  const index = (db.templates || []).findIndex(
    (t: any) => t.id === req.params.id && isMatchingOrg(t.organizationId, tenantId),
  );
  if (index < 0) {
    return res.status(404).json({ error: "Template not found." });
  }
  db.templates.splice(index, 1);
  await saveDb();
  res.json({ success: true });
});

// Drafts a reusable document TEMPLATE (structured sections + {{fieldKey}} tokens, not
// a filled contract) from a free-text brief. Restricted to Superuser/Admin/Manager —
// same tier as other bulk/org-shaping AI actions — because a generated template
// becomes a reusable starting point for every future document of that type.
const AI_TEMPLATE_DOC_TYPES: Record<string, string> = {
  contract: "Kontrak (general commercial contract)",
  agreement: "Perjanjian / Agreement (e.g. cooperation, NDA-style)",
  so: "Surat Pesanan / Service Order (SO)",
};
app.post("/api/templates/ai-generate", async (req: express.Request, res: express.Response) => {
  const templateCtx = orgContextOf(req);
  if (!(templateCtx.accessMode === "platform" || templateCtx.tenantRole === "admin" || templateCtx.tenantRole === "manager")) {
    return res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only administrators and managers can generate templates with AI." });
  }
  if (!(await ensureAiAvailable(req, res))) return;

  const docType = String(req.body?.docType || "");
  const docTypeLabel = AI_TEMPLATE_DOC_TYPES[docType];
  if (!docTypeLabel) {
    return res.status(400).json({ error: "docType must be one of: contract, agreement, so." });
  }
  const brief = String(req.body?.prompt || "").trim().slice(0, 2000);
  if (!brief) {
    return res.status(400).json({ error: "A prompt describing the template is required." });
  }

  try {
    const selectedModel = getValidAiModel(req.body.model);
    const ctx = aiPolicyContext(getRequestTenantId(req));
    const prompt = `You are a senior corporate legal counsel drafting a reusable document TEMPLATE (not a specific filled document) for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName} (governing law: ${ctx.governingLaw}).

Draft a ${docTypeLabel} template based on this brief: "${brief}"

Rules:
- This is a TEMPLATE. Any value that varies per signed instance (party names, addresses, dates, amounts, durations, etc.) must be defined as a field and referenced in the body text as {{fieldKey}} — never as literal placeholder text like "[Party Name]".
- Every {{fieldKey}} used in a paragraph must have a matching entry in "fields", with a unique camelCase key, a short Indonesian label, and the closest matching type.
- Write standard, balanced clauses appropriate for ${ctx.countryName} commercial practice. Do not invent statute or regulation numbers.
- Write all body text in ${ctx.responseLanguage}.
- Return between 4 and 12 sections, each with 1-4 paragraphs.`;

    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  key: { type: Type.STRING },
                  label: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["text", "date", "currency", "entity", "person", "location", "number"] },
                },
                required: ["key", "label", "type"],
              },
            },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["heading", "paragraphs"],
              },
            },
          },
          required: ["title", "fields", "sections"],
        },
      },
    });

    const parsed = JSON.parse((response as any).text);
    const seenKeys = new Set<string>();
    const fields = (Array.isArray(parsed?.fields) ? parsed.fields : [])
      .map((f: any) => {
        const key = String(f?.key || "").replace(/[^a-zA-Z0-9_]/g, "");
        const type = ["text", "date", "currency", "entity", "person", "location", "number"].includes(f?.type) ? f.type : "text";
        return key ? { key, label: String(f?.label || key).slice(0, 200), type } : null;
      })
      .filter((f: any) => {
        if (!f || seenKeys.has(f.key)) return false;
        seenKeys.add(f.key);
        return true;
      });
    const sections = (Array.isArray(parsed?.sections) ? parsed.sections : []).slice(0, 12).map((s: any) => ({
      heading: String(s?.heading || "").slice(0, 300),
      paragraphs: (Array.isArray(s?.paragraphs) ? s.paragraphs : []).slice(0, 4).map((p: any) => String(p || "")),
    }));

    res.json({ success: true, title: String(parsed?.title || "").slice(0, 300), fields, sections });
  } catch (error: any) {
    log.error("Error generating AI template:", error);
    sendRouteError(req, res, error, "request failed", "Gagal membuat template. Coba lagi.", { status: 500 });
  }
});

app.use("/api", createGoogleCredentialsRouter(googleCredentials));

// Create Contract documents: explorer, draft versions, metadata, comments/redlines.
app.use("/api", createDocumentRouter({
  db: sql,
  tenantOf: getRequestTenantId,
  onActivity: (req, event) => addActivityLog("", "", "", event.actionType, "DOCUMENTS", event.description, req, undefined, event.details),
}));
// Document Approval: sequential sign-off on a My Documents item or an uploaded file.
app.use("/api", createApprovalRouter({ db: sql, tenantOf: getRequestTenantId }));

async function persistContractTerminationFile(req: express.Request, record: { organizationId?: string; partner_id?: string }, file: TerminationFile) {
  const partner = db.partners.find(p => p.partner_id === record.partner_id);
  const tenant = findTenant(record.organizationId);
  const storedName = `termination-${randomUUID()}.${file.extension}`;
  const url = await saveUpload(partner?.partner_name, 'Folder Termination', storedName, file.fileData, record.organizationId);
  return { fileName: file.fileName, url };
}

function terminationWriteError(res: express.Response, code: string) {
  return res.status(400).json({ code, error: CONTRACT_TERMINATION_TRANSLATIONS.EN[code] || code });
}

app.post("/api/contracts", validateBody(bodySchemas.contractCreateBody, { requiredMessage: "Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi." }), async (req: express.Request, res: express.Response) => {
  const {
    contract_number,
    contract_title,
    partner_id,
    document_type,
    parent_contract_id,
    parent_contract_number,
    cooperation_categories,
    start_date,
    end_date,
    currency,
    contract_value,
    contract_value_usd: req_usd,
    auto_renewal,
    notice_period_days,
    notice_type_required,
    status_approval,
    status,
    internal_pic,
    internal_notes,
    changed_fields,
    change_summary,
    fileName,
    fileData,
  } = req.body;
  if (
    !contract_number ||
    !contract_title ||
    !partner_id ||
    !start_date ||
    !end_date
  ) {
    return res
      .status(400)
      .json({
        error:
          "Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi.",
      });
  }
  if (new Date(end_date) <= new Date(start_date)) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  const lifecycleMode = contractLifecycleMode(req.body);
  const terminationError = validateContractTermination({ ...req.body, lifecycle_mode: req.body.lifecycle_mode ?? lifecycleMode });
  if (terminationError) return terminationWriteError(res, terminationError);
  let terminationFile: TerminationFile | undefined;
  try { terminationFile = parseTerminationFile(req.body.termination_document_file); }
  catch { return terminationWriteError(res, 'termination.file_invalid'); }
  const requestTenantId = getRequestTenantId(req);
  const existingContractDup = db.contracts.find(
    (c) =>
      isMatchingOrg(c.organizationId, requestTenantId) &&
      String(c.contract_number || "").trim().toLowerCase() ===
      contract_number.trim().toLowerCase(),
  );
  if (existingContractDup) {
    return res
      .status(400)
      .json({
        error: `Nomor Kontrak '${contract_number}' sudah terdaftar dalam sistem.`,
      });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = db.partners.find((p) => p.partner_id === partner_id && p.organizationId === targetOrgId);
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(contract_value) || 0;
  let total_usd = req_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const sheetId =
          targetTenant?.spreadsheetId || db.googleConfig?.spreadsheetId;
        rate = await getHistoricalExchangeRate(
          sheetId,
          token,
          cur,
          start_date,
        );
      } catch (e) {
        log.error("Failed fetching historical rate for contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatContractFileName({
    partnerName: partner?.partner_name,
    documentType: document_type || "Master Agreement",
    contractNumber: contract_number,
    startDate: start_date,
    rawFileName: fileName || `${contract_number}.pdf`,
  });
  let contract_file_link = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!contract_file_link) {
      contract_file_link = await saveUpload(
        partner?.partner_name,
        "Folder Contract",
        targetFileName,
        fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "CONTRACT", `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
  }
  const lifecycleDraft: any = {
    organizationId: targetOrgId,
    start_date,
    end_date,
    auto_renewal: lifecycleMode !== 'terminated' && Boolean(auto_renewal),
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleMode === 'terminated' ? req.body.termination_date : null,
  };
  rollForwardAutoRenewal(lifecycleDraft);
  const finalTanggalBerakhir = lifecycleDraft.end_date;
  const { status: finalStatus, daysRemaining: diffDays } = contractLifecycle(lifecycleDraft, getTenantSettings(targetOrgId));
  const terminationDocument = terminationFile ? await persistContractTerminationFile(req, { organizationId: targetOrgId, partner_id }, terminationFile) : undefined;
  const newContract = {
    contract_id: generateNextContractId(),
    organizationId: targetOrgId,
    document_type: document_type || "Master Agreement",
    parent_contract_id:
      document_type === "Agreement Addendum" ? parent_contract_id : void 0,
    parent_contract_number:
      document_type === "Agreement Addendum" ? parent_contract_number : void 0,
    contract_number,
    contract_title,
    partner_id,
    cooperation_categories: Array.isArray(cooperation_categories)
      ? cooperation_categories
      : ["Umum"],
    start_date,
    end_date: finalTanggalBerakhir,
    currency: cur,
    contract_value: amt,
    contract_value_usd: Number(total_usd),
    auto_renewal: lifecycleDraft.auto_renewal,
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleDraft.termination_date,
    termination_reason: String(req.body.termination_reason || '').trim().slice(0, 10000),
    termination_document: terminationDocument,
    notice_period_days: Number(notice_period_days) || 30,
    notice_type_required: notice_type_required || "Termination",
    status: finalStatus,
    status_approval: normalizeApprovalStatus(status_approval),
    internal_pic: internal_pic || "Legal Team",
    internal_notes: internal_notes ? String(internal_notes).trim() : void 0,
    contract_file_link,
    fileName: targetFileName,
    changed_fields: Array.isArray(changed_fields)
      ? changed_fields
      : void 0,
    change_summary: change_summary || void 0,
    // Analysis run on the add page before the contract existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    days_remaining: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "contract", newContract);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.contracts.unshift(newContract);
  await saveDb();
  await logActivity(req, "CREATE", "CONTRACT", `Membuat Kontrak Baru '${contract_number}' (${contract_title}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`);
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, contract: newContract });
});
app.put("/api/contracts/:id", validateBody(bodySchemas.contractUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  // The schema is the whitelist: ids, organization, timestamps, creator and derived fields never come from the client.
  const { fileData, fileName, termination_document_file, accessToken: _accessToken, ...updates } = req.body;
  const idx = db.contracts.findIndex((c) => c.contract_id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  }
  const existing = db.contracts[idx];
  const tenantDenial = assertRecordAccess(req, "contract", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  // Status-only legacy clients may still request a lifecycle transition.
  if (updates.lifecycle_mode === undefined && updates.status !== undefined) {
    updated.lifecycle_mode = normalizeContractStatus(updates.status) === 'Terminated' ? 'terminated' : 'normal';
  }
  updated.lifecycle_mode = contractLifecycleMode(updated);
  if (updated.lifecycle_mode === 'normal') updated.termination_date = null;
  const unchangedLegacyTermination = existing.status === 'Terminated' && !existing.termination_date && updates.lifecycle_mode === undefined && updates.status === undefined;
  const terminationError = unchangedLegacyTermination ? null : validateContractTermination(updated);
  if (terminationError) return terminationWriteError(res, terminationError);
  let terminationFile: TerminationFile | undefined;
  try { terminationFile = parseTerminationFile(termination_document_file); }
  catch { return terminationWriteError(res, 'termination.file_invalid'); }
  updated.termination_reason = String(updated.termination_reason || '').trim().slice(0, 10000);
  if (updated.lifecycle_mode === 'terminated') updated.auto_renewal = false;
  const cur = normalizeCurrencyCode(updated.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
  updated.currency = cur;
  const amt = Number(updated.contract_value) || 0;
  let total_usd = updates.contract_value_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"] || req.body.accessToken,
        );
        const startDate = updated.start_date || existing.start_date;
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token,
          cur,
          startDate,
        );
      } catch (e) {
        log.error("Failed fetching rate for edit contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.contract_value = amt;
  updated.contract_value_usd = Number(total_usd);
  if (
    updated.start_date &&
    updated.end_date &&
    new Date(updated.end_date) <= new Date(updated.start_date)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.contract_number) {
    const dup = db.contracts.find(
      (c) =>
        c.organizationId === existing.organizationId &&
        String(c.contract_number || "").trim().toLowerCase() ===
          updated.contract_number.trim().toLowerCase() && c.contract_id !== id,
    );
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor Kontrak '${updated.contract_number}' sudah digunakan oleh kontrak lain.`,
        });
    }
  }
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    const partner = db.partners.find(
      (p) => p.partner_id === updated.partner_id,
    );
    const targetFileName = formatContractFileName({
      partnerName: partner?.partner_name,
      documentType: updated.document_type || "Master Agreement",
      contractNumber: updated.contract_number,
      startDate: updated.start_date,
      rawFileName:
        fileName || updated.fileName || `${updated.contract_number}.pdf`,
    });
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] || req.body.accessToken,
    );
    let contract_file_link = "";
    if (!contract_file_link) {
      contract_file_link = await saveUpload(
        partner?.partner_name,
        "Folder Contract",
        targetFileName,
        fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "CONTRACT", `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
    updated.contract_file_link = contract_file_link;
    updated.fileName = targetFileName;
  }
  if (terminationFile) updated.termination_document = await persistContractTerminationFile(req, updated, terminationFile);
  updated.status = normalizeContractStatus(updated.status);
  updated.status_approval = normalizeApprovalStatus(updated.status_approval);
  rollForwardAutoRenewal(updated);
  const lifecycle = contractLifecycle(updated, getTenantSettings(updated.organizationId));
  updated.days_remaining = lifecycle.daysRemaining ?? updated.days_remaining;
  updated.status = lifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "contract", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.contracts[idx] = updated;
  await saveDb();
  await logActivity(req, "UPDATE", "CONTRACT", `Memperbarui data Kontrak '${updated.contract_number}'`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, contract: updated });
});
app.delete("/api/contracts/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const ctr = db.contracts.find((c) => c.contract_id === id);
  if (!ctr) return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "contract", ctr);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  for (const io of db.ios) if (io.organizationId === ctr.organizationId && io.contract_id === id) io.contract_id = null;
  for (const child of db.contracts) if (child.organizationId === ctr.organizationId && child.parent_contract_id === id) child.parent_contract_id = null;
  db.notifications = db.notifications.filter((n) => !(n.organizationId === ctr.organizationId && n.parent_type === 'Contract' && n.parent_id === id));
  db.contracts = db.contracts.filter((c) => c !== ctr);
  await saveDb();
  await logActivity(req, "DELETE", "CONTRACT", `Menghapus Kontrak '${ctr.contract_number}' (${ctr.contract_title})`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.get("/api/ios", async (req: express.Request, res: express.Response) => {
  const iosList = await scopedRecords(req, "io", db.ios);
  const result = iosList.map((io) => {
    const c = db.contracts.find((ctr) => ctr.contract_id === io.contract_id && ctr.organizationId === io.organizationId);
    const cur = normalizeCurrencyCode(io.currency, tenantDefaultCurrency(io.organizationId));
    const amt = Number(io.io_value) || 0;
    const usdVal =
      io.io_value_usd !== void 0 && io.io_value_usd !== null
        ? io.io_value_usd
        : cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
    return {
      ...io,
      currency: cur,
      io_value_usd: usdVal,
      contract_number: c ? c.contract_number : io.contract_number || "-",
    };
  });
  res.json(result);
});
app.post("/api/ios/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `ios:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const profile = getIndustryPack(getTenantSettings(tenantId).industry).commercialDocument;
    const startTime = Date.now();
    const prompt = `You are an expert commercial-document analyst for ${ctx.organizationName} (${ctx.industryName}). The document is a ${profile.label} or a similar order/schedule issued under a master agreement (it may also be a purchase order, order form, statement of work, insertion order or service order). Extract:

1. "io_number": the document's reference number; "-" if it has none.
2. "io_title": the order, campaign, project or engagement title.
3. "partner_name": the counterparty's full legal name (not ${ctx.organizationName}).
4. "contract_number": the reference number of the master agreement it refers to, if any.
5. "media_channel": the ${profile.channelLabel.toLowerCase()} this document covers (e.g. ${profile.channelPlaceholder.replace(/^e\.g\. /, "")}); "-" if not stated.
6. "pricing_model": one of ${profile.pricingModels.map((m) => `"${m}"`).join(", ")} — or the closest short label used in the document.
7. "start_date": the start date as ISO 8601 "YYYY-MM-DD"; "-" if not separately stated.
8. "end_date": the end date as "YYYY-MM-DD". If only a duration is given, end date = start date + duration − 1 day. "-" if unknown.
9. "campaign_duration": the duration as short text (e.g. "3 months", "14 days").
10. "io_value": the total committed value as a plain number; 0 when the value is variable or uncapped.
11. "currency": the ISO 4217 code of the value; "${ctx.defaultCurrency}" if none is stated.
12. "deliverables": a structured Markdown summary in ${ctx.responseLanguage}. STRICT RULES: never use the comma character (,) — use "and", "or", parentheses or hyphens — and do not add citation markers. Use these sections (translate headings into ${ctx.responseLanguage}):
   # ${profile.label.toUpperCase()} SUMMARY
   - Document name / reference / master agreement / start date / end date
   ## PARTIES — provider (contact and e-mail) and customer (signatory and billing address)
   ## SCOPE AND DELIVERABLES — region / service or goods / ${profile.channelLabel.toLowerCase()} / KPIs or acceptance criteria
   ## PRICING — model / unit prices or tiers / fees / discounts or rebates / budget or cap
   ## PAYMENT AND INVOICING — prepaid or postpaid / payment term from invoice / invoice requirements

Return strictly one valid JSON object matching the schema.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector IO Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
    );
    const selectedModel = getValidAiModel(model);
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: ocrContents,
      config: {
        responseMimeType: "application/json",
        responseSchema: withDocumentTranscriptField(
          {
            type: Type.OBJECT,
            properties: {
              io_number: { type: Type.STRING },
              io_title: { type: Type.STRING },
              partner_name: { type: Type.STRING },
              contract_number: { type: Type.STRING },
              media_channel: { type: Type.STRING },
              pricing_model: { type: Type.STRING },
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
              campaign_duration: { type: Type.STRING },
              io_value: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              deliverables: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.start_date) {
      parsedData.start_date = normalizeParsedDate(parsedData.start_date);
    }
    if (parsedData.end_date) {
      parsedData.end_date = normalizeParsedDate(
        parsedData.end_date,
      );
    }
    if (
      parsedData.start_date &&
      (!parsedData.end_date ||
        parsedData.end_date === parsedData.start_date ||
        new Date(parsedData.end_date) <=
          new Date(parsedData.start_date))
    ) {
      const computedEnd = computeContractEndDateFromDuration(
        parsedData.start_date,
        parsedData.campaign_duration || "",
      );
      if (computedEnd) {
        parsedData.end_date = computedEnd;
      }
    }
    if (
      parsedData.io_value === null ||
      parsedData.io_value === void 0 ||
      isNaN(parsedData.io_value)
    ) {
      parsedData.io_value = 0;
    }
    if (parsedData.deliverables) {
      parsedData.deliverables = String(parsedData.deliverables)
        .replace(/,/g, " ")
        .trim();
    }
    const durationMs = Date.now() - startTime;
    const responsePayload = {
      success: true,
      data: parsedData,
      performance: { durationMs, ...ocrStats },
    };
    if (ocrStats.fileHash) {
      await globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    log.error("Error parsing IO:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse IO document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
/** AI review of the service order form's current values (deliverables and commercial terms); an existing SO stores the result right away. */
app.post("/api/ios/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.io;
  if (!draft || typeof draft !== "object") return res.status(400).json({ error: "Service order data is required." });
  const organizationId = getRequestTenantId(req);
  const partner = db.partners.find((p) => p.partner_id === draft.partner_id && p.organizationId === organizationId);
  if (!partner || assertRecordAccess(req, "partner", partner)) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const saved = draft.io_id ? db.ios.find((i) => i.io_id === String(draft.io_id)) : undefined;
  if (draft.io_id && (!saved || assertRecordAccess(req, "io", saved) || assertRecordWritable(req, "io", saved))) {
    return res.status(404).json({ error: "Service order not found." });
  }
  const parent = draft.contract_id ? db.contracts.find((c) => c.contract_id === String(draft.contract_id)) : undefined;
  const parentVisible = parent && !assertRecordAccess(req, "contract", parent) ? parent : undefined;
  if (!(await ensureAiAvailable(req, res))) return;
  const pick = (k: string) => (draft[k] == null ? "-" : String(draft[k]).slice(0, 20000));
  const ctx = aiPolicyContext(organizationId);
  const prompt = `You are a senior commercial counsel and procurement reviewer acting for ${ctx.organizationName}, a ${ctx.industryName} organization in ${ctx.countryName}.
Review the service order (SO) below — an operational order placed under a vendor relationship — and propose balanced fixes. Write every narrative field (titles, summary, findings, clause text and notes) in English.

=== SERVICE ORDER ===
SO number: ${pick("io_number")}
Title: ${pick("io_title")}
Vendor: ${partner.partner_name}${partner.country ? ` (${countryNameForPrompt(partner.country)})` : ""}
Deliverable / channel: ${pick("media_channel")}
Pricing model: ${pick("pricing_model")}
Charging type: ${pick("charging_type")}
Value: ${pick("currency")} ${Number(draft.io_value) || 0}
Period: ${pick("start_date")} to ${pick("end_date")}
Notice period: ${pick("notice_period_days")} days
Deliverables text:
${pick("deliverables")}
${parentVisible ? `
=== PARENT CONTRACT ===
Reference: ${parentVisible.contract_number} — ${parentVisible.contract_title}
Term: ${parentVisible.start_date} to ${parentVisible.end_date}; status: ${parentVisible.status || "-"}
Value: ${parentVisible.currency || "-"} ${Number(parentVisible.contract_value || 0)}
Clause summary: ${parentVisible.internal_notes || "-"}` : "\nNo parent contract is linked; the SO must stand on its own terms."}

=== REVIEW INSTRUCTIONS ===
Focus on: (1) whether deliverables are measurable — quantities, specs, KPIs, dates and acceptance criteria; (2) commercial fit — the pricing model matches the charging type, payment timing is clear, and there is a remedy for under-delivery (make-good, credit or refund); (3) reporting/proof-of-performance obligations; (4) cancellation and change terms; (5) consistency with the parent contract when one is given.
Industry focus areas: ${ctx.reviewFocus.join("; ")}.
Do not invent statute or regulation numbers.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: one short paragraph on how ready this SO is to issue and its main gaps.
4. keyFindings: 2-4 of the most important issues.
5. analyzedClauses: 2-5 items to fix, each with clauseTitle, riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue (quote the SO wording when possible, otherwise describe what is missing), identifiedRisk, recommendedRedline (replacement or additional SO wording) and legalRationale.
6. complianceChecklist: 3-5 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes.
`;
  try {
    const analysis = await generateRedlineAnalysis(req, prompt);
    if (saved) {
      saved.redline_analysis = analysis;
      saved.redline_analyzed_at = analysis.analyzed_at;
      saved.updated_at = analysis.analyzed_at;
      await saveDb();
    }
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(saved) });
  } catch (error) {
    log.error("Error during service order review:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/ios", validateBody(bodySchemas.ioCreateBody, { requiredMessage: "Nomor IO, Judul, Partner, Tanggal, Pricing Model, & Charging Type wajib diisi." }), async (req: express.Request, res: express.Response) => {
  const {
    contract_id,
    io_number,
    io_title,
    partner_id,
    media_channel,
    start_date,
    end_date,
    pricing_model,
    charging_type,
    currency,
    io_value,
    io_value_usd: req_usd,
    deliverables,
    notice_period_days,
    notice_type_required,
    fileName,
    fileData,
  } = req.body;
  if (
    !io_number ||
    !io_title ||
    !partner_id ||
    !start_date ||
    !end_date ||
    !pricing_model ||
    !charging_type
  ) {
    return res
      .status(400)
      .json({
        error:
          "Nomor IO, Judul, Partner, Tanggal, Pricing Model, & Charging Type wajib diisi.",
      });
  }
  if (new Date(end_date) <= new Date(start_date)) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  const ioTenantId = getRequestTenantId(req);
  const existingIODup = db.ios.find(
    (i) => isMatchingOrg(i.organizationId, ioTenantId) && String(i.io_number || "").trim().toLowerCase() === io_number.trim().toLowerCase(),
  );
  if (existingIODup) {
    return res
      .status(400)
      .json({ error: `Nomor IO '${io_number}' sudah terdaftar dalam sistem.` });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = db.partners.find((p) => p.partner_id === partner_id && p.organizationId === targetOrgId);
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const contract = db.contracts.find((c) => c.contract_id === contract_id && c.organizationId === targetOrgId);
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(io_value) || 0;
  let total_usd = req_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const sheetId =
          targetTenant?.spreadsheetId || db.googleConfig?.spreadsheetId;
        rate = await getHistoricalExchangeRate(
          sheetId,
          token,
          cur,
          start_date,
        );
      } catch (e) {
        log.error("Failed fetching historical rate for IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatIOFileName({
    partnerName: partner?.partner_name,
    mediaChannel: media_channel || "Digital Channel",
    ioNumber: io_number,
    startDate: start_date,
    rawFileName: fileName || `${io_number}.pdf`,
  });
  let io_file_link = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!io_file_link) {
      io_file_link = await saveUpload(
        partner?.partner_name,
        "Folder IO",
        targetFileName,
        fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "IO", `File IO '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
  }
  const { status, daysRemaining: diffDays } = computeLifecycle(targetOrgId, end_date, "Active", false);
  const newIO = {
    io_id: generateNextIOId(),
    organizationId: targetOrgId,
    contract_id: contract_id || void 0,
    contract_number: contract ? contract.contract_number : "-",
    io_number,
    io_title,
    partner_id,
    media_channel: media_channel || "",
    start_date,
    end_date,
    pricing_model,
    charging_type,
    currency: cur,
    io_value: amt,
    io_value_usd: Number(total_usd),
    deliverables: deliverables || "-",
    // Optional unit pricing used to estimate how many units an invoice should cover.
    unit: req.body.unit ? String(req.body.unit).slice(0, 60) : void 0,
    unit_price: Number(req.body.unit_price) > 0 ? Number(req.body.unit_price) : void 0,
    unit_quantity: Number(req.body.unit_quantity) > 0 ? Number(req.body.unit_quantity) : void 0,
    notice_period_days: Number(notice_period_days) || 14,
    // Review run on the add page before the SO existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    notice_type_required: notice_type_required || "Termination",
    status,
    io_file_link,
    fileName: targetFileName,
    days_remaining: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "io", newIO);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.ios.unshift(newIO);
  await saveDb();
  await logActivity(req, "CREATE", "IO", `Membuat dokumen komersial baru '${io_number}' (${io_title}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`);
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, io: newIO });
});
app.put("/api/ios/:id", validateBody(bodySchemas.ioUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { fileData: uploadedData, fileName: uploadedName, accessToken: _accessToken, ...updates } = req.body;
  const idx = db.ios.findIndex((i) => i.io_id === id);
  if (idx === -1) return res.status(404).json({ error: "IO tidak ditemukan." });
  const existing = db.ios[idx];
  const tenantDenial = assertRecordAccess(req, "io", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  if (updates.contract_id !== undefined) {
    const parent = db.contracts.find((c) => c.contract_id === updates.contract_id && c.organizationId === existing.organizationId);
    updated.contract_number = parent ? parent.contract_number : "-";
  }
  const cur = normalizeCurrencyCode(updated.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
  updated.currency = cur;
  const amt = Number(updated.io_value) || 0;
  let total_usd = updates.io_value_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"] || req.body.accessToken,
        );
        const startDate = updated.start_date || existing.start_date;
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token,
          cur,
          startDate,
        );
      } catch (e) {
        log.error("Failed fetching rate for edit IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.io_value = amt;
  updated.io_value_usd = Number(total_usd);
  if (
    uploadedData &&
    typeof uploadedData === "string" &&
    uploadedData.includes("base64,")
  ) {
    const fileData = uploadedData;
    const partner = db.partners.find(
      (p) => p.partner_id === updated.partner_id && p.organizationId === existing.organizationId,
    );
    const targetFileName = formatIOFileName({
      partnerName: partner?.partner_name,
      mediaChannel: updated.media_channel || "Digital Channel",
      ioNumber: updated.io_number,
      startDate: updated.start_date,
      rawFileName:
        uploadedName || updated.fileName || `${updated.io_number}.pdf`,
    });
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] || req.body.accessToken,
    );
    let io_file_link = "";
    if (!io_file_link) {
      io_file_link = await saveUpload(
        partner?.partner_name,
        "Folder IO",
        targetFileName,
        fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "IO", `File IO '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
    updated.io_file_link = io_file_link;
    updated.fileName = targetFileName;
  }
  if (
    updated.start_date &&
    updated.end_date &&
    new Date(updated.end_date) <= new Date(updated.start_date)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.io_number) {
    const dup = db.ios.find(
      (i) =>
        isMatchingOrg(i.organizationId, updated.organizationId) &&
        String(i.io_number || "").trim().toLowerCase() ===
          updated.io_number.trim().toLowerCase() && i.io_id !== id,
    );
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor IO '${updated.io_number}' sudah digunakan oleh IO lain.`,
        });
    }
  }
  const ioLifecycle = computeLifecycle(updated.organizationId, updated.end_date, updated.status, false);
  updated.days_remaining = ioLifecycle.daysRemaining ?? updated.days_remaining;
  updated.status = ioLifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "io", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.ios[idx] = updated;
  await saveDb();
  await logActivity(req, "UPDATE", "IO", `Memperbarui data Insertion Order '${updated.io_number}'`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, io: updated });
});
app.delete("/api/ios/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const item = db.ios.find((i) => i.io_id === id);
  if (!item) return res.status(404).json({ error: "IO tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "io", item);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  db.ios = db.ios.filter((i) => i !== item);
  await saveDb();
  await logActivity(req, "DELETE", "IO", `Menghapus Insertion Order '${item.io_number}' (${item.io_title})`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.get("/api/notification-logs", async (req: express.Request, res: express.Response) => {
  res.json(await scopedRecords(req, "notification", db.notifications));
});
/**
 * Matches in-memory notifications the caller may touch. scopedRecords re-reads rows from the database,
 * so this matches by organization + notif_id; object identity never matches db.notifications.
 */
async function visibleNotificationFilter(req: express.Request) {
  const org = orgContextOf(req).organizationId;
  const ids = new Set((await scopedRecords(req, "notification", db.notifications)).map((n: any) => n.notif_id));
  return { has: (n: any) => n.organizationId === org && ids.has(n.notif_id) };
}
/** Only notifications attached to records the caller can see are touched (PRD §4.5.2). */
app.post("/api/notification-logs/mark-read", async (req: express.Request, res: express.Response) => {
  const { notif_id, markAll } = req.body || {};
  const visible = await visibleNotificationFilter(req);
  db.notifications = (db.notifications || []).map((n) =>
    visible.has(n) && (markAll || (notif_id && n.notif_id === notif_id)) ? { ...n, is_read: true } : n,
  );
  await saveDb();
  res.json({ success: true, notifications: await scopedRecords(req, "notification", db.notifications) });
});
app.post("/api/notification-logs/delete", async (req: express.Request, res: express.Response) => {
  const { notif_id, notif_ids, deleteAll } = req.body || {};
  const visible = await visibleNotificationFilter(req);
  const chosen = new Set<string>(Array.isArray(notif_ids) ? notif_ids : notif_id ? [notif_id] : []);
  db.notifications = (db.notifications || []).filter((n) => !(visible.has(n) && (deleteAll || chosen.has(n.notif_id))));
  await saveDb();
  res.json({ success: true, notifications: await scopedRecords(req, "notification", db.notifications) });
});
app.post("/api/cron/trigger-check", async (req: express.Request, res: express.Response) => {
  // Same pass as the scheduler, under the same lock: a concurrent run on another instance makes this one a no-op.
  const outcome = await withAdvisoryLock(REMINDER_LOCK_KEY, runReminderPass);
  if (!outcome.ran) return res.status(202).json({ success: true, newNotificationsGenerated: 0, skipped: "another reminder pass is running" });
  const { queued, delivery } = outcome.value!;
  res.json({ success: true, newNotificationsGenerated: queued, delivery });
});
app.get(
  ["/api/auth/google/client-id", "/api/google-auth/client-id"],
  (req: express.Request, res: express.Response) => {
    res.json({ clientId: googleCredentials.getOAuthClient().clientId });
  },
);
app.post(
  ["/api/auth/google/exchange-code", "/api/google-auth/exchange-code"],
  async (req: express.Request, res: express.Response) => {
    try {
      const { code, redirect_uri } = req.body;
      if (!code) {
        return res
          .status(400)
          .json({ error: "Authorization code is required" });
      }
      const { clientId, clientSecret } = googleCredentials.getOAuthClient();
      if (!clientId) {
        return res
          .status(500)
          .json({
            error:
              "OAuth client Google belum dikonfigurasi. Unggah file JSON OAuth client di Settings → Google, atau isi GOOGLE_CLIENT_ID.",
          });
      }
      const oauth2Client = new OAuth2Client(
        clientId,
        clientSecret,
        redirect_uri || "postmessage",
      );
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens || !tokens.access_token) {
        return res
          .status(400)
          .json({
            error: "Gagal mendapatkan Access Token dari Google OAuth server.",
          });
      }
      // The caller's own tokens are returned to the caller only. Connecting the
      // platform Google account is a separate, platform-only action (/connect).
      let profile: any = { email: "Google User", name: "Pengguna Google" };
      try {
        const userInfoRes = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        );
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json() as { email?: string; name?: string; picture?: string };
          profile = {
            email: userInfo.email || "Google User",
            name: userInfo.name || userInfo.email || "Pengguna Google",
            photoURL: userInfo.picture || void 0,
          };
        }
      } catch (profileErr) {
        log.warn(
          "Gagal memuat profil pengguna di exchange-code:",
          profileErr,
        );
      }
      res.json({
        success: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date,
        profile,
      });
    } catch (err) {
      log.error("Error exchanging Google OAuth code:", err);
      sendRouteError(req, res, err, "request failed", "Gagal menukarkan Google Authorization Code.", { status: 500 });
    }
  },
);
app.get(
  ["/api/auth/google/token", "/api/google-auth/token"],
  async (req: express.Request, res: express.Response) => {
    try {
      const freshToken = await getFreshGoogleAccessToken();
      const activeToken = freshToken || db.googleConfig?.accessToken || null;
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json({
        success: true,
        accessToken: activeToken,
        isConnected: Boolean(
          db.googleConfig?.isConnected &&
          (activeToken || db.googleConfig?.refreshToken),
        ),
        lastSyncTime: db.googleConfig?.lastSyncTime || null,
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal memeriksa token Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post(
  ["/api/auth/google/refresh-token", "/api/google-auth/refresh-token"],
  async (req: express.Request, res: express.Response) => {
    try {
      const freshToken = await getFreshGoogleAccessToken();
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json({ success: true, accessToken: freshToken });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal me-refresh token Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post(
  ["/api/auth/google/sync-session", "/api/google-auth/sync-session"],
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, name, photoURL, idToken, accessToken, refreshToken } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, error: "Email diperlukan untuk sinkronisasi akun." });
      }

      const cleanEmail = email.toLowerCase().trim();
      const userName = name || cleanEmail.split("@")[0];
      const now = new Date().toISOString();

      // The e-mail in the request body is untrusted: prove it with Google.
      const verifiedEmail = await verifyGoogleAccessTokenEmail(accessToken);
      if (!verifiedEmail || verifiedEmail !== cleanEmail) {
        return res.status(401).json({
          success: false,
          error: "GOOGLE_IDENTITY_NOT_VERIFIED",
          message: "The Google sign-in could not be verified. Please sign in again.",
        });
      }

      // Google proved the email above; invitations satisfy account approval,
      // while membership is still granted only by explicit invitation acceptance.
      const invited = await hasApprovalInvitation(sql, cleanEmail, req.get('x-invitation-token'));
      let existingUser: any = await sql.get(`SELECT id, name, role, banned, "banReason", "banExpires" FROM "user" WHERE LOWER(email) = ?`, cleanEmail);
      if (!existingUser) {
        try {
          await sql.run(`
            INSERT INTO "user" (id, name, email, "emailVerified", image, role, banned, "banReason", "createdAt", "updatedAt")
            VALUES (?, ?, ?, true, ?, 'user', ?, ?, ?, ?)
          `, `usr_${crypto.randomUUID()}`, userName, cleanEmail, photoURL || null, !invited, invited ? null : 'PENDING_APPROVAL', now, now);
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // a concurrent sign-in of the same address created it first
        }
        existingUser = await sql.get(`SELECT id, name, role, banned, "banReason", "banExpires" FROM "user" WHERE LOWER(email) = ?`, cleanEmail);
      }
      if (existingUser.banReason === 'PENDING_APPROVAL' && invited) {
        await sql.run('UPDATE "user" SET banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = ? WHERE id = ?', now, existingUser.id);
        existingUser.banned = false;
        existingUser.banReason = null;
        existingUser.banExpires = null;
      }
      if (isIdentityBanned(existingUser)) {
        const pending = existingUser.banReason === 'PENDING_APPROVAL';
        return res.status(403).json({ success: false, error: pending ? "ACCOUNT_PENDING_APPROVAL" : "ACCOUNT_DISABLED",
          message: pending ? "Your account is waiting for manual superuser approval." : "This account is disabled." });
      }
      // Google verified this address, so the identity's email is verified.
      await sql.run(`UPDATE "user" SET image = COALESCE(?, image), "emailVerified" = true, "updatedAt" = ? WHERE id = ?`, photoURL || null, now, existingUser.id);
      const userId = existingUser.id;
      const existingAcc: any = await sql.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'google'`, userId);
      if (!existingAcc) {
        await sql.run(`
          INSERT INTO account (id, "accountId", "providerId", "userId", "idToken", "createdAt", "updatedAt")
          VALUES (?, ?, 'google', ?, ?, ?, ?)
        `, `acc_${crypto.randomUUID()}`, cleanEmail, userId, idToken || null, now, now);
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await sql.run(`
        INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId", "activeOrganizationId")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `, `sess_${crypto.randomUUID()}`, sessionExpiry, sessionToken, now, now, req.ip || "", String(req.headers["user-agent"] || ""), userId);

      // 5. Set session cookie
      res.cookie("better-auth.session_token", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        sessionToken,
        user: { id: userId, email: cleanEmail, name: existingUser.name || userName, photoURL: photoURL || null },
      });
    } catch (err: any) {
      log.error("Error in /api/auth/google/sync-session:", err);
      sendRouteError(req, res, err, "request failed", "Gagal menyinkronkan sesi Google ke Better Auth.", { status: 500, extra: { success: false } });
    }
  }
);
app.post(
  ["/api/google-integration/connect", "/api/auth/google/connect"],
  async (req: express.Request, res: express.Response) => {
    if (!(await checkIsAdmin(req)).isAdmin) {
      return res.status(403).json({ error: "Forbidden: only administrators can change the Google integration." });
    }
    try {
      const { accessToken, refreshToken } = req.body || {};
      const token = accessToken || req.headers["x-google-access-token"];
      if (!token && !refreshToken) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Access token atau Refresh token Google diperlukan.",
          });
      }
      if (token) db.googleConfig.accessToken = token;
      if (refreshToken) db.googleConfig.refreshToken = refreshToken;
      db.googleConfig.isConnected = true;
      db.googleConfig.lastSyncTime = new Date().toISOString();
      await saveDb();
      if (token) {
        backupLocalFilesToGoogleDrive(token).catch((e) => {
          log.warn(
            "[Google Auth] Background backup error on connect:",
            e?.message,
          );
        });
      }
      res.json({
        success: true,
        isConnected: true,
        lastSyncTime: db.googleConfig.lastSyncTime,
        config: redactProviderConfig(db.googleConfig),
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal menyinkronkan status koneksi Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post("/api/google-integration/backup", async (req: express.Request, res: express.Response) => {
  if (!(await checkIsAdmin(req)).isAdmin) {
    return res.status(403).json({ error: "Forbidden: only administrators can run the Google Drive backup." });
  }
  res.json({ success: true, ...(await backupLocalFilesToGoogleDrive(req.headers["x-google-access-token"] as string | undefined)) });
});
app.post(
  ["/api/google-integration/disconnect", "/api/auth/google/disconnect"],
  async (req: express.Request, res: express.Response) => {
    if (!(await checkIsAdmin(req)).isAdmin) {
      return res.status(403).json({ error: "Forbidden: only administrators can change the Google integration." });
    }
    try {
      db.googleConfig.accessToken = "";
      db.googleConfig.refreshToken = "";
      db.googleConfig.isConnected = false;
      db.googleConfig.lastSyncTime = new Date().toISOString();
      await saveDb();
      res.json({
        success: true,
        isConnected: false,
        message: "Akun Google berhasil diputuskan dari konfigurasi server.",
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal memutuskan akun Google di server.", { status: 500, extra: { success: false } });
    }
  },
);
/*
 * Platform configuration (PRD §7.1, §7.5, §9.4): deployment branding, the
 * master Google resources, AI provider/model and SMTP relay. Platform-only;
 * tenant settings never read this. Secrets are write-only: omitted keeps the
 * stored value, a non-empty string replaces it, explicit null clears it.
 */
const GOOGLE_RESOURCE_ID = /^[A-Za-z0-9_-]{10,200}$/;
function platformConfigError(message: string): never {
  throw new ApiError(400, "INVALID_INPUT", message);
}
function readPlatformConfiguration() {
  const g = db.googleConfig || {};
  const b = { ...DEFAULT_BRANDING, ...(db.branding || {}) };
  return {
    uiTexts: { overrides: withCurrentUiTextKeys(g.uiTextOverrides || { ID: {}, EN: {}, ZH: {} }) as UITextOverrides },
    branding: { appName: b.appName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, footerText: b.footerText, loginHeadline: b.loginHeadline },
    google: {
      driveFolderId: g.driveFolderId || "",
      spreadsheetId: g.spreadsheetId || "",
      masterSpreadsheetId: g.masterSpreadsheetId || "",
      masterSpreadsheetUrl: g.masterSpreadsheetId ? `https://docs.google.com/spreadsheets/d/${g.masterSpreadsheetId}/edit` : "",
      isConnected: Boolean(g.isConnected && (g.accessToken || g.refreshToken)),
      hasGoogleSession: Boolean(g.accessToken || g.refreshToken),
      serviceAccountConfigured: hasServiceAccountCredentials(),
      lastSyncTime: g.lastSyncTime || "",
    },
    ai: { aiModel: g.aiModel || "gemini-3.8-flash", hasGeminiApiKey: Boolean(getEffectiveGeminiApiKey()) },
    smtp: {
      smtpEnabled: Boolean(g.smtpEnabled), smtpHost: g.smtpHost || "", smtpPort: g.smtpPort ?? null,
      smtpSecure: Boolean(g.smtpSecure), smtpAllowSelfSigned: Boolean(g.smtpAllowSelfSigned), smtpUser: g.smtpUser || "", smtpFromEmail: g.smtpFromEmail || "",
      smtpFromName: g.smtpFromName || "", hasSmtpPassword: Boolean(g.smtpPassword),
    },
  };
}
app.get('/api/system/ui-texts', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(readPlatformConfiguration().uiTexts);
});
const PLATFORM_SECTIONS: Record<string, string[]> = {
  uiTexts: ['overrides', 'reset'],
  branding: ["appName", "logoUrl", "primaryColor", "footerText", "loginHeadline"],
  google: ["driveFolderId", "spreadsheetId", "masterSpreadsheetId"],
  ai: ["aiModel", "geminiApiKey"],
  smtp: ["smtpEnabled", "smtpHost", "smtpPort", "smtpSecure", "smtpAllowSelfSigned", "smtpUser", "smtpPassword", "smtpFromEmail", "smtpFromName"],
};
function validatePlatformValue(section: string, key: string, value: unknown): unknown {
  const str = (max: number) => {
    if (typeof value !== "string" || value.trim().length > max) platformConfigError(`${key} must be text up to ${max} characters.`);
    return (value as string).trim();
  };
  switch (`${section}.${key}`) {
    case 'uiTexts.reset':
      if (value !== true) platformConfigError('reset must be true.');
      return true;
    case 'uiTexts.overrides': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) platformConfigError('overrides must be a language dictionary.');
      const result: Partial<UITextOverrides> = {};
      for (const [language, catalog] of Object.entries(value)) {
        if (!['ID', 'EN', 'ZH'].includes(language) || !catalog || typeof catalog !== 'object' || Array.isArray(catalog)) platformConfigError('Supported UI languages are ID, EN and ZH.');
        const entries = Object.entries(catalog);
        if (entries.length > 10_000) platformConfigError('A dictionary can contain up to 10000 texts per language.');
        for (const [textKey, text] of entries) {
          if (!/^[\w.-]{1,160}$/.test(textKey) || ['__proto__', 'prototype', 'constructor'].includes(textKey) || typeof text !== 'string' || text.length > 10_000) platformConfigError('Each UI text needs a valid key and text up to 10000 characters.');
        }
        result[language as keyof UITextOverrides] = Object.fromEntries(entries) as Record<string, string>;
      }
      return result;
    }
    case "branding.appName": case "branding.loginHeadline": return str(200);
    case "branding.footerText": return str(500);
    case "branding.primaryColor": {
      const v = str(7);
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) platformConfigError("primaryColor must be a six-digit hex color.");
      return v;
    }
    case "branding.logoUrl": {
      const v = str(2048);
      if (v && !(v.startsWith("/") && !v.startsWith("//")) && !/^https:\/\//i.test(v)) platformConfigError("logoUrl must be an HTTPS URL or a path on this site.");
      if (/[<>"'\s]/.test(v)) platformConfigError("logoUrl is invalid.");
      return v;
    }
    case "google.driveFolderId": case "google.spreadsheetId": case "google.masterSpreadsheetId": {
      if (value === null || value === "") return "";
      if (typeof value !== "string" || !GOOGLE_RESOURCE_ID.test(value)) platformConfigError(`${key} is not a valid Google resource ID.`);
      return value;
    }
    case "ai.aiModel": return getValidAiModel(str(100));
    case "smtp.smtpEnabled": case "smtp.smtpSecure": case "smtp.smtpAllowSelfSigned":
      if (typeof value !== "boolean") platformConfigError(`${key} must be true or false.`);
      return value;
    case "smtp.smtpPort":
      if (value === null) return null;
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) platformConfigError("smtpPort must be 1–65535.");
      return value;
    case "smtp.smtpHost": case "smtp.smtpUser": case "smtp.smtpFromName": return str(254);
    case "smtp.smtpFromEmail": {
      const v = str(254);
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) platformConfigError("smtpFromEmail is not a valid email address.");
      return v;
    }
  }
  platformConfigError(`Unknown field: ${section}.${key}`);
}
async function applyPlatformConfiguration(section: unknown, values: unknown, actor: ReturnType<typeof auditActorFor>) {
  if (typeof section !== "string" || !Object.hasOwn(PLATFORM_SECTIONS, section)) platformConfigError("section must be branding, google, ai, smtp or uiTexts.");
  if (!values || typeof values !== "object" || Array.isArray(values)) platformConfigError("values must be an object.");
  const allowed = PLATFORM_SECTIONS[section as string];
  const input = values as Record<string, unknown>;
  if (section === 'uiTexts' && input.reset !== undefined && input.overrides !== undefined) platformConfigError('Choose overrides or reset.');
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) platformConfigError(`Unknown field: ${section}.${key}`);
    if (key === "geminiApiKey" || key === "smtpPassword") {
      if (value === undefined) continue;
      if (value === null) { next[key] = ""; continue; }
      if (typeof value !== "string" || !value.trim() || value.length > 512) platformConfigError(`${key} must be a non-empty string or null.`);
      next[key] = value.trim();
      continue;
    }
    next[key] = validatePlatformValue(section as string, key, value);
  }
  const before = JSON.stringify({ branding: db.branding, googleConfig: db.googleConfig });
  if (section === 'uiTexts') {
    const overrides: UITextOverrides = { ID: {}, EN: {}, ZH: {} };
    if (!next.reset) {
      const current = readPlatformConfiguration().uiTexts.overrides;
      for (const language of ['ID', 'EN', 'ZH'] as const) {
        const merged = { ...current[language], ...(next.overrides as Partial<UITextOverrides>)?.[language] };
        overrides[language] = Object.fromEntries(Object.entries(merged).filter(([, text]) => text !== ''));
        if (Object.keys(overrides[language]).length > 10_000) platformConfigError('A dictionary can contain up to 10000 texts per language.');
      }
    }
    db.googleConfig = { ...(db.googleConfig || {}), uiTextOverrides: overrides };
  }
  else if (section === "branding") db.branding = { ...DEFAULT_BRANDING, ...(db.branding || {}), ...next };
  else db.googleConfig = { ...(db.googleConfig || {}), ...next, ...(section === "google" && next.masterSpreadsheetId !== undefined ? { masterSpreadsheetUrl: "" } : {}) };
  if (section === "ai" && next.geminiApiKey !== undefined) process.env.GEMINI_API_KEY = String(next.geminiApiKey);
  try {
    await coreSaver.save(() => appendAudit(sql, actor, {
      organizationId: null, action: "platform.configuration.update", targetType: "installation", targetId: "installation",
      outcome: "success", changedFields: Object.keys(next).map((k) => `${section}.${k}`),
    }));
  } catch (err) {
    const restored = JSON.parse(before);
    db.branding = restored.branding;
    db.googleConfig = restored.googleConfig;
    throw err;
  }
  return (readPlatformConfiguration() as any)[section as string];
}
/** Committed organization change: rebuild projections and re-derive policy-dependent state. */
async function onOrganizationChanged(organizationId: string) {
  await refreshTenantProjection();
  (db.partners || []).forEach((p: any) => {
    if (p.organizationId !== organizationId) return;
    p.dd_documents = normalizePartnerDocuments(p);
    p.status_dd = computeDueDiligenceStatus(p.dd_documents);
  });
  await recalculateStatuses();
  await saveDb();
}
app.get("/api/google-integration", (_req: express.Request, res: express.Response) => {
  const config = readPlatformConfiguration();
  res.json({ ...config.google, ...config.ai, ...config.smtp });
});
/** Legacy platform write adapter: splits a flat body into strict sections. Tenant fields are rejected. */
app.post("/api/google-integration", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sections: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(body)) {
    const section = Object.keys(PLATFORM_SECTIONS).find((name) => name !== "branding" && PLATFORM_SECTIONS[name].includes(key));
    if (!section) return sendError(req, res, 400, "INVALID_INPUT", `Unknown or tenant-owned field: ${key}`);
    if ((key === "geminiApiKey" || key === "smtpPassword") && (value === "" || isMaskedSecret(value))) continue;
    (sections[section] ||= {})[key] = value;
  }
  const previousFolder = db.googleConfig?.driveFolderId;
  try {
    for (const [section, values] of Object.entries(sections)) await applyPlatformConfiguration(section, values, auditActorFor(req, identity));
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
  if (!IS_TEST_MODE && db.googleConfig?.driveFolderId && db.googleConfig.driveFolderId !== previousFolder) {
    autoEnsureTenantGoogleResources(db.googleConfig.accessToken, true).catch((e) => log.warn("[Google Integration Save]", e?.message));
  }
  const config = readPlatformConfiguration();
  res.json({ success: true, config: { ...config.google, ...config.ai, ...config.smtp } });
});
app.get('/api/mailer/templates', async (_req, res) => res.json({ templates: await mailTemplates.list() }));
app.put('/api/mailer/templates/:id', async (req, res) => {
  const { subject, html, expectedVersion } = req.body || {};
  const template = await sql.tx(async () => {
    const saved = await mailTemplates.save(String(req.params.id), { subject, html }, expectedVersion);
    await appendAudit(sql, auditActorFor(req, identityOf(req)), {
      organizationId: null, action: 'platform.configuration.update', targetType: 'mail_template', targetId: String(req.params.id),
      outcome: 'success', changedFields: ['subject', 'html'],
    });
    return saved;
  });
  res.json({ template });
});
app.post("/api/smtp/test", async (req: express.Request, res: express.Response) => {
  const adminCheck = await checkIsAdmin(req);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can test SMTP settings." });
  }
  const {
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
    smtpFromEmail,
    smtpFromName,
    testRecipient,
  } = req.body;
  const host = (smtpHost || db.googleConfig.smtpHost || "").trim();
  const user = (smtpUser || db.googleConfig.smtpUser || "").trim();
  const pass =
    smtpPassword && !isMaskedSecret(smtpPassword) ? smtpPassword : db.googleConfig.smtpPassword || "";
  const recipient = (testRecipient || "").trim();
  if (!host || !user || !recipient) {
    return res
      .status(400)
      .json({
        error: "SMTP Host, Username, dan Email Penerima Uji Coba wajib diisi.",
      });
  }
  try {
    const port = Number(smtpPort) || (smtpSecure ? 465 : 587);
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: smtpSecure ?? port === 465,
      auth: { user, pass },
      tls: smtpTlsOptions(db.googleConfig),
    });
    await transporter.verify();
    const fromAddress = (
      smtpFromEmail ||
      db.googleConfig.smtpFromEmail ||
      user
    ).trim();
    const fromName = (
      smtpFromName ||
      db.googleConfig.smtpFromName ||
      "Sistem Notifikasi Kontrak & IO"
    ).trim();
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: recipient,
      ...await mailTemplates.render('smtp-test', { host, port: String(port), fromAddress, testedAt: new Date().toISOString() }),
    });
    res.json({
      success: true,
      message: `Email uji coba berhasil dikirim ke '${recipient}'! (Message ID: ${info.messageId})`,
    });
  } catch (err) {
    log.error("SMTP Test Error:", err);
    // Only the transport's error code (EAUTH, ECONNECTION, ...) is shown; the full error is in the log.
    const smtpCode = typeof err?.code === "string" ? ` (${err.code.slice(0, 40)})` : "";
    sendApiError(req, res, 400, "SMTP_TEST_FAILED", `Gagal mengirim email via SMTP Relay${smtpCode}. Periksa host, port, kredensial dan pengaturan TLS.`);
  }
});
app.post("/api/ai/test-key", async (req: express.Request, res: express.Response) => {
  const { apiKey, model } = req.body;
  const keyToTest = (apiKey && !isMaskedSecret(apiKey) ? String(apiKey) : getEffectiveGeminiApiKey()).trim();
  if (!keyToTest) {
    return res
      .status(400)
      .json({
        error: "API Key belum diisi. Masukkan Gemini API Key terlebih dahulu.",
      });
  }
  try {
    const testClient = new GoogleGenAI({
      apiKey: keyToTest,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    const modelsToTry = [
      model ? getValidAiModel(model) : "gemini-3.8-flash",
      "gemini-3.8-flash",
      "gemini-3.1-flash-lite",
    ];
    const uniqueModels = [...new Set(modelsToTry)];
    let lastErr = null;
    for (const targetModel of uniqueModels) {
      try {
        const response = await testClient.models.generateContent({
          model: targetModel,
          contents: "Say OK",
        });
        if (response && (response as any).text) {
          return res.json({
            success: true,
            message: `Koneksi ke Google Gemini API berhasil! (Model aktif: ${targetModel})`,
            model: targetModel,
          });
        }
      } catch (err) {
        lastErr = err;
        log.warn(
          `[Test API Key] Model ${targetModel} attempt failed:`,
          err?.message || err,
        );
      }
    }
    throw lastErr || new Error("Tidak ada respon dari Gemini API.");
  } catch (err) {
    log.error("Test API Key error:", err);
    return res.status(400).json({ error: formatGeminiError(err) });
  }
});
/* Google synchronization is a placeholder in this release (PRD §6.5): honest, scoped, no fake success. */
app.post(["/api/google-integration/sync", "/api/google-integration/sync-flush"], (req: express.Request, res: express.Response) =>
  sendError(req, res, 409, "SYNC_UNAVAILABLE", "Google synchronization is not available in this release."));
app.get("/api/google-integration/sync-status", (req: express.Request, res: express.Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ organizationId: getRequestTenantId(req), active: false, queueLength: 0, status: "unavailable", syncSupported: false });
});
app.post("/api/google-integration/auto-provision-master", async (req: express.Request, res: express.Response) => {
  const adminCheck = await checkIsAdmin(req);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({
        error:
          "Forbidden: Hanya Admin/Superuser yang berhak membuat Master Root.",
      });
  }
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body?.accessToken,
  );
  if (!token && !hasServiceAccountCredentials()) {
    return res
      .status(400)
      .json({
        error:
          "Koneksi Google belum aktif. Hubungkan akun Google terlebih dahulu.",
      });
  }
  try {
    const rootFolderLink = await createDriveFolder(
      "Master Google Drive Storage (LMS)",
      void 0,
      token,
    );
    const rootFolderId =
      extractFolderIdFromLink(rootFolderLink) || rootFolderLink;
    let spreadsheetId = "";
    const sheet = await createSpreadsheetInFolder(
      "Master Spreadsheet Database (LMS)",
      rootFolderId,
      token,
    );
    if (sheet && sheet.id) {
      spreadsheetId = sheet.id;
    }
    if (!spreadsheetId) {
      throw new Error("Gagal membuat Spreadsheet Database di dalam folder.");
    }
    db.googleConfig.driveFolderId = rootFolderId;
    db.googleConfig.spreadsheetId = spreadsheetId;
    if (token) {
      db.googleConfig.accessToken = token;
    }
    try {
      await autoEnsureTenantGoogleResources(token, true);
    } catch (orgErr) {
      log.warn(
        "[AutoProvision] Warning auto-ensuring org folders:",
        orgErr?.message,
      );
    }
    await saveDb();
    return res.json({
      success: true,
      message:
        "Master Root Folder, Spreadsheet Database, serta Folder Organisasi dan Sheet Database Organisasi berhasil dibuat otomatis di Google Drive.",
      driveFolderId: rootFolderId,
      masterSpreadsheetId: spreadsheetId,
      spreadsheetId,
      tenants: db.tenants,
    });
  } catch (err) {
    log.error("Auto provision master root error:", err);
    return sendRouteError(req, res, err, "request failed", "Gagal membuat Master Root secara otomatis.", { status: 500 });
  }
});
app.post("/api/tenants/auto-provision-folders", async (req: express.Request, res: express.Response) => {
  const adminCheck = await checkIsAdmin(req);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({
        error:
          "Forbidden: Hanya Admin/Superuser yang berhak menyinkronkan folder organisasi.",
      });
  }
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body?.accessToken,
  );
  if (!token && !hasServiceAccountCredentials()) {
    return res
      .status(400)
      .json({
        error:
          "Koneksi Google belum aktif. Hubungkan akun Google terlebih dahulu.",
      });
  }
  try {
    const result = await autoEnsureTenantGoogleResources(token);
    return res.json({
      success: true,
      message: `Berhasil menyinkronkan folder organisasi ke Master Root (${result.updatedCount} organisasi disinkronkan).`,
      tenants: db.tenants,
    });
  } catch (err) {
    log.error("Auto provision tenant folders error:", err);
    return sendRouteError(req, res, err, "request failed", "Gagal menyinkronkan folder organisasi ke Master Root.", { status: 500 });
  }
});
const provisionFoldersHandler = __name(async (req: express.Request, res: express.Response) => {
  const adminCheck = await checkIsAdmin(req);
  if (!adminCheck.isAdmin) {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can provision folders." });
  }
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body?.accessToken,
  );
  try {
    const stats = await ensureAllPartnersFolders(token);
    await saveDb();
    return res.json({
      success: true,
      message: `4 Subfolder Kategori (Folder Contract, Folder Invoice & Billing, Folder IO, Folder DD) berhasil dibuat/diperbarui untuk ${db.partners.length} partner.`,
      stats,
    });
  } catch (err) {
    return sendRouteError(req, res, err, "request failed", "Gagal membuat folder kategori.", { status: 500 });
  }
}, "provisionFoldersHandler");
app.post("/api/google-integration/provision-folders", provisionFoldersHandler);
app.post("/api/partners/provision-folders", provisionFoldersHandler);
/**
 * Reset & organization setup (superuser only).
 *
 * mode "empty": wipes all business data and creates ONE organization from the
 *               supplied profile (name, country, industry, currency, ...),
 *               whose policy packs drive checklists, currency and dates.
 * mode "demo":  wipes all business data and reloads the multi-country demo
 *               dataset, so the product can be explored again.
 *
 * Non-demo login accounts and platform roles are kept without new
 * memberships; AI and SMTP provider credentials are kept because they are
 * deployment configuration, not organization data.
 */
app.post("/api/admin/reset-database", async (req: express.Request, res: express.Response) => {
  const { confirmKeyword, mode = "empty", organization = {} } = req.body || {};
  if (confirmKeyword !== "RESET NOW") {
    return res.status(400).json({ error: 'Invalid confirmation. Type "RESET NOW" to reset the application.' });
  }
  if (mode !== "empty" && mode !== "demo") {
    return res.status(400).json({ error: 'mode must be "empty" or "demo".' });
  }

  const nowIso = new Date().toISOString();
  let dataset: ReturnType<typeof buildDemoDataset>;
  if (mode === "demo") {
    dataset = buildDemoDataset();
  } else {
    const orgName = String(organization.name || "").trim().slice(0, 120) || "My Organization";
    const settings = resolveTenantSettings({
      settings: {
        countryCode: organization.countryCode,
        industry: organization.industry,
        defaultCurrency: organization.defaultCurrency,
        reportingCurrency: organization.reportingCurrency,
        timezone: organization.timezone,
        language: organization.language,
      },
    });
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "organization";
    dataset = {
      tenants: [{
        id: `org_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
        name: orgName,
        legalEntity: String(organization.legalEntity || "").slice(0, 120),
        brandName: orgName,
        tagline: "Contract Lifecycle Management",
        logoUrl: "/favicon.png",
        primaryColor: DEFAULT_BRANDING.primaryColor,
        currency: settings.defaultCurrency,
        settings,
        domainSlug: slug,
        isDefault: true,
        spreadsheetId: "",
        driveFolderId: "",
        created_at: nowIso,
        updated_at: nowIso,
      }],
      departments: [], allowedUsers: [], partners: [], contracts: [], ios: [],
      spendings: [], evaluations: [], notifications: [], activityLogs: [],
    };
  }
  const primaryTenantId = dataset.tenants[0].id;
  const identity = identityOf(req);

  /*
   * Application-wide reset (PRD §2.3, §14.5). Non-demo identities, their
   * credentials and platform roles are kept, but nobody silently gains a
   * membership in the new organization; the acting superuser manages it in
   * platform context. The append-only audit log is never cleared.
   */
  let nextState: Record<string, any> = {};
  try {
    await coreSaver.withSaveLock(() => sql.tx(async () => {
      // Clear editor data and extraction caches with the same reset.
      for (const table of ["contract_comments", "document_metadata", "contract_drafts", "contract_documents", "metadata_fields", "ai_ocr_cache", "search_records", "activity_logs", "upload_owners"]) {
        await sql.run(`DELETE FROM "${table}"`);
      }
      await removeDemoAccounts(sql, [], identity.userId);
      for (const table of ["invitation", "apikey", "teamMember", "team", "member", "organization_settings", "organization_integrations", "organization"]) {
        await sql.run(`DELETE FROM "${table}"`);
      }
      await seedOrganizationsFromDataset(sql, {
        tenants: dataset.tenants,
        departments: dataset.departments,
        allowedUsers: mode === "demo" && process.env.NODE_ENV !== "production" ? dataset.allowedUsers : [],
      });
      await sql.run('UPDATE session SET "activeOrganizationId" = NULL, "activeTeamId" = NULL');
      const tenants = await buildTenantProjection(sql);

      // Built on `db` (tenant policy and migrateLegacyRecords read it), then swapped back before the next await:
      // other handlers keep the committed state until this transaction commits.
      const liveState = { ...db };
      const provider = db.googleConfig || {};
      let snapshot: ReturnType<typeof coreSaver.snapshot>;
      Object.assign(db, {
        tenants,
        allowedUsers: [],
        partners: dataset.partners,
        contracts: dataset.contracts,
        ios: dataset.ios,
        spendings: dataset.spendings,
        evaluations: dataset.evaluations,
        notifications: dataset.notifications,
        activityLogs: dataset.activityLogs,
        templates: [],
        newsTicker: { byTenant: {} },
        branding: { ...DEFAULT_BRANDING },
        customTranslations: {},
        googleConfig: {
          spreadsheetId: "",
          driveFolderId: "",
          masterSpreadsheetId: "",
          masterSpreadsheetUrl: "",
          isConnected: false,
          autoSync: false,
          aiModel: provider.aiModel || "gemini-3.8-flash",
          geminiApiKey: provider.geminiApiKey || "",
          smtpEnabled: Boolean(provider.smtpEnabled),
          smtpHost: provider.smtpHost || "",
          smtpPort: provider.smtpPort,
          smtpSecure: provider.smtpSecure,
          smtpUser: provider.smtpUser || "",
          smtpPassword: provider.smtpPassword || "",
          smtpFromEmail: provider.smtpFromEmail || "",
          smtpFromName: provider.smtpFromName || "",
          refreshToken: "",
          accessToken: "",
        },
      });
      try {
        migrateLegacyRecords();
        snapshot = coreSaver.snapshot();
        nextState = { ...db };
      } finally {
        Object.assign(db, liveState);
      }
      // search_records was emptied above, so no fingerprint may skip a row; the replacement and its business records commit together.
      resetSyncCache(sql);
      await saveCoreData(snapshot);
      await appendAudit(sql, auditActorFor(req, identity), {
        organizationId: null, action: "platform.application.reset", targetType: "installation", targetId: "installation",
        outcome: "success", changedFields: [`mode:${mode}`],
      });
    }));
  } catch (err) {
    resetSyncCache(sql);
    log.error("Error resetting auth organization tables:", err);
    return res.status(500).json({ error: "Failed to reset organization tables." });
  }
  // Mutate `db` in place: the auth console holds a reference to this object.
  Object.assign(db, nextState);

  // After commit: a failed delete leaves an orphaned object, never a record pointing at a missing one.
  // shortcut: one request per object; switch to COS deleteMultipleObject if large buckets make resets slow.
  try {
    const storage = getStore();
    for (const { key } of await storage.list("")) {
      await storage.delete(key).catch((e) => log.error("Error deleting upload during reset:", key, e));
    }
  } catch (e) {
    log.error("Error cleaning uploads during reset:", e);
  }

  await recalculateStatuses();
  await saveDb();
  // Demo accounts get a password only when DEMO_ADMIN_PASSWORD is set.
  if (!IS_TEST_MODE) await ensureUserAccountsExist();
  res.json({
    success: true,
    mode,
    message: mode === "demo"
      ? "The application was reset and the demo dataset was loaded."
      : `The application was reset. Organization "${dataset.tenants[0].name}" is ready to use.`,
    defaultOrgId: primaryTenantId,
  });
});
app.get("/api/google-service-account/status", async (req: express.Request, res: express.Response) => {
  try {
    const creds = loadServiceAccountCredentials();
    const sheets = getGoogleSheetsClient(creds);
    res.json({
      success: true,
      serviceAccount: {
        client_email: creds.client_email,
        project_id: creds.project_id,
        type: creds.type || "service_account",
      },
      message:
        "Otentikasi Google Service Account untuk Google Sheets API berhasil dikonfigurasi.",
    });
  } catch (err: any) {
    sendRouteError(req, res, err, "service account setup failed", "Gagal mengonfigurasi Google Service Account.", { extra: { success: false } });
  }
});
/** Bulk-import row failure text: the cause is logged, the response carries only the row's generic message. */
function bulkRowFailure(err: unknown, fallback: string) {
  log.warn("[bulk-import] row failed:", err);
  return fallback;
}
/** Case-insensitive match against an allowed list: "" when blank, null when not allowed. */
function pickEnum(value: unknown, allowed: readonly string[]): string | null {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) ?? null;
}
const bulkSplitList = (value: unknown) => String(value ?? "").split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
const bulkBool = (value: unknown) => /^(1|true|ya|yes|y)$/i.test(String(value ?? "").trim());
const BULK_PRICING_MODELS = ["CPM", "CPC", "CPA", "Fixed", "Retainer", "Hourly", "Milestone", "Commission", "Subscription"];
const BULK_NOTICE_TYPES = ["Termination", "Extension", "Both", "None"];
const BULK_ENUMS = {
  document_type: ["Master Agreement", "Agreement Addendum"],
  status_approval: ["Draft", "Review", "Signed", "Active"],
  charging_type: ["Prepaid", "Postpaid", "Milestone-based"],
  obligation_target: ["Sangat baik", "Baik", "Kurang baik", "Met", "Not met"],
  incident_frequency: ["Never", "Rare", "Frequent"],
  communication: ["Sangat baik", "Baik", "Kurang baik", "Good", "Poor/Needs Improvement"],
  pricing: ["Cheap", "Moderate", "Expensive"],
  final_evaluation: ["Recommended", "Recommended with notes", "Not recommended", "Not reviewed"],
};
app.post("/api/bulk-import", async (req: express.Request, res: express.Response) => {
  const {
    type,
    rows: rawRows,
    defaultDepartment,
    overrideDepartment,
  } = req.body;
  if (!type || !Array.isArray(rawRows) || rawRows.length === 0) {
    return res
      .status(400)
      .json({ error: "Tipe data dan baris tidak boleh kosong." });
  }
  // Spreadsheet cells arrive as numbers or booleans as often as text, and dates in local formats.
  const invalidDates = new Map<number, string>();
  const rows = rawRows.map((raw, i) => {
    const row: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      row[key] = typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    }
    for (const field of BULK_DATE_FIELDS) {
      if (!(field in row)) continue;
      const normalized = bulkDate(row[field]);
      if (normalized === null) invalidDates.set(i, `${field} harus berformat YYYY-MM-DD atau DD/MM/YYYY.`);
      else row[field] = normalized;
    }
    return row;
  });
  const tenantId = getRequestTenantId(req);
  const tenantCurrency = tenantDefaultCurrency(tenantId);
  const inTenant = (row: any) => isMatchingOrg(row?.organizationId, tenantId);
  const succeeded = [];
  const skipped = [];
  const failed = [];
  const now = new Date().toISOString();
  const defDept =
    typeof defaultDepartment === "string" ? defaultDepartment.trim() : "";
  const forceDept = Boolean(overrideDepartment) && Boolean(defDept);
  if (type === "partners") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const name = (row.partner_name || "").trim();
      if (!name) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom partner_name wajib diisi.",
        });
        continue;
      }
      const exists = db.partners.find(
        (p) => inTenant(p) && inTenant(p) && p.partner_name?.toLowerCase() === name.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: name,
          message: `Partner dengan nama "${name}" sudah ada (ID: ${exists.partner_id}).`,
        });
        continue;
      }
      try {
        const partnerChannel = (
          row.partner_channel ||
          row.codename ||
          row.channel ||
          row.nama_channel ||
          ""
        ).trim();
        let internalPic = (
          row.internal_pic ||
          row.internal_pic ||
          row.picInternal ||
          ""
        ).trim();
        if (forceDept) {
          internalPic = defDept;
        } else if (!internalPic && defDept) {
          internalPic = defDept;
        }
        // Imported references must resolve inside the selected organization (PRD §4.5.2).
        if (internalPic && !scopeOf(req).teamOf(internalPic)) {
          failed.push({ rowIndex, identifier: name, message: `Department "${internalPic}" does not exist in this organization.` });
          continue;
        }
        const fullKontakPic =
          row.pic_contact ||
          (row.pic_email || row.pic_phone
            ? `${(row.pic_email || "").trim()} / ${(row.pic_phone || "").trim()}`
            : "");
        const newPartner = {
          partner_id: generateNextPartnerId(),
          partner_name: name,
          codename: partnerChannel,
          partner_channel: partnerChannel,
          internal_pic: internalPic,
          partner_type: row.partner_type || "Vendor",
          pic_name: row.pic_name || "",
          pic_email: row.pic_email || "",
          pic_phone: row.pic_phone || "",
          pic_address: row.pic_address || "",
          pic_contact: fullKontakPic,
          organizationId: tenantId,
          country: sanitizeCountryCode(row.country) || (row.legal_status_flag === "BHI" ? "ID" : ""),
          entity_type: String(row.entity_type || "").slice(0, 120),
          identifiers: sanitizeIdentifiers(
            bulkSplitList(row.identifiers).map((pair) => {
              const at = pair.indexOf(":");
              return { scheme: at > 0 ? pair.slice(0, at).trim() : "other", value: at > 0 ? pair.slice(at + 1).trim() : pair, country: row.country };
            }),
          ),
          status_dd: "Incomplete",
          notes: row.notes || "",
          tags: sanitizePartnerTags(row.tags),
          dd_documents: [],
          created_at: now,
          updated_at: now,
        };
        newPartner.dd_documents = normalizePartnerDocuments(newPartner);
        newPartner.status_dd = computeDueDiligenceStatus(newPartner.dd_documents);
        db.partners.push(newPartner);
        succeeded.push({
          rowIndex,
          identifier: name,
          message: `Partner berhasil dibuat (ID: ${newPartner.partner_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: name,
          message: bulkRowFailure(err, "Gagal membuat partner."),
        });
      }
    }
  } else if (type === "contracts") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const nomor = (row.contract_number || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom contract_number wajib diisi.",
        });
        continue;
      }
      const exists = db.contracts.find(
        (c) => inTenant(c) && c.contract_number?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `Kontrak "${nomor}" sudah ada (ID: ${exists.contract_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_name || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      try {
        const kategori = bulkSplitList(row.cooperation_categories);
        const jenisDokumen = pickEnum(row.document_type, BULK_ENUMS.document_type);
        const statusApproval = pickEnum(row.status_approval, BULK_ENUMS.status_approval);
        const noticeType = pickEnum(row.notice_type_required, BULK_NOTICE_TYPES);
        const invalid = jenisDokumen === null ? `document_type harus salah satu dari: ${BULK_ENUMS.document_type.join(", ")}.`
          : statusApproval === null ? `status_approval harus salah satu dari: ${BULK_ENUMS.status_approval.join(", ")}.`
          : noticeType === null ? `notice_type_required harus salah satu dari: ${BULK_NOTICE_TYPES.join(", ")}.`
          : "";
        if (invalid) {
          failed.push({ rowIndex, identifier: nomor, message: invalid });
          continue;
        }
        const parentNomor = (row.parent_contract_number || "").trim();
        const parentContract = parentNomor
          ? db.contracts.find((c) => inTenant(c) && c.contract_number?.toLowerCase() === parentNomor.toLowerCase())
          : null;
        if (parentNomor && !parentContract) {
          failed.push({ rowIndex, identifier: nomor, message: `Kontrak induk "${parentNomor}" tidak ditemukan. Impor kontrak induk lebih dulu.` });
          continue;
        }
        let contractPic = (row.internal_pic || "").trim();
        if (forceDept) {
          contractPic = defDept;
        } else if (!contractPic && defDept) {
          contractPic = defDept;
        } else if (!contractPic && partner?.internal_pic) {
          contractPic = partner.internal_pic;
        }
        if (contractPic && !scopeOf(req).teamOf(contractPic)) {
          failed.push({ rowIndex, identifier: nomor, message: `Department "${contractPic}" does not exist in this organization.` });
          continue;
        }
        const newContract = {
          contract_id: generateNextContractId(),
          organizationId: tenantId,
          contract_number: nomor,
          contract_title: row.contract_title || nomor,
          partner_id: partner.partner_id,
          document_type: jenisDokumen || "Master Agreement",
          ...(parentContract ? { parent_contract_id: parentContract.contract_id, parent_contract_number: parentContract.contract_number } : {}),
          cooperation_categories: kategori,
          start_date: row.start_date || "",
          end_date: row.end_date || "",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          contract_value: bulkNumber(row.contract_value),
          auto_renewal: bulkBool(row.auto_renewal),
          notice_period_days: parseInt(row.notice_period_days) || 30,
          notice_type_required: noticeType || "Both",
          internal_pic: contractPic,
          internal_notes: row.internal_notes || "",
          status: "Active",
          status_approval: statusApproval || "Signed",
          created_at: now,
          updated_at: now,
        };
        db.contracts.push(newContract);
        succeeded.push({
          rowIndex,
          identifier: nomor,
          message: `Kontrak berhasil dibuat (ID: ${newContract.contract_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: bulkRowFailure(err, "Gagal membuat kontrak."),
        });
      }
    }
  } else if (type === "ios") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const nomor = (row.io_number || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom io_number wajib diisi.",
        });
        continue;
      }
      const exists = db.ios.find(
        (io) => inTenant(io) && io.io_number?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `IO "${nomor}" sudah ada (ID: ${exists.io_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_name || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      const contractNomor = (row.contract_number || "").trim();
      const contract = db.contracts.find(
        (c) => inTenant(c) && c.contract_number?.toLowerCase() === contractNomor.toLowerCase(),
      );
      const chargingType = pickEnum(row.charging_type, BULK_ENUMS.charging_type);
      const noticeTypeIo = pickEnum(row.notice_type_required, BULK_NOTICE_TYPES);
      if (chargingType === null || noticeTypeIo === null) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: chargingType === null
            ? `charging_type harus salah satu dari: ${BULK_ENUMS.charging_type.join(", ")}.`
            : `notice_type_required harus salah satu dari: ${BULK_NOTICE_TYPES.join(", ")}.`,
        });
        continue;
      }
      try {
        const newIO = {
          io_id: generateNextIOId(),
          organizationId: tenantId,
          io_number: nomor,
          io_title: row.io_title || nomor,
          partner_id: partner.partner_id,
          contract_id: contract?.contract_id || "",
          media_channel: row.media_channel || "",
          start_date: row.start_date || "",
          end_date: row.end_date || "",
          // Standard models are normalised ("cpm" -> "CPM"); anything else is kept as a custom model.
          pricing_model: pickEnum(row.pricing_model, BULK_PRICING_MODELS) || String(row.pricing_model || "").trim() || "Fixed",
          charging_type: chargingType || "Prepaid",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          io_value: bulkNumber(row.io_value),
          deliverables: row.deliverables || "",
          notice_period_days: parseInt(row.notice_period_days) || 14,
          notice_type_required: noticeTypeIo || "Termination",
          internal_notes: row.internal_notes || "",
          status: "Active",
          created_at: now,
          updated_at: now,
        };
        db.ios.push(newIO);
        succeeded.push({
          rowIndex,
          identifier: nomor,
          message: `IO berhasil dibuat (ID: ${newIO.io_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: err.message || "Gagal membuat IO.",
        });
      }
    }
  } else if (type === "evaluations") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const supplierName = (row.supplier_name || "").trim();
      const reviewDate = (row.review_date || "").trim();
      if (!supplierName || !reviewDate) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom supplier_name dan review_date wajib diisi.",
        });
        continue;
      }
      const identifier = `${supplierName} \u2014 ${reviewDate}`;
      const exists = db.evaluations.find(
        (e) =>
          inTenant(e) &&
          e.supplier_name?.toLowerCase() === supplierName.toLowerCase() &&
          e.review_date === reviewDate,
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier,
          message: `Evaluasi untuk "${supplierName}" pada ${reviewDate} sudah ada.`,
        });
        continue;
      }
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === supplierName.toLowerCase(),
      );
      const picks = {
        obligation_target: pickEnum(row.obligation_target, BULK_ENUMS.obligation_target),
        incident_frequency: pickEnum(row.incident_frequency, BULK_ENUMS.incident_frequency),
        communication: pickEnum(row.communication, BULK_ENUMS.communication),
        pricing: pickEnum(row.pricing, BULK_ENUMS.pricing),
        final_evaluation: pickEnum(row.final_evaluation, BULK_ENUMS.final_evaluation),
      } as const;
      const badField = (Object.keys(picks) as Array<keyof typeof picks>).find((key) => !picks[key]);
      if (badField) {
        failed.push({
          rowIndex,
          identifier,
          message: `${badField} wajib diisi dengan salah satu dari: ${BULK_ENUMS[badField].join(", ")}.`,
        });
        continue;
      }
      try {
        const year = (reviewDate.match(/^\d{4}/) || [String(new Date().getFullYear())])[0];
        const newEval = {
          id: `EVAL-${year}-${String(db.evaluations.length + 1).padStart(3, "0")}`,
          organizationId: tenantId,
          review_date: reviewDate,
          year,
          partner_id: partner?.partner_id || "",
          supplier_name: supplierName,
          type_of_work: (row.type_of_work || "General Service").trim(),
          sla_score: parseFloat(row.sla_score) || 60,
          ...picks,
          notes: row.notes || "",
          calculated_score: computeEvaluationScore(picks.obligation_target, picks.incident_frequency, picks.communication, picks.pricing),
          evaluator_email: (req as any).identity?.email || "system",
          evaluator_name: (req as any).identity?.name || "System",
          created_at: now,
          updated_at: now,
        };
        db.evaluations.push(newEval);
        succeeded.push({
          rowIndex,
          identifier,
          message: `Evaluasi berhasil dibuat (ID: ${newEval.id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier,
          message: bulkRowFailure(err, "Gagal membuat evaluasi."),
        });
      }
    }
  } else if (type === "spendings") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const invoiceNumber = (row.invoice_number || "").trim();
      const vendorName = (row.vendor_name || "").trim();
      if (!invoiceNumber || !vendorName) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom invoice_number dan vendor_name wajib diisi.",
        });
        continue;
      }
      const identifier = `${vendorName} \u2014 ${invoiceNumber}`;
      const exists = db.spendings.find(
        (s) => inTenant(s) &&
          s.invoice_number?.toLowerCase() === invoiceNumber.toLowerCase() &&
          s.vendor_name?.toLowerCase() === vendorName.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier,
          message: `Invoice "${invoiceNumber}" untuk "${vendorName}" sudah ada (ID: ${exists.id}).`,
        });
        continue;
      }
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === vendorName.toLowerCase(),
      );
      try {
        const invoiceMonth = normalizeSpendingMonths(row.invoice_month);
        const totalAmount = bulkNumber(row.total_amount);
        const currency = normalizeCurrencyCode(row.currency, tenantCurrency);
        const newSpending = {
          id: generateNextSpendingId(),
          organizationId: tenantId,
          vendor_id: partner?.partner_id || "",
          vendor_name: vendorName,
          invoice_number: invoiceNumber,
          invoice_date: row.invoice_date || "",
          invoice_month: invoiceMonth,
          invoice_description: row.invoice_description || "",
          currency,
          total_amount: totalAmount,
          total_amount_usd: currency === "USD" ? totalAmount : Math.round(convertToUsdWithFallback(totalAmount, currency) * 100) / 100,
          invoice_title: row.invoice_title || "",
          payment_status: String(row.payment_status || "").trim(),
          bank_name: row.bank_name || "",
          bank_account_number: row.bank_account_number || "",
          bank_account_holder_name: row.bank_account_holder_name || "",
        };
        db.spendings.push(newSpending);
        succeeded.push({
          rowIndex,
          identifier,
          message: `Spending berhasil dibuat (ID: ${newSpending.id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier,
          message: bulkRowFailure(err, "Gagal membuat spending."),
        });
      }
    }
  } else {
    return res
      .status(400)
      .json({ error: `Tipe import tidak dikenal: ${type}` });
  }
  await recalculateStatuses(); // once per import: it saves the whole database
  const totalSucceeded = succeeded.length;
  if (totalSucceeded > 0) {
    await addActivityLog(
      "system", "System", "User", "BULK_IMPORT", type.toUpperCase(),
      `Bulk import ${type}: ${totalSucceeded} berhasil, ${skipped.length} dilewati, ${failed.length} gagal.`,
      req,
    );
  }
  return res.json({ succeeded, skipped, failed });
});
/*
 * /api/tenants adapters (PRD §10.1): listing is side-effect free (no global
 * active tenant, no provisioning); switching only updates this session's
 * default; lifecycle writes are platform-only canonical services.
 */
app.get("/api/tenants", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const accessible = await accessibleOrganizations(sql, identity);
  const ids = new Set(accessible.map((o) => o.organizationId));
  const tenants = (db.tenants || []).filter((t: any) => ids.has(t.id)).map((t: any) => ({
    id: t.id, name: t.name, brandName: t.brandName, legalEntity: t.legalEntity, tagline: t.tagline,
    logoUrl: t.logoUrl, primaryColor: t.primaryColor, currency: t.currency, settings: t.settings,
    domainSlug: t.domainSlug, createdAt: t.created_at,
  }));
  const defaultId = identity.sessionDefaultOrganizationId && ids.has(identity.sessionDefaultOrganizationId)
    ? identity.sessionDefaultOrganizationId : null;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, tenants, organizations: accessible, activeTenantId: defaultId });
});
app.post("/api/tenants/switch", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId : req.body?.organizationId;
  try {
    const result = await selectActiveOrganization(sql, identity, Object.assign(Object.create(req), { body: { organizationId: tenantId } }));
    return res.json({ success: true, activeTenantId: result.organizationId });
  } catch (err: any) {
    if (err instanceof RequestDenied || err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.post("/api/tenants", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return sendError(req, res, 400, "INVALID_INPUT", "Organization name is required (1–200 characters).");
  try {
    const id = await sql.tx(async () => {
      const orgId = await createOrganizationRecord(sql, {
        name,
        slug: typeof body.domainSlug === "string" ? body.domainSlug : undefined,
        legalEntity: typeof body.legalEntity === "string" ? body.legalEntity.slice(0, 200) : "",
        brandName: typeof body.brandName === "string" ? body.brandName.slice(0, 200) : name,
        tagline: typeof body.tagline === "string" ? body.tagline.slice(0, 500) : "",
        primaryColor: typeof body.primaryColor === "string" ? body.primaryColor : undefined,
        settings: { countryCode: body.countryCode || body.settings?.countryCode, industry: body.industry || body.settings?.industry, defaultCurrency: body.currency },
      }, identity.userId);
      await appendAudit(sql, auditActorFor(req, identity), {
        organizationId: orgId, action: "organization.create", targetType: "organization", targetId: orgId, outcome: "success", changedFields: ["name"],
      });
      return orgId;
    });
    await refreshTenantProjection();
    return res.status(201).json({ success: true, newTenant: findTenant(id), tenants: db.tenants });
  } catch (err: any) {
    if (err instanceof ApiError || err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
    return sendRouteError(req, res, err, "organization create failed", "The organization could not be created.", { status: 400, code: "INVALID_INPUT", extra: { error: "INVALID_INPUT" } });
  }
});
app.put("/api/tenants/:id", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  try {
    const current = await readOrganizationSettings(sql, req.params.id);
    const body = req.body || {};
    const patch: any = { expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : current.version };
    if (typeof body.name === "string") patch.name = body.name;
    const profile: any = {};
    for (const key of ["legalEntity", "brandName", "tagline", "logoUrl", "primaryColor"]) if (typeof body[key] === "string") profile[key] = body[key];
    if (Object.keys(profile).length) patch.profile = profile;
    if (body.settings && typeof body.settings === "object") patch.policy = body.settings;
    if (typeof body.domainSlug === "string" && body.domainSlug.trim() && body.domainSlug !== current.slug) {
      const slug = body.domainSlug.trim().toLowerCase();
      if (!/^[a-z0-9-]{1,48}$/.test(slug)) return sendError(req, res, 400, "INVALID_INPUT", "Slug may contain lowercase letters, digits and dashes.");
      if (await sql.get("SELECT 1 FROM organization WHERE slug = ? AND id <> ?", slug, req.params.id)) return sendError(req, res, 409, "SLUG_EXISTS");
      try {
        await sql.run("UPDATE organization SET slug = ? WHERE id = ?", slug, req.params.id);
      } catch (err) {
        if (isUniqueViolation(err)) return sendError(req, res, 409, "SLUG_EXISTS"); // taken between the check and the write
        throw err;
      }
    }
    if (patch.name !== undefined || patch.profile || patch.policy) {
      await patchOrganizationSettings(sql, req.params.id, patch, auditActorFor(req, identity));
    }
    await onOrganizationChanged(req.params.id);
    return res.json({ success: true, tenants: db.tenants });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.delete("/api/tenants/:id", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const id = req.params.id;
  if (!findTenant(id)) return sendError(req, res, 404, "RESOURCE_NOT_FOUND");
  // Deleting an organization never cascades into business data (PRD §9.4).
  const owned = ["partners", "contracts", "ios", "spendings", "evaluations", "notifications", "templates"]
    .some((key) => (db[key] || []).some((row: any) => row?.organizationId === id));
  if (owned) return sendError(req, res, 409, "ORGANIZATION_IN_USE", "Move or remove this organization's records first.");
  await sql.tx(async () => {
    await sql.run('DELETE FROM "teamMember" WHERE "teamId" IN (SELECT id FROM team WHERE "organizationId" = ?)', id);
    for (const table of ["member", "team", "invitation", "organization_settings", "organization_integrations"]) {
      await sql.run(`DELETE FROM ${table} WHERE "organizationId" = ?`, id);
    }
    await sql.run('UPDATE session SET "activeOrganizationId" = NULL WHERE "activeOrganizationId" = ?', id);
    await sql.run("DELETE FROM organization WHERE id = ?", id);
    await appendAudit(sql, auditActorFor(req, identity), {
      organizationId: id, action: "organization.delete", targetType: "organization", targetId: id, outcome: "success", changedFields: [],
    });
  });
  await refreshTenantProjection();
  return res.json({ success: true, tenants: db.tenants });
});
/** Legacy Integrations write: validated folder AND sheet mapping through the canonical store. */
app.post("/api/tenants/:id/setup-google", async (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const identity = identityOf(req);
  const current = await readIntegration(sql, ctx.organizationId);
  const body: any = { expectedVersion: typeof req.body?.expectedVersion === "number" ? req.body.expectedVersion : current.version };
  if (req.body?.driveFolderId !== undefined) body.driveFolderId = req.body.driveFolderId || null;
  if (req.body?.spreadsheetId !== undefined) body.spreadsheetId = req.body.spreadsheetId || null;
  try {
    await patchIntegration(sql, ctx.organizationId, body, auditActorFor(req, identity, ctx));
    await onOrganizationChanged(ctx.organizationId);
    return res.json({ success: true, tenant: findTenant(ctx.organizationId) });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.post("/api/tenants/:id/sync-google", (req: express.Request, res: express.Response) =>
  sendError(req, res, 409, "SYNC_UNAVAILABLE", "Google synchronization is not available in this release."));
/** Public presentation branding only (PRD §5.5). */
app.get("/api/branding", (req: express.Request, res: express.Response) => {
  const b = { ...DEFAULT_BRANDING, ...(db.branding || {}) };
  return res.json({
    success: true,
    branding: { appName: b.appName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, footerText: b.footerText, loginHeadline: b.loginHeadline },
  });
});
app.post("/api/branding", async (req: express.Request, res: express.Response) => {
  try {
    const branding = await applyPlatformConfiguration("branding", req.body, auditActorFor(req, identityOf(req)));
    return res.json({ success: true, branding });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
/** Mask all but the last `keep` characters, e.g. bank account numbers. */
function maskTail(value: unknown, keep = 4): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= keep ? "•".repeat(text.length) : `${"•".repeat(Math.min(6, text.length - keep))}${text.slice(-keep)}`;
}
app.post("/api/chat", async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const { query, history } = req.body;
    if (!query && (!history || history.length === 0)) {
      return res.status(400).json({ error: "Query is required" });
    }
    const tenantId = getRequestTenantId(req);
    const settings = getTenantSettings(tenantId);
    const ctx = aiPolicyContext(tenantId);
    const chatScope = scopeOf(req);
    const ctxForChat = orgContextOf(req);
    const visibleTo = (kind: RecordKind) => (row: any) => recordVisible(ctxForChat, chatScope, kind, row);
    const partnerNameOf = (id: string) => db.partners.find((p) => p.partner_id === id && p.organizationId === tenantId)?.partner_name || "";
    /*
     * Privacy by design (PRD §3.4.1, §5.1): only the active tenant's records
     * are sent, and direct identifiers — phone numbers, e-mail addresses,
     * postal addresses, identity/tax numbers and bank account numbers — are
     * stripped or masked before anything leaves this server.
     */
    const dbContext = {
      organization: { name: ctx.organizationName, country: ctx.countryName, industry: ctx.industryName },
      partners: (await readBusinessRows(sql, 'partners', tenantId)).filter(visibleTo("partner")).map((p: any) => ({
        partner_id: p.partner_id || p.id,
        name: p.partner_name,
        codename: p.codename || p.partner_channel || "",
        type: p.partner_type || "Vendor",
        country: p.country || "",
        entity_type: p.entity_type || "",
        dd_status: p.status_dd,
        dd_verified_at: p.dd_verified_date || "",
        internal_owner: p.internal_pic || "",
        contact_name: p.pic_name || "",
        categories: p.tags || [],
        internal_notes: p.notes || p.internal_notes || p.notes || "",
        dd_documents: Array.isArray(p.dd_documents)
          ? p.dd_documents.map((d: any) => ({
              name: d.name,
              status: d.status,
              required: d.required,
              expires_at: d.expiryDate || "",
            }))
          : [],
      })),
      contracts: (await readBusinessRows(sql, 'contracts', tenantId)).filter(visibleTo("contract")).map((c: any) => ({
        contract_id: c.contract_id || c.id,
        reference: c.contract_number,
        title: c.contract_title,
        counterparty: partnerNameOf(c.partner_id),
        partner_id: c.partner_id || "",
        document_type: c.document_type || "Master Agreement",
        parent_reference: c.parent_contract_number || c.parent_number || "",
        categories: c.cooperation_categories || [],
        start_date: c.start_date,
        end_date: c.end_date,
        currency: c.currency,
        value: c.contract_value || 0,
        value_usd: c.contract_value_usd || 0,
        auto_renewal: Boolean(c.auto_renewal),
        notice_period_days: c.notice_period_days || 30,
        notice_type: c.notice_type_required || "Termination",
        status: c.status,
        approval_status: c.status_approval,
        internal_owner: c.internal_pic || "",
        internal_notes: c.internal_notes || c.notes || "",
        change_summary: c.change_summary || "",
        changed_fields: c.changed_fields || [],
        days_remaining: c.days_remaining,
      })),
      commercial_documents: (await readBusinessRows(sql, 'insertion_orders', tenantId)).filter(visibleTo("io")).map((i: any) => {
        const endDateStr = i.end_date || i.completion_date || i.period_end || "";
        const lifecycle = computeLifecycle(i.organizationId, endDateStr, i.status);
        return {
          id: i.io_id || i.id,
          reference: i.io_number,
          title: i.io_title,
          counterparty: partnerNameOf(i.partner_id),
          partner_id: i.partner_id || "",
          contract_reference: i.contract_number || "",
          scope: i.media_channel || i.channel || "",
          start_date: i.start_date || i.period_start || "",
          end_date: endDateStr,
          pricing_model: i.pricing_model || "",
          charging_type: i.charging_type || "",
          payment_scheme: i.payment_scheme || i.pricing_model || "",
          currency: i.currency,
          value: i.io_value || i.total_nominal || 0,
          value_usd: i.io_value_usd || 0,
          deliverables: i.deliverables || "",
          notice_period_days: i.notice_period_days || 14,
          status: lifecycle.status,
          internal_notes: i.internal_notes || i.notes || "",
          days_remaining: lifecycle.daysRemaining,
        };
      }),
      spendings_and_invoices: (await readBusinessRows(sql, 'spendings', tenantId)).filter(visibleTo("spending")).map((s: any) => ({
        spending_id: s.id,
        vendor_name: s.vendor_name || s.partner_name || "",
        vendor_id: s.vendor_id || s.partner_id || "",
        invoice_number: s.invoice_number || "",
        invoice_date: s.invoice_date || "",
        invoice_month: s.invoice_month || s.month || "",
        currency: s.currency,
        total_amount: s.total_amount || s.amount || 0,
        total_amount_usd: s.total_amount_usd || s.amount_usd || 0,
        description: s.invoice_description || s.description || "",
        payment_status: s.payment_status || "",
        bank: [s.bank_name, maskTail(s.bank_account_number)].filter(Boolean).join(" "),
      })),
      evaluations: (await readBusinessRows(sql, 'evaluations', tenantId)).filter(visibleTo("evaluation")).map((e: any) => ({
        evaluation_id: e.id,
        supplier_name: e.supplier_name,
        review_date: e.review_date,
        type_of_work: e.type_of_work,
        sla_score: e.sla_score,
        obligation_target: e.obligation_target,
        communication: e.communication,
        pricing: e.pricing,
        calculated_score: e.calculated_score,
        final_evaluation: e.final_evaluation,
        internal_notes: e.notes || "",
      })),
    };
    // Bounded inputs: the last few messages and only the workspace rows relevant to the question, never the whole workspace.
    const boundedHistory = boundChatHistory<{ role?: string; text: string }>(history, aiLimits);
    const questionText = typeof query === "string" ? query.trim().slice(0, 4000) : "";
    const boundedContext = boundWorkspaceContext(dbContext, questionText, boundedHistory.map((m) => m.text), aiLimits);
    const moduleNote = settings.modules.commercialDocuments
      ? `"commercial_documents" are ${ctx.commercialDocumentLabel}s issued under master agreements.`
      : "";
    const systemInstruction = `You are a context-aware legal, commercial and business assistant embedded in the Legalio contract lifecycle management workspace of ${ctx.organizationName}.
Answer strictly from the workspace JSON below and the ongoing conversation. ${moduleNote}
Contact details, identity/tax numbers and full bank account numbers are intentionally withheld for privacy; if asked for them, say they are not available to the assistant.

Workspace JSON (record_counts has the full totals; when context_note is present only the rows most relevant to the question are listed):
${JSON.stringify(boundedContext)}

Guidelines:
1. When asked about notes, remarks or summaries, check every "internal_notes" field.
2. Keep conversational context; resolve follow-up references ("that contract", "its notes") to previously discussed items.
3. Be concise, direct, professional and accurate. Compute sums, counts and currency breakdowns strictly from the JSON and state the currency of every amount.
4. If a record or note is missing, say so clearly.
5. Never answer with Markdown tables (the chat widget is narrow). Use bullet lists with bold entity names and indented sub-bullets instead.
6. Answer in ${ctx.responseLanguage} unless the user writes in, or asks for, another language.`;
    const contents = [];
    for (const msg of boundedHistory) {
      const role = msg.role === "ai" || msg.role === "model" ? "model" : "user";
      if (!contents.length && role === "model") continue; // trimming may leave a reply without its question
      contents.push({ role, parts: [{ text: msg.text }] });
    }
    if (questionText) {
      const lastMsg = contents[contents.length - 1];
      if (!lastMsg || lastMsg.role !== "user" || lastMsg.parts[0]?.text !== questionText) {
        contents.push({ role: "user", parts: [{ text: questionText }] });
      }
    }
    const modelToUse = getValidAiModel(db.googleConfig?.aiModel || "gemini-3.8-flash");
    const response = await generateContentWithRetryAndFallback({
      model: modelToUse,
      contents,
      config: { systemInstruction, temperature: 0.2 },
    });
    res.json({ success: true, reply: (response as any).text });
  } catch (error: any) {
    log.error("AI Chat Error:", error);
    sendRouteError(req, res, error, "request failed", "Failed to process AI request", { status: 500 });
  }
});
/* ------------------------------------------------------------------ */
/* Health, first-run status, policy packs and tenant settings          */
/* ------------------------------------------------------------------ */
app.get("/api/health", (_req: express.Request, res: express.Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});
// Readiness: the process is up AND PostgreSQL answers. Used by the Docker/compose healthchecks. A fresh install that still
// needs its first-run setup is ready (the setup page must be reachable), so that is reported but is not an error.
app.get("/api/health/ready", async (_req: express.Request, res: express.Response) => {
  res.set("Cache-Control", "no-store");
  try {
    await Promise.race([
      sql.get("SELECT 1 AS ok"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000).unref()),
    ]);
  } catch {
    return res.status(503).json({ status: "unavailable", database: "down", time: new Date().toISOString() });
  }
  res.json({ status: "ok", database: "up", time: new Date().toISOString() });
});

/** True while an install upgraded from an older release still uses the old shipped admin password. */
async function isBootstrapPasswordActive(): Promise<boolean> {
  try {
    const row: any = await sql.get(`
      SELECT password FROM account WHERE "userId" = 'demo-admin' AND "providerId" = 'credential' LIMIT 1
    `);
    if (!row?.password) return false;
    return await verifyPassword({ hash: row.password, password: LEGACY_DEFAULT_ADMIN_PASSWORD });
  } catch {
    return false;
  }
}

/** A fresh install has no Superuser until someone completes the first-run setup page. */
const needsFirstRunSetup = async () => !await sql.get(`SELECT 1 FROM "user" WHERE role = 'superuser' LIMIT 1`);

// Unauthenticated: tells the sign-in page whether to show the first-run setup form instead.
app.get("/api/system/public-status", async (_req: express.Request, res: express.Response) => {
  res.set('Cache-Control', 'no-store').json({
    appName: db.branding?.appName || DEFAULT_BRANDING.appName,
    needsDatabase: false,
    needsSetup: await needsFirstRunSetup(),
    publicUrl: getPublicBaseUrl(),
  });
});

// Unauthenticated, and only usable while no Superuser exists: creates the first admin.
app.post("/api/system/setup", async (req: express.Request, res: express.Response) => {
  if (!await needsFirstRunSetup()) {
    return res.status(409).json({ error: "ALREADY_SET_UP", message: "An administrator already exists. Please sign in." });
  }
  let publicUrl: string;
  try {
    publicUrl = normalizePublicUrl(req.body?.publicUrl);
    if (process.env.BETTER_AUTH_URL?.trim() && publicUrl !== getPublicBaseUrl()) {
      throw new Error(`The deployment already specifies the website URL ${getPublicBaseUrl()}. Use that URL for setup.`);
    }
  } catch (err: any) {
    return res.status(400).json({ error: "INVALID_PUBLIC_URL", message: err.message });
  }
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: "INVALID_SETUP", message: "Enter your name, a valid email, and a password of at least 8 characters." });
  }
  // Uploads have no local fallback, so outside test mode the first admin also connects Tencent COS; tested before the transaction.
  const checked = req.body?.storage || !IS_TEST_MODE ? await checkCosInput(req.body?.storage) : null;
  if (checked && "error" in checked) return res.status(400).json(checked);
  const storage = checked as CosConfig | null; // the tsconfig is not strict, so `checked &&` above does not narrow
  const hashed = await hashPassword(password);
  const id = `usr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    // Re-checked inside the transaction: hashing above yields, so a second request could have won.
    const created = await sql.tx(async () => {
      // Serializes concurrent setups: the loser sees the winner's superuser below.
      await sql.get(`SELECT pg_advisory_xact_lock(hashtext('legalio:setup'))`);
      if (!await needsFirstRunSetup()) return false;
      if (await sql.get(`SELECT 1 FROM "user" WHERE LOWER(email) = ?`, email)) {
        throw Object.assign(new Error("That email is already used by another account."), { status: 409 });
      }
      await sql.run(`
        INSERT INTO "user" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
        VALUES (?, ?, ?, true, 'superuser', false, ?, ?)
      `, id, name, email, now, now);
      await sql.run(`
        INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (?, ?, 'credential', ?, ?, ?, ?)
      `, `acc_${id}`, id, id, hashed, now, now);
      await saveInstallationPublicUrl(sql, publicUrl);
      if (storage) await googleCredentials.saveCos(storage, id);
      return true;
    });
    if (!created) {
      return res.status(409).json({ error: "ALREADY_SET_UP", message: "An administrator already exists. Please sign in." });
    }
  } catch (err: any) {
    // saveCos already updated the in-memory credentials; after a rollback the table is the truth again.
    if (storage) await googleCredentials.init().catch((reloadErr) => log.error("[setup] credential reload failed:", reloadErr));
    const known = err instanceof ApiError || err instanceof RequestDenied;
    if (!known) log.error("[setup] failed:", err);
    return sendApiError(req, res, known ? err.status : 500, "SETUP_FAILED", known ? err.message : "Setup failed.", { error: "SETUP_FAILED" });
  }
  await reloadAuthConfiguration();
  await appendAudit(sql, { actorId: id, actorPlatformRole: "superuser", accessMode: "platform", requestId: String((req as any).requestId || crypto.randomUUID()) }, {
    organizationId: null, action: "platform.setup", targetType: "installation", targetId: "installation", outcome: "success", changedFields: storage ? ["superuser", "publicUrl", "storage"] : ["superuser", "publicUrl"],
  });
  // Outside production the demo-workspace logins stay usable with the same password.
  if (!IS_TEST_MODE) await ensureUserAccountsExist(password);
  log.info(`First-run setup: created superuser ${email}`);
  res.status(201).json({ success: true, publicUrl });
});

app.get("/api/system/status", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const isSuperuser = identity.platformRole === "superuser";
  const google = isSuperuser ? googleCredentials.status() : null;
  res.json({
    isSuperuser,
    defaultAdminPasswordActive: isSuperuser ? await isBootstrapPasswordActive() : false,
    // Drives the "finish setup: connect Google" banner for a fresh install's admin.
    googleSetupIncomplete: Boolean(google && (!google.serviceAccount.source || !google.oauthClient.source)),
    tenantCount: isSuperuser ? (db.tenants || []).length : undefined,
  });
});

app.get("/api/policy-packs", (_req: express.Request, res: express.Response) => {
  res.json({
    countries: listCountryPacks().map((c) => ({
      code: c.code,
      name: c.name,
      region: c.region,
      defaultCurrency: c.defaultCurrency,
      timezone: c.timezone,
      legalForms: c.legalForms,
      identifierSchemes: c.identifierSchemes,
      dataProtectionLaw: c.dataProtectionLaw,
      governingLaw: c.governingLaw,
      disputeVenue: c.disputeVenue,
    })),
    industries: listIndustryPacks().map((i) => ({
      key: i.key,
      name: i.name,
      partnerCategories: i.partnerCategories,
      commercialDocument: i.commercialDocument,
      counterpartyTypes: i.counterpartyTypes,
      contractCurrency: i.contractCurrency || null,
    })),
  });
});

function tenantSettingsPayload(tenantId: string) {
  const tenant = findTenant(tenantId);
  const settings = resolveTenantSettings(tenant);
  const country = getCountryPack(settings.countryCode);
  const industry = getIndustryPack(settings.industry);
  return {
    tenantId: tenant?.id || tenantId,
    tenantName: tenant?.name || "",
    settings,
    country: {
      code: country.code,
      name: country.name,
      legalForms: country.legalForms,
      identifierSchemes: country.identifierSchemes,
      governingLaw: country.governingLaw,
      disputeVenue: country.disputeVenue,
      dataProtectionLaw: country.dataProtectionLaw,
      indirectTaxName: country.indirectTaxName,
      stampDutyConvention: country.stampDutyConvention || null,
      weekend: country.weekend,
      callingCode: country.callingCode,
      formattingLocale: country.formattingLocale,
    },
    industry: {
      key: industry.key,
      name: industry.name,
      partnerCategories: industry.partnerCategories,
      commercialDocument: industry.commercialDocument,
      counterpartyTypes: industry.counterpartyTypes,
      contractCurrency: industry.contractCurrency || null,
    },
    dueDiligenceChecklist: buildDueDiligenceChecklist(settings, { includeDisabled: true }),
  };
}

/** Runtime policy view for operational forms. Not an administrative grant. */
app.get("/api/tenant-settings", (req: express.Request, res: express.Response) => {
  res.json(tenantSettingsPayload(getRequestTenantId(req)));
});
/** Legacy write adapter (PRD §10.1): strict policy/legalEntity fields through the settings service. */
app.put("/api/tenant-settings", async (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  for (const key of Object.keys(body)) {
    if (!["settings", "legalEntity", "expectedVersion", "organizationId"].includes(key)) {
      return sendError(req, res, 400, "INVALID_INPUT", `Unknown field: ${key}`);
    }
  }
  try {
    const current = await readOrganizationSettings(sql, ctx.organizationId);
    const patch: any = { expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : current.version };
    if (body.settings !== undefined) patch.policy = body.settings;
    if (typeof body.legalEntity === "string") patch.profile = { legalEntity: body.legalEntity };
    await patchOrganizationSettings(sql, ctx.organizationId, patch, auditActorFor(req, identityOf(req), ctx));
    await onOrganizationChanged(ctx.organizationId);
    res.json({ success: true, ...tenantSettingsPayload(ctx.organizationId) });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});

/* Canonical tenant administration API (PRD §9). */
app.use("/api", createOrganizationAdminRouter({
  db: sql,
  policyView: (organizationId: string) => tenantSettingsPayload(organizationId),
  providerConfigured: () => hasServiceAccountCredentials() || Boolean(db.googleConfig?.accessToken || db.googleConfig?.refreshToken),
  onOrganizationChanged,
  departmentReferenced: (organizationId: string, department: { id: string; name: string }) => {
    const key = normalizeDepartmentName(department.name);
    return ["partners", "contracts"].some((collection) => (db[collection] || []).some((row: any) =>
      row?.organizationId === organizationId && normalizeDepartmentName(row.internal_pic) === key));
  },
  inviteUrl: (req: express.Request, token: string) => {
    const base = getPublicBaseUrl() || `${req.protocol}://${req.get("host")}`;
    return `${base}/app?accept_invite=${encodeURIComponent(token)}`;
  },
  sendInvitation: async ({ email, organizationName, tenantRole, inviteUrl, expiresAt, inviterName }) => {
    if (IS_TEST_MODE) return false;
    return sendPlatformMail({
      to: email,
      ...await mailTemplates.render('invitation', { organizationName, tenantRole, inviteUrl, expiresAt: String(expiresAt).slice(0, 10), inviterName: inviterName || 'An administrator' }),
    });
  },
  platformConfiguration: {
    read: readPlatformConfiguration,
    patch: async (section: string, values: unknown, actor) => await applyPlatformConfiguration(section, values, actor),
  },
}));

app.use(createPartnersRouter());
app.use(createEvaluationsRouter());
app.use(createSpendingsRouter());
app.use("/api/auth-console", authConsoleRouter);
app.all("/api/*", (req: express.Request, res: express.Response) => {
  sendApiError(req, res, 404, "ROUTE_NOT_FOUND", `API route not found: ${req.method} ${req.path}`);
});
app.use(errorResponder());
/** Graceful shutdown: stop background work, then wait for queued database saves. The caller closes the pool afterwards. */
export async function drain() {
  await stopReminderScheduler();
  await coreSaver.idle();
}
/** Tests only: replaces the Google token verifier. */
export function setGoogleTokenVerifier(verifier: typeof verifyGoogleToken) { verifyGoogleToken = verifier; }
export { app, getFreshGoogleAccessToken, isMatchingOrg, resolveActiveGoogleToken };
