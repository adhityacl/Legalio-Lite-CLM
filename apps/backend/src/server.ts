import { verifyGoogleAccessTokenEmail } from './googleTokenVerifier';
import { createUsersRouter } from "./routes/users";
import { createAdminRouter } from "./routes/admin";
import { createAiRouter } from "./routes/ai";
import { createBulkImportRouter } from "./routes/bulkImport";
import { createTenantsRouter } from "./routes/tenants";
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
app.use(createTenantsRouter());
app.use(createBulkImportRouter());
app.use(createAiRouter());
app.use(createAdminRouter());
app.use(createUsersRouter());
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
