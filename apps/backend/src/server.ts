/**
 * Composition root: builds the Express app (edge middleware, Better Auth boundary, route policies) and mounts the route
 * modules in ./routes. Everything else lives in the modules it imports; `init()` prepares the database-backed state.
 */
import "dotenv/config";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { renameLegacyKeys } from "@legalio/shared/fieldNames";
import { aiContext } from "./aiLimits";
import { sendApiError } from "./apiErrors";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import { setConsoleDbReference, authConsoleRouter, ensureUserAccountsExist } from "./authConsoleRoutes";
import { sql } from "./db";
import { removeDemoAccounts } from "./demoAccounts";
import { demoAdminEmail, demoAdminPassword, shouldSeedDemoAdmin } from "./demoAdmin";
import { createSensitiveRateLimiter, trustProxySetting } from "./edgeConfig";
import { createDocumentRouter } from "./documentRoutes";
import { createApprovalRouter } from "./approvalRoutes";
import { createGoogleCredentialsRouter } from "./googleCredentials";
import { googleCredentials } from "./googleCredentialStore";
import { ensureAllPartnersFolders, getFreshGoogleAccessToken, resolveActiveGoogleToken } from "./googleDrive";
import { RequestDenied, resolveIdentity, sendError } from "./identity";
import { getPublicBaseUrl } from "./installationSettings";
import { auth as betterAuthInstance, loadCoreData, reloadAuthConfiguration } from "./lib/auth";
import { hasServiceAccountCredentials } from "./lib/googleServiceAccountAuth";
import { componentLog, errorResponder, requestLogging } from "./logger";
import { mailTemplates, sendPlatformMail } from "./mailHelpers";
import { syncIdSequences } from "./ids";
import { coreSaver, db, demoData, migrateLegacyRecords, normalizeContractRecord, normalizePartnerRecord, normalizeStoredContracts, normalizeStoredPartners, refreshTenantProjection, saveDb, seedContracts, seedPartners, syncAdderNames } from "./memoryDb";
import { resetSyncCache } from "./normalizedCoreStore";
import { createOrganizationAdminRouter } from "./organizationAdminRoutes";
import { seedOrganizationsFromDataset } from "./organizationProvisioning";
import { isEmptyInstall } from "./organizationSettingsStore";
import { applyPlatformConfiguration, onOrganizationChanged, readPlatformConfiguration } from "./platformSettings";
import { addActivityLog, getRequestTenantId, isMatchingOrg } from "./recordAccess";
import { normalizeDepartmentName } from "./recordScope";
import { recalculateStatuses, reminderScheduler, seedReminderLedger, stopReminderScheduler } from "./reminderJobs";
import { createAdminRouter } from "./routes/admin";
import { createActivityLogsRouter } from "./routes/activityLogs";
import { createAiRouter } from "./routes/ai";
import { createBulkImportRouter } from "./routes/bulkImport";
import { createContractsRouter } from "./routes/contracts";
import { createEvaluationsRouter } from "./routes/evaluations";
import { createGoogleAuthRouter } from "./routes/googleAuth";
import { createGoogleIntegrationRouter } from "./routes/googleIntegration";
import { createInitDataRouter } from "./routes/initData";
import { createIoRouter } from "./routes/io";
import { createNotificationsRouter } from "./routes/notifications";
import { createPartnersRouter } from "./routes/partners";
import { createSearchRouter } from "./routes/search";
import { createSpendingsRouter } from "./routes/spendings";
import { createSystemRouter } from "./routes/system";
import { createSystemSettingsRouter } from "./routes/systemSettings";
import { createTemplatesRouter } from "./routes/templates";
import { createTenantsRouter } from "./routes/tenants";
import { createUploadsRouter } from "./routes/uploads";
import { createUsersRouter } from "./routes/users";
import { BETTER_AUTH_ALLOWED, createAuthorizationMiddleware, isBetterAuthPathAllowed } from "./routePolicies";
import { IS_TEST_MODE } from "./runtimePaths";
import { localizeApiMessages } from "./serverMessages";
import { tenantSettingsPayload } from "./tenantSettingsView";
import { getStore, uploadBackfillRecords } from "./uploadStorage";
import { backfillUploadOwners, uploadBackfillPending } from "./uploadOwnership";
import { contractRepository } from "./repositories/contractRepository";
import { partnerRepository } from "./repositories/partnerRepository";
import { insertRepositoryRows } from "./repositories/seed";
import { ensureSchema } from "./schema";

const log = componentLog("server");

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
  const hasCoreData = ["ios", "spendings", "evaluations", "notifications", "templates", "activityLogs"]
    .some((key) => Array.isArray((initialData as any)[key]) && (initialData as any)[key].length > 0)
    || await contractRepository.anyAtAll() || await partnerRepository.anyAtAll();
  const seedDemoContracts = !(hasCoreData || !freshInstall);

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
  await normalizeStoredPartners();
  await normalizeStoredContracts();
  // Demo-dataset logins share DEMO_ADMIN_PASSWORD, so a production server never keeps them —
  // including servers that created them before this rule existed.
  if (process.env.NODE_ENV === "production") {
    const { allowedUsers, removed } = await removeDemoAccounts(sql, db.allowedUsers || []);
    db.allowedUsers = allowedUsers;
    if (removed) log.info(`Production: removed ${removed} demo login account(s).`);
  }
  // Demo partners and contracts are repository-backed: they commit together with the orders that reference each other.
  // Reverse order keeps the dataset's order (each insert goes to the front).
  await saveDb(seedDemoContracts ? async () => {
    await insertRepositoryRows(sql, { partners: seedPartners, contracts: seedContracts }, { partners: (row) => normalizePartnerRecord(structuredClone(row)), contracts: normalizeContractRecord });
  } : undefined);
  if (await uploadBackfillPending(sql)) {
    const uploadRecords: Array<{ organizationId: string; record: any }> = [];
    for await (const item of uploadBackfillRecords()) uploadRecords.push(item);
    await backfillUploadOwners(sql, uploadRecords);
  }
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
  syncAdderNames();
  await saveDb();
  await syncIdSequences();
  await recalculateStatuses();
  await seedReminderLedger();
  reminderScheduler.start();
}

app.use("/api", createGoogleCredentialsRouter(googleCredentials));

// Create Contract documents: explorer, draft versions, metadata, comments/redlines.
app.use("/api", createDocumentRouter({
  db: sql,
  tenantOf: getRequestTenantId,
  onActivity: (req, event) => addActivityLog("", "", "", event.actionType, "DOCUMENTS", event.description, req, undefined, event.details),
}));
// Document Approval: sequential sign-off on a My Documents item or an uploaded file.
app.use("/api", createApprovalRouter({ db: sql, tenantOf: getRequestTenantId }));

/* Canonical tenant administration API (PRD §9). */
app.use("/api", createOrganizationAdminRouter({
  db: sql,
  policyView: (organizationId: string) => tenantSettingsPayload(organizationId),
  providerConfigured: () => hasServiceAccountCredentials() || Boolean(db.googleConfig?.accessToken || db.googleConfig?.refreshToken),
  onOrganizationChanged,
  departmentReferenced: async (organizationId: string, department: { id: string; name: string }) => {
    const key = normalizeDepartmentName(department.name);
    return await partnerRepository.departmentReferenced(organizationId, key)
      || await contractRepository.departmentReferenced(organizationId, key);
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
app.use(createSystemRouter());
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
