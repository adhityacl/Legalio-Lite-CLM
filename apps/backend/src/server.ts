import { verifyGoogleAccessTokenEmail } from './googleTokenVerifier';
import { createGoogleAuthRouter } from "./routes/googleAuth";
import { createGoogleIntegrationRouter } from "./routes/googleIntegration";
import { checkIsAdmin } from './adminCheck';
import { tenantSettingsPayload } from './tenantSettingsView';
import { createSystemSettingsRouter } from "./routes/systemSettings";
import { onOrganizationChanged, redactProviderConfig, readPlatformConfiguration, PLATFORM_SECTIONS, isMaskedSecret, applyPlatformConfiguration } from './platformSettings';
import { withCurrentUiTextKeys } from './uiTextKeys';
import { createInitDataRouter } from "./routes/initData";
import { normalizeSpendingMonths } from './spendingMonths';
import { createActivityLogsRouter } from "./routes/activityLogs";
import { createSearchRouter } from "./routes/search";
import { createNotificationsRouter } from "./routes/notifications";
import { createTemplatesRouter } from "./routes/templates";
import { createUploadsRouter } from "./routes/uploads";
import { createIoRouter } from "./routes/io";
import { createContractsRouter } from "./routes/contracts";
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

app.use("/api", createGoogleCredentialsRouter(googleCredentials));

// Create Contract documents: explorer, draft versions, metadata, comments/redlines.
app.use("/api", createDocumentRouter({
  db: sql,
  tenantOf: getRequestTenantId,
  onActivity: (req, event) => addActivityLog("", "", "", event.actionType, "DOCUMENTS", event.description, req, undefined, event.details),
}));
// Document Approval: sequential sign-off on a My Documents item or an uploaded file.
app.use("/api", createApprovalRouter({ db: sql, tenantOf: getRequestTenantId }));
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
app.use(createContractsRouter());
app.use(createIoRouter());
app.use(createUploadsRouter());
app.use(createTemplatesRouter());
app.use(createNotificationsRouter());
app.use(createSearchRouter());
app.use(createActivityLogsRouter());
app.use(createInitDataRouter());
app.use(createSystemSettingsRouter());
app.use(createGoogleIntegrationRouter());
app.use(createGoogleAuthRouter());
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
export { app, getFreshGoogleAccessToken, isMatchingOrg, resolveActiveGoogleToken };
export { setGoogleTokenVerifier } from "./googleTokenVerifier";
