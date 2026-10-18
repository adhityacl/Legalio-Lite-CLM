import { createMailTemplateStore } from "./mailTemplateStore";
import { forwardAsyncRouteErrors } from './asyncRoutes';
import { migrateNormalizedCore } from './migrations/003_normalized_core';
import { removeLegacyCoreTables } from './migrations/004_remove_legacy_core';
import { addStatusIndexes } from './migrations/005_status_indexes';
import { BULK_DATE_FIELDS, bulkDate, bulkNumber } from '@legalio/shared/bulkParse';
import { readBusinessRows, searchBusinessRows } from './normalizedCoreStore';
import { SQLiteBackups } from './sqliteBackups';
import { createSQLiteBackupRouter } from './sqliteBackupRoutes';
import { mountSystemConsole } from './systemConsoleHosting';
import "dotenv/config";
import { getPublicBaseUrl, normalizePublicUrl, saveInstallationPublicUrl } from './installationSettings';
import type { UITextOverrides } from '@legalio/types/uiTexts';
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import express from "express";
import { allocationInvoiceMonths, validateSpendingAllocations } from "@legalio/shared/spendingAllocations";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { buildMatrix as buildRbacMatrix, can, hasOrganizationScope, type OrgContext } from "./rbac";
import {
  RequestDenied, accessibleOrganizations, isIdentityBanned, resolveIdentity, resolveLegacyContext, resolveOrganizationContext, sendError,
} from "./identity";
import { BETTER_AUTH_ALLOWED, createAuthorizationMiddleware, isBetterAuthPathAllowed } from "./routePolicies";
import { createOrganizationScope, filterRecords, recordVisible, normalizeDepartmentName, type RecordKind } from "./recordScope";
import { IS_TEST_MODE, LEGACY_DATA_FILE, UPLOADS_DIR, REPOSITORY_DIR, APP_DATA_DIR } from "./runtimePaths";
import {
  ApiError, appendAudit, buildTenantProjection, ensureTenantBoundarySchema, isEmptyInstall, markMigrationApplied,
  migrationApplied, readIntegration, writeIntegrationRow, patchOrganizationSettings, readOrganizationSettings, patchIntegration,
} from "./organizationSettingsStore";
import { auditActorFor, capabilitiesOf, createOrganizationAdminRouter, hasApprovalInvitation, identityResponse, selectActiveOrganization } from "./organizationAdminRoutes";
import { createOrganizationRecord, seedOrganizationsFromDataset } from "./organizationProvisioning";
import { GoogleGenAI, Type } from "@google/genai";
import { OAuth2Client } from "google-auth-library";
import { toNodeHandler } from "better-auth/node";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  auth as betterAuthInstance,
  sqliteDb,
  hydrateCoreDataFromJson,
  syncDbToSqlite,
  loadCoreDataFromSqlite,
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
import { isDemoAccountEmail, removeDemoAccounts } from "./demoAccounts";
import Database from "better-sqlite3";
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
import { createGoogleCredentialStore, createGoogleCredentialsRouter } from "./googleCredentials";
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
const sqliteBackups = new SQLiteBackups(sqliteDb, APP_DATA_DIR);
app.use(sqliteBackups.middleware);
// This app is only ever meant to run behind a reverse proxy (nginx, Cloud
// Run, Codespaces' tunnel — see README: "keep port 3000 closed to the
// internet"), so trust its X-Forwarded-* headers for req.ip/req.protocol.
app.set("trust proxy", true);
const PORT = Number(process.env.PORT) || 3000;
// Google JSON credentials uploaded in the app win over the GOOGLE_* env vars.
const googleCredentials = createGoogleCredentialStore(sqliteDb);
setStoredServiceAccountProvider(googleCredentials.getServiceAccount);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
// Error/status messages follow the UI language (x-app-language header).
app.use("/api", localizeApiMessages);

/*
 * Tenant-boundaries PRD §5/§10: Better Auth is reachable only through the
 * enumerated sign-in/self-service endpoints; Admin- and Organization-plugin
 * routes are denied in favour of the canonical services. Every other /api
 * operation passes the declared route policy (server/routePolicies.ts).
 */
let migrationBlock: string | null = null;
app.all(["/api/auth", "/api/auth/*"], (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith("/api/auth/google/")) return next();
  if (migrationBlock) return sendError(req, res, 503, migrationBlock, "The database must be migrated before this version can serve requests.");
  const path = req.path.replace(/\/$/, "");
  if (!isBetterAuthPathAllowed(path)) return sendError(req, res, 404, "RESOURCE_NOT_FOUND");
  if (BETTER_AUTH_ALLOWED[path] === "self") {
    try {
      resolveIdentity(sqliteDb, req);
    } catch (err: any) {
      if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
      throw err;
    }
  }
  return toNodeHandler(betterAuthInstance)(req, res);
});
app.use(createAuthorizationMiddleware(sqliteDb, { blocked: () => migrationBlock }));

/** Verified organization context attached by the route policy (tenant/orgParam routes only). */
function orgContextOf(req: express.Request): OrgContext {
  const ctx = (req as any).orgContext as OrgContext | undefined;
  if (!ctx) throw new RequestDenied(409, "ORGANIZATION_REQUIRED");
  return ctx;
}

/* Legacy RBAC adapters (PRD §10.1): server-resolved actor, explicit catalogs, no wildcard. */
app.get("/api/rbac/me", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  let ctx: OrgContext | null = null;
  try { ctx = resolveLegacyContext(sqliteDb, identity, req, { includeBody: false }); } catch { ctx = null; }
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
app.post("/api/rbac/check", (req: express.Request, res: express.Response) => {
  const permission = req.body?.permission;
  if (typeof permission !== "string") return sendError(req, res, 400, "INVALID_INPUT", "permission is required.");
  try {
    const ctx = resolveLegacyContext(sqliteDb, resolveIdentity(sqliteDb, req), req, { includeBody: false });
    return res.json({ ok: true, allow: can(ctx, permission) });
  } catch (err: any) {
    if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
    throw err;
  }
});

/** Persists a platform-provisioned folder mapping through the canonical integration store. */
function persistTenantFolder(tenantId: string, folderId: string) {
  try {
    const current = readIntegration(sqliteDb, tenantId);
    const claimed = sqliteDb.prepare("SELECT 1 FROM organization_integrations WHERE driveFolderId = ? AND organizationId <> ?").get(folderId, tenantId);
    if (claimed) return;
    writeIntegrationRow(sqliteDb, { ...current, driveFolderId: folderId, version: current.version + 1 }, null);
    refreshTenantProjection();
  } catch (err: any) {
    console.warn(`[Drive] Could not record folder mapping for ${tenantId}:`, err?.message);
  }
}
async function getOrgFolderId(tenantInput, token) {
  const masterRootId = sanitizeParentFolderId(db.googleConfig?.driveFolderId);
  if (!masterRootId) {
    return { id: "" };
  }
  const tenant = typeof tenantInput === "string" ? findTenant(tenantInput) : tenantInput;
  // No owning organization means no folder: never fall back to another tenant's tree.
  if (!tenant) return { id: "" };
  if (tenant.driveFolderId && !tenant.driveFolderId.startsWith("Folder_")) {
    return { id: tenant.driveFolderId, webViewLink: tenant.driveFolderLink };
  }
  if (IS_TEST_MODE) return { id: "" };
  const activeToken = await resolveActiveGoogleToken(token);
  const orgFolderName = tenant.name || tenant.brandName || "Organisasi";
  try {
    const orgFolder = await getOrCreateDriveFolder(
      orgFolderName,
      masterRootId,
      activeToken,
    );
    if (orgFolder.id) {
      persistTenantFolder(tenant.id, orgFolder.id);
      return orgFolder;
    }
  } catch (err) {
    console.warn(
      `[Drive Hierarchical] Error creating org folder '${orgFolderName}':`,
      err?.message || err,
    );
  }
  return { id: "" };
}
/** Platform-only provisioning of every organization's Drive folder (explicit service authority). */
async function autoEnsureTenantGoogleResources(token, forceNew = false) {
  const masterRootId = sanitizeParentFolderId(db.googleConfig?.driveFolderId);
  if (!masterRootId || IS_TEST_MODE) return { success: false, updatedCount: 0 };
  const activeToken = await resolveActiveGoogleToken(token);
  if (!activeToken && !hasServiceAccountCredentials())
    return { success: false, updatedCount: 0 };
  let updatedCount = 0;
  for (const tenant of db.tenants || []) {
    const needFolder =
      !tenant.driveFolderId ||
      tenant.driveFolderId === masterRootId ||
      tenant.driveFolderId.startsWith("Folder_") ||
      forceNew;
    if (!needFolder) continue;
    try {
      const orgFolderName = tenant.name || tenant.brandName || "Organisasi";
      let orgFolder = null;
      if (forceNew) {
        try {
          orgFolder = await createNewDriveFolderInParent(orgFolderName, masterRootId, activeToken);
        } catch (createErr) {
          console.warn(`[AutoProvision] createNewDriveFolderInParent failed, falling back to getOrCreateDriveFolder:`, createErr?.message);
        }
      }
      if (!orgFolder || !orgFolder.id) {
        orgFolder = await getOrCreateDriveFolder(orgFolderName, masterRootId, activeToken);
      }
      if (orgFolder && orgFolder.id && orgFolder.id !== masterRootId) {
        persistTenantFolder(tenant.id, orgFolder.id);
        updatedCount++;
      }
    } catch (err) {
      console.warn(`[AutoProvision] Failed to create folder for tenant '${tenant.name}':`, err?.message || err);
    }
  }
  return { success: true, updatedCount };
}
async function getPartnerFolderId(partner, token, orgId) {
  if (!partner) {
    const orgFolder2 = await getOrgFolderId(orgId, token);
    return orgFolder2.id || db.googleConfig.driveFolderId;
  }
  const targetOrgId = orgId || partner.organizationId;
  const orgFolder = await getOrgFolderId(targetOrgId, token);
  const parentFolderId = orgFolder.id || db.googleConfig.driveFolderId;
  const extractedId = extractFolderIdFromLink(partner.link_folder_dd);
  if (extractedId) {
    return extractedId;
  }
  const activeToken = await resolveActiveGoogleToken(token);
  if (activeToken || hasServiceAccountCredentials()) {
    try {
      const folderRes = await getOrCreateDriveFolder(
        partner.nama_partner,
        parentFolderId,
        activeToken,
      );
      partner.link_folder_dd = folderRes.webViewLink;
      saveDb();
      return folderRes.id;
    } catch (err) {
      console.warn(
        `[Drive Hierarchical] Failed creating partner folder for '${partner.nama_partner}':`,
        err,
      );
    }
  }
  return parentFolderId;
}
async function getPartnerCategoryFolderId(partner: any, category: string, token?: string, orgId?: string) {
  const vendorFolderId = await getPartnerFolderId(partner, token, orgId);
  if (!vendorFolderId) return db.googleConfig.driveFolderId;
  const activeToken = await resolveActiveGoogleToken(token);
  if (!activeToken && !hasServiceAccountCredentials()) return vendorFolderId;
  try {
    const categoryFolder = await getOrCreateDriveFolder(
      category,
      vendorFolderId,
      activeToken,
    );
    return categoryFolder.id;
  } catch (err) {
    console.error(`Error getting/creating category folder '${category}':`, err);
    return vendorFolderId;
  }
}
const uploadsDir = UPLOADS_DIR;
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
/*
 * Uploaded evidence is private (PRD §11.5). A file is served only when it
 * resolves to persisted records that own it, and the caller can see at least
 * one of those records in that record's organization and department scope.
 * Folder names are never proof of ownership (two organizations can sanitize
 * to the same name), and unowned root files are denied, not deleted.
 */
const UPLOAD_KINDS: Array<[RecordKind, string]> = [
  ["partner", "partners"], ["contract", "contracts"], ["io", "ios"], ["spending", "spendings"], ["evaluation", "evaluations"],
];
let uploadIndex: Map<string, Array<{ kind: RecordKind; record: any }>> | null = null;
function normalizeUploadPath(value: string): string | null {
  try {
    const raw = value.split(/[?#]/)[0];
    const at = raw.indexOf("/uploads/");
    if (at < 0) return null;
    const decoded = decodeURIComponent(raw.slice(at));
    if (decoded.includes("\0") || decoded.split("/").some((seg) => seg === "..")) return null;
    return decoded;
  } catch {
    return null;
  }
}
function uploadOwners(urlPath: string) {
  if (!uploadIndex) {
    uploadIndex = new Map();
    for (const [kind, collection] of UPLOAD_KINDS) {
      for (const record of db[collection] || []) {
        const urls = JSON.stringify(record).match(/\/uploads\/[^"\\]+/g) || [];
        for (const url of urls) {
          const key = normalizeUploadPath(url);
          if (!key) continue;
          const owners = uploadIndex.get(key) || [];
          owners.push({ kind, record });
          uploadIndex.set(key, owners);
        }
      }
    }
  }
  return uploadIndex.get(urlPath) || [];
}
app.use("/uploads", (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (migrationBlock) return res.status(503).end();
  let identity;
  try {
    identity = resolveIdentity(sqliteDb, req);
  } catch (err: any) {
    if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
    throw err;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  const key = normalizeUploadPath(`/uploads${req.path}`);
  if (!key) return res.status(400).end();
  const scopes = new Map<string, any>();
  const allowed = uploadOwners(key).some(({ kind, record }) => {
    if (!record?.organizationId) return false;
    let ctx: OrgContext;
    try {
      ctx = resolveOrganizationContext(sqliteDb, identity, record.organizationId);
    } catch {
      return false;
    }
    if (!can(ctx, "document.view")) return false;
    if (!scopes.has(ctx.organizationId)) scopes.set(ctx.organizationId, createOrganizationScope(sqliteDb, ctx.organizationId, db));
    return recordVisible(ctx, scopes.get(ctx.organizationId), kind, record);
  });
  if (allowed) return next();
  return res.status(404).end();
}, express.static(uploadsDir, { dotfiles: "deny", index: false }));
function saveLocalFile(
  partnerName: any,
  category: string,
  safeFileName: string,
  base64Data: string,
  orgName?: string,
) {
  try {
    const cleanOrg = (orgName || "Organization")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .replace(/^\.+$/, "_")
      .trim();
    const cleanVendor = (partnerName || "Vendor")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .replace(/^\.+$/, "_")
      .trim();
    const subDir = path.join(uploadsDir, cleanOrg, cleanVendor, category);
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
    const filePath = path.join(subDir, safeFileName);
    const cleanContent = base64Data.includes("base64,")
      ? base64Data.split("base64,")[1]
      : base64Data;
    fs.writeFileSync(filePath, Buffer.from(cleanContent, "base64"));
    scheduleDriveBackup(filePath);
    return `/uploads/${encodeURIComponent(cleanOrg)}/${encodeURIComponent(cleanVendor)}/${encodeURIComponent(category)}/${safeFileName}`;
  } catch (err) {
    console.error("Error saving local file in hierarchical subfolder:", err);
    const rootPath = path.join(uploadsDir, safeFileName);
    const cleanContent = base64Data.includes("base64,")
      ? base64Data.split("base64,")[1]
      : base64Data;
    fs.writeFileSync(rootPath, Buffer.from(cleanContent, "base64"));
    return `/uploads/${safeFileName}`;
  }
}
function deleteLocalFileFromUrl(url) {
  if (!url || typeof url !== "string" || !url.includes("/uploads/")) return;
  try {
    const rawRel = url.substring(url.indexOf("/uploads/") + "/uploads/".length);
    const decodedRel = decodeURIComponent(rawRel);
    const fullPath = path.join(uploadsDir, decodedRel);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error("Error deleting temporary local file:", url, err);
  }
}
function getMimeType(fileName) {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "csv") return "text/csv";
  return "application/pdf";
}
// Kept beside (not inside) the uploads dir so it is never served as an upload.
const DRIVE_BACKUP_INDEX = `${uploadsDir}.drive-backup.json`;
let driveBackupRunning = false;
let driveBackupTimer: NodeJS.Timeout | null = null;
/**
 * Mirrors the local uploads tree (Org/Partner/Category) to Drive under the master root.
 * Local files stay the source of truth: links and files are never touched here.
 * `only` limits the pass to those files (relative paths); without it the whole tree is checked.
 * shortcut: a file edited in place is uploaded again as a new Drive file, no version replace.
 * shortcut: a file that fails in an `only` pass is retried by the next full pass (connect, config save, Backup Sekarang).
 */
async function backupLocalFilesToGoogleDrive(token?, only?: string[][]) {
  const rootId = sanitizeParentFolderId(db.googleConfig?.driveFolderId);
  const activeToken = await resolveActiveGoogleToken(token);
  if (!activeToken || !rootId) return { backedUpCount: 0, failedCount: 0 };
  if (driveBackupRunning) return { backedUpCount: 0, failedCount: 0, busy: true };
  driveBackupRunning = true;
  let backedUpCount = 0;
  let failedCount = 0;
  let done: Record<string, string> = {};
  try {
    done = JSON.parse(fs.readFileSync(DRIVE_BACKUP_INDEX, "utf8"));
  } catch (_) {}
  const folderIds = new Map<string, string>();
  const folderFor = async (names: string[]) => {
    let parent = rootId;
    for (const name of names) {
      const key = `${parent}/${name}`;
      if (!folderIds.has(key)) folderIds.set(key, (await getOrCreateDriveFolder(name, parent, activeToken)).id);
      parent = folderIds.get(key)!;
    }
    return parent;
  };
  const walk = (dir: string, rel: string[]): string[][] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(dir, e.name), [...rel, e.name]) : [[...rel, e.name]],
    );
  try {
    for (const parts of only ?? walk(uploadsDir, [])) {
      const key = parts.join("/");
      const full = path.join(uploadsDir, ...parts);
      try {
        const stamp = String(fs.statSync(full).mtimeMs);
        if (done[key] === stamp) continue;
        const driveUrl = await uploadFileToDrive(
          parts[parts.length - 1],
          fs.readFileSync(full).toString("base64"),
          getMimeType(full),
          await folderFor(parts.slice(0, -1)),
          activeToken,
        );
        if (!driveUrl?.includes("google.com")) throw new Error("Respon URL Drive tidak valid");
        done[key] = stamp;
        backedUpCount++;
      } catch (err) {
        failedCount++;
        console.warn(`[Drive Backup] Gagal mencadangkan '${key}':`, err?.message);
      }
    }
  } finally {
    driveBackupRunning = false;
    try {
      fs.writeFileSync(DRIVE_BACKUP_INDEX, JSON.stringify(done));
    } catch (err) {
      console.warn("[Drive Backup] Gagal menyimpan indeks backup:", err?.message);
    }
  }
  if (backedUpCount) console.log(`[Drive Backup] ${backedUpCount} file dicadangkan ke Google Drive.`);
  return { backedUpCount, failedCount };
}
const pendingDriveBackups = new Map<string, string[]>();
/** Debounced so a burst of uploads becomes one pass over just the new files. */
function scheduleDriveBackup(savedFile: string) {
  if (IS_TEST_MODE) return;
  const parts = path.relative(uploadsDir, savedFile).split(path.sep);
  pendingDriveBackups.set(parts.join("/"), parts);
  if (driveBackupTimer) clearTimeout(driveBackupTimer);
  driveBackupTimer = setTimeout(async () => {
    const batch = [...pendingDriveBackups.values()];
    pendingDriveBackups.clear();
    try {
      const result = await backupLocalFilesToGoogleDrive(undefined, batch);
      if (result.busy) for (const parts of batch) pendingDriveBackups.set(parts.join("/"), parts);
    } catch (e) {
      console.warn("[Drive Backup]", e?.message);
    }
    if (pendingDriveBackups.size) scheduleDriveBackup(path.join(uploadsDir, ...[...pendingDriveBackups.values()][0]));
  }, 5000);
}
/** Exact canonical ownership. Records without an organization belong to nobody (PRD §14.3). */
function isMatchingOrg(entityOrgId, targetTenantId) {
  return Boolean(entityOrgId) && Boolean(targetTenantId) && entityOrgId === targetTenantId;
}
/** Request-local department resolver for the verified organization. */
function scopeOf(req: express.Request) {
  const r = req as any;
  if (!r.recordScope) r.recordScope = createOrganizationScope(sqliteDb, orgContextOf(req).organizationId, db);
  return r.recordScope as ReturnType<typeof createOrganizationScope>;
}
/** Records of `kind` the caller may see: own organization, department scope, before any aggregation. */
function scopedRecords<T = any>(req: express.Request, kind: RecordKind, rows: T[] | undefined): T[] {
  const tables: Record<RecordKind, string> = { partner: 'partners', contract: 'contracts', io: 'insertion_orders', spending: 'spendings', evaluation: 'evaluations', notification: 'notifications' };
  const records = readBusinessRows(sqliteDb, tables[kind], orgContextOf(req).organizationId) as T[];
  return filterRecords(orgContextOf(req), scopeOf(req), kind, records);
}
/**
 * Resource boundary for reads/updates/deletes (PRD §5.4): the persisted
 * record must belong to the verified organization and, for department roles,
 * to one of the caller's departments. Anything else answers 404 so IDs of
 * other tenants/departments cannot be probed.
 */
function assertRecordAccess(
  req: express.Request,
  kind: RecordKind,
  record: any,
): { status: number; body: { error: string; message: string } } | null {
  if (record && recordVisible(orgContextOf(req), scopeOf(req), kind, record)) return null;
  return { status: 404, body: { error: "RESOURCE_NOT_FOUND", message: "Resource not found." } };
}
/** Creates/updates may not place a record outside the caller's department scope. */
function assertRecordWritable(req: express.Request, kind: RecordKind, record: any) {
  const ctx = orgContextOf(req);
  if (hasOrganizationScope(ctx)) return null;
  // Rebuild so a just-edited partner/contract name or PIC is resolved fresh.
  const fresh = createOrganizationScope(sqliteDb, ctx.organizationId, db);
  if (recordVisible(ctx, fresh, kind, { ...record, organizationId: ctx.organizationId })) return null;
  return { status: 403, body: { error: "INSUFFICIENT_PERMISSION", message: "The record must belong to one of your departments." } };
}
/** Organization a tenant request operates on: always the verified context, never a default. */
function getRequestTenantId(req: express.Request): string {
  return orgContextOf(req).organizationId;
}
async function ensureAllPartnersFolders(token?: string, targetTenantId?: string) {
  let localFoldersCreated = 0;
  let driveFoldersCreated = 0;
  const activeToken = await resolveActiveGoogleToken(token);
  const partnersToProcess = targetTenantId
    ? (db.partners || []).filter((p) =>
        isMatchingOrg(p.organizationId, targetTenantId),
      )
    : db.partners || [];
  for (const partner of partnersToProcess) {
    if (!partner.nama_partner) continue;
    const orgId = partner.organizationId;
    const tenant = findTenant(orgId);
    if (!tenant) continue; // unowned records are quarantined, never filed under another tenant
    const cleanOrg = (tenant?.name || "Organization")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim();
    const cleanVendor = partner.nama_partner
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim();
    const categories = [
      "Folder Contract",
      "Folder Invoice & Billing",
      "Folder IO",
      "Folder DD",
    ];
    for (const cat of categories) {
      const dirPath = path.join(uploadsDir, cleanOrg, cleanVendor, cat);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        localFoldersCreated++;
      }
    }
    if (activeToken || hasServiceAccountCredentials()) {
      try {
        const vendorFolderId = await getPartnerFolderId(
          partner,
          activeToken,
          orgId,
        );
        if (vendorFolderId) {
          await getOrCreateDriveFolder(
            "Folder Contract",
            vendorFolderId,
            activeToken,
          );
          await getOrCreateDriveFolder(
            "Folder Invoice & Billing",
            vendorFolderId,
            activeToken,
          );
          await getOrCreateDriveFolder(
            "Folder IO",
            vendorFolderId,
            activeToken,
          );
          await getOrCreateDriveFolder(
            "Folder DD",
            vendorFolderId,
            activeToken,
          );
          driveFoldersCreated++;
        }
      } catch (err) {
        console.error(
          `Error provisioning Drive folders for partner ${partner.nama_partner} (${cleanOrg}):`,
          err?.message || err,
        );
        if (
          err.message &&
          err.message.includes("Service Account tidak memiliki akses")
        ) {
          throw err;
        }
      }
    }
  }
  if (activeToken) {
    await backupLocalFilesToGoogleDrive(activeToken);
  }
  return { localFoldersCreated, driveFoldersCreated };
}
const dataFilePath = LEGACY_DATA_FILE;
const DEFAULT_BRANDING = {
  appName: "Legalio CLM",
  logoUrl: "/favicon.png",
  primaryColor: "#0090FF",
  footerText: "Legalio — open-source contract lifecycle management.",
  loginHeadline: "Contract, partner and commercial document management",
};
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
const demoData = buildDemoDataset();
// APP_TEST_MODE never reseeds demo data (PRD §15); fixtures are created explicitly.
const seedData = IS_TEST_MODE
  ? { partners: [], contracts: [], ios: [], notifications: [], activityLogs: [], evaluations: [], spendings: [] }
  : demoData;
let db: any = {
  allowedUsers: [],
  partners: seedData.partners,
  contracts: seedData.contracts,
  ios: seedData.ios,
  notifications: seedData.notifications,
  activityLogs: seedData.activityLogs,
  evaluations: seedData.evaluations,
  spendings: seedData.spendings,
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
bindTenantStore(() => db);

/** Rebuilds the read-only `db.tenants` projection from canonical organization rows (PRD §7.3). */
function refreshTenantProjection() {
  if (migrationBlock) return;
  db.tenants = buildTenantProjection(sqliteDb);
}
setInvalidTokenCallback((badToken) => {
  if (db.googleConfig && db.googleConfig.accessToken === badToken) {
    console.warn(
      "[Server] Membersihkan Google accessToken yang kedaluwarsa dari database.",
    );
    db.googleConfig.accessToken = "";
    saveDb();
  }
});
async function getFreshGoogleAccessToken() {
  const currentToken = db.googleConfig?.accessToken;
  const refreshToken = db.googleConfig?.refreshToken;
  if (!refreshToken) {
    return currentToken || null;
  }
  try {
    const { clientId, clientSecret } = googleCredentials.getOAuthClient();
    const oauth2Client = new OAuth2Client(clientId, clientSecret);
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: currentToken,
    });
    let freshToken = null;
    try {
      const refreshResult = await oauth2Client.refreshAccessToken();
      freshToken = refreshResult.credentials.access_token || null;
    } catch (directRefreshErr) {
      const tokenResponse = await oauth2Client.getAccessToken();
      freshToken = tokenResponse.token || currentToken || null;
    }
    if (freshToken && freshToken !== currentToken) {
      db.googleConfig.accessToken = freshToken;
      db.googleConfig.lastSyncTime = new Date().toISOString();
      saveDb();
      console.log(
        "[Google Auth] Access Token berhasil di-refresh otomatis menggunakan Refresh Token.",
      );
    }
    return freshToken || currentToken || null;
  } catch (err) {
    console.error(
      "[Google Auth] Gagal me-refresh Google Access Token:",
      err.message || err,
    );
    if (err?.message?.includes("invalid_grant")) {
      console.warn(
        "[Google Auth] Refresh token tidak lagi valid (invalid_grant). Menghapus kredensial.",
      );
      db.googleConfig.refreshToken = "";
      db.googleConfig.accessToken = "";
      saveDb();
      return null;
    }
    return currentToken || null;
  }
}
setRefreshTokenGetter(async () => {
  return await getFreshGoogleAccessToken();
});
async function resolveActiveGoogleToken(reqToken) {
  try {
    const freshToken = await getFreshGoogleAccessToken();
    if (freshToken && freshToken.trim() !== "") {
      return freshToken.trim();
    }
  } catch (_) {}
  if (reqToken && typeof reqToken === "string" && reqToken.trim() !== "") {
    return reqToken.trim();
  }
  return db.googleConfig?.accessToken || "";
}
function getEffectiveGeminiApiKey() {
  return (
    db.googleConfig?.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
}
function getGenAIClient(apiKey?: string) {
  const effectiveKey = (apiKey || getEffectiveGeminiApiKey()).trim();
  if (!effectiveKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. Silakan masukkan Gemini API Key di menu Pengaturan (Settings) > Model AI & Parser.",
    );
  }
  return new GoogleGenAI({
    apiKey: effectiveKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}
function getValidAiModel(requestedModel) {
  const allowed = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
  ];
  if (requestedModel === "gemini-2.0-flash" || requestedModel === "gemini-1.5-flash") return "gemini-3.8-flash";
  if (requestedModel === "gemini-3.5-flash-lite") return "gemini-3.5-flash";
  if (requestedModel && allowed.includes(requestedModel)) {
    return requestedModel;
  }
  if (db.googleConfig?.aiModel && allowed.includes(db.googleConfig.aiModel)) {
    return db.googleConfig.aiModel;
  }
  return "gemini-3.8-flash";
}
/**
 * Turns a raw Gemini SDK error into one concise, actionable sentence with a
 * troubleshooting step — never the raw error object, whose `.message` is
 * frequently the entire HTTP error body as a JSON string (e.g.
 * `{"error":{"code":400,"message":"API key not valid...","status":"INVALID_ARGUMENT",...}}`)
 * and would otherwise leak straight through to the UI as-is.
 */
function formatGeminiError(err: any): string {
  const raw = String(err?.message || err?.toString?.() || "");
  let apiMessage = raw;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      apiMessage = parsed?.error?.message || parsed?.message || apiMessage;
    } catch {
      /* not JSON — use the raw message as-is */
    }
  }
  const lower = `${raw} ${apiMessage}`.toLowerCase();

  if (lower.includes("api key not valid") || lower.includes("api_key_invalid") || lower.includes("invalid api key")) {
    return "API Key Gemini tidak valid. Periksa kembali di Settings > Model AI & Parser — pastikan tersalin utuh tanpa spasi, dan key tersebut masih aktif di Google AI Studio.";
  }
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("429")) {
    return "Batas kuota Gemini API Key telah terlampaui (Quota Exceeded / Rate Limit). Periksa akun Google AI Studio atau perbarui API Key di Settings > Model AI & Parser.";
  }
  if (lower.includes("permission_denied") || lower.includes("403")) {
    return "Akses ke Gemini API ditolak. Pastikan API Key memiliki izin Generative Language API dan billing/kuota project aktif di Google AI Studio.";
  }
  if (lower.includes("not_found") || lower.includes("404")) {
    return "Model AI tidak ditemukan atau tidak didukung oleh API Key ini. Coba pilih model lain di Settings > Model AI & Parser.";
  }
  if (lower.includes("unavailable") || lower.includes("503") || lower.includes("timeout") || lower.includes("deadline")) {
    return "Google Gemini API sedang tidak merespons. Periksa koneksi internet Anda, lalu coba lagi beberapa saat lagi.";
  }
  const short = apiMessage.split("\n")[0].slice(0, 160);
  return `Google Gemini API mengembalikan error: ${short}. Periksa koneksi internet dan status API Key di Settings > Model AI & Parser, lalu coba lagi.`;
}
async function generateContentWithRetryAndFallback(params: any) {
  const apiKey = getEffectiveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. Silakan masukkan Gemini API Key di menu Pengaturan (Settings) > Model AI & Parser.",
    );
  }
  const aiClient = getGenAIClient(apiKey);
  const primaryModel = getValidAiModel(params.model);
  const candidateFallbacks = [
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
  ];
  const fallbackModels = candidateFallbacks.filter((m) => m !== primaryModel);
  const modelQueue = [primaryModel, ...fallbackModels];
  let lastError: any = null;
  const PER_ATTEMPT_TIMEOUT_MS = 35000;

  for (const model of modelQueue) {
    try {
      console.log(`[Gemini API] Processing request with model=${model}...`);
      const response = await Promise.race([
        aiClient.models.generateContent({ ...params, model }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Timeout: model ${model} took longer than ${PER_ATTEMPT_TIMEOUT_MS / 1000}s`,
                ),
              ),
            PER_ATTEMPT_TIMEOUT_MS,
          ),
        ),
      ]);
      console.log(`[Gemini API] Success with model=${model}`);
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = (err?.message || err?.toString() || "").toLowerCase();
      console.warn(`[Gemini API] Model ${model} encountered an issue (${errMsg.slice(0, 120)}), trying fallback...`);
    }
  }

  if (!lastError) {
    throw new Error("Google AI Gemini model sedang sibuk atau tidak merespons. Silakan coba lagi beberapa saat lagi.");
  }
  throw new Error(formatGeminiError(lastError));
}
__name(
  generateContentWithRetryAndFallback,
  "generateContentWithRetryAndFallback",
);
function normalizeParsedDate(str) {
  if (!str || typeof str !== "string") return "";
  const trimmed = str.trim();
  if (
    trimmed === "-" ||
    trimmed === "N/A" ||
    trimmed === "n/a" ||
    trimmed === ""
  )
    return "";
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  const ymd = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const year = ymd[1];
    const month = ymd[2].padStart(2, "0");
    const day = ymd[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const monthsMap = {
    januari: "01",
    january: "01",
    jan: "01",
    februari: "02",
    february: "02",
    feb: "02",
    maret: "03",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    mei: "05",
    may: "05",
    juni: "06",
    june: "06",
    jun: "06",
    juli: "07",
    july: "07",
    jul: "07",
    agustus: "08",
    august: "08",
    agu: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    oktober: "10",
    october: "10",
    okt: "10",
    oct: "10",
    november: "11",
    nov: "11",
    desember: "12",
    december: "12",
    des: "12",
    dec: "12",
  };
  const cleanedStr = trimmed
    .replace(/(st|nd|rd|th),?/gi, "")
    .replace(/,/g, " ");
  const words = cleanedStr.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const day1 = parseInt(words[0], 10);
    const mKey1 = words[1].toLowerCase();
    const year1 = parseInt(words[2], 10);
    if (!isNaN(day1) && monthsMap[mKey1] && !isNaN(year1) && year1 > 1900) {
      return `${year1}-${monthsMap[mKey1]}-${String(day1).padStart(2, "0")}`;
    }
    const mKey2 = words[0].toLowerCase();
    const day2 = parseInt(words[1], 10);
    const year2 = parseInt(words[2], 10);
    if (monthsMap[mKey2] && !isNaN(day2) && !isNaN(year2) && year2 > 1900) {
      return `${year2}-${monthsMap[mKey2]}-${String(day2).padStart(2, "0")}`;
    }
  }
  const timestamp = Date.parse(trimmed);
  if (!isNaN(timestamp)) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}
function computeContractEndDateFromDuration(
  startDateYMD: string,
  durationOrClause: string,
  autoRenewNextYear?: boolean,
) {
  if (!startDateYMD || !durationOrClause) return null;
  const parts = startDateYMD.split("-").map(Number);
  if (
    parts.length !== 3 ||
    isNaN(parts[0]) ||
    isNaN(parts[1]) ||
    isNaN(parts[2])
  )
    return null;
  const [year, month, day] = parts;
  const text = durationOrClause.toLowerCase();
  if (
    /sampai pengakhiran|until terminated|salah satu pihak mengakhiri|terus menerus|tanpa batas|unlimited|perpetual|tacit renewal|selamanya/i.test(
      text,
    )
  ) {
    const prevDay = new Date(year, month - 1, day);
    prevDay.setDate(prevDay.getDate() - 1);
    const prevMonth = String(prevDay.getMonth() + 1).padStart(2, "0");
    const prevDate = String(prevDay.getDate()).padStart(2, "0");
    return { endDate: `9999-${prevMonth}-${prevDate}`, isAutoRenewal: true };
  }
  let yearsToAdd = 0;
  let monthsToAdd = 0;
  let daysToAdd = 0;
  const yearMatch = text.match(/(\d+)\s*(tahun|thn|year|yr|years)/i);
  if (yearMatch) {
    yearsToAdd = parseInt(yearMatch[1], 10);
  }
  const monthMatch = text.match(/(\d+)\s*(bulan|bln|month|months|mo)/i);
  if (monthMatch) {
    monthsToAdd = parseInt(monthMatch[1], 10);
  }
  const dayMatch = text.match(/(\d+)\s*(hari|day|days)/i);
  if (dayMatch && !monthMatch && !yearMatch) {
    daysToAdd = parseInt(dayMatch[1], 10);
  }
  if (yearsToAdd === 0 && monthsToAdd === 0 && daysToAdd === 0) {
    if (
      /satu\s*tahun|1\s*\(satu\)\s*tahun|one\s*year|1\s*\(one\)\s*year|setahun/i.test(
        text,
      )
    ) {
      yearsToAdd = 1;
    } else if (
      /dua\s*tahun|2\s*\(dua\)\s*tahun|two\s*years|2\s*\(two\)\s*years/i.test(
        text,
      )
    ) {
      yearsToAdd = 2;
    } else if (/tiga\s*tahun|3\s*\(tiga\)\s*tahun|three\s*years/i.test(text)) {
      yearsToAdd = 3;
    } else if (/lima\s*tahun|5\s*\(lima\)\s*tahun|five\s*years/i.test(text)) {
      yearsToAdd = 5;
    } else if (/enam\s*bulan|6\s*\(enam\)\s*bulan|six\s*months/i.test(text)) {
      monthsToAdd = 6;
    } else if (/tiga\s*bulan|3\s*\(tiga\)\s*bulan|three\s*months/i.test(text)) {
      monthsToAdd = 3;
    } else if (
      /satu\s*bulan|1\s*\(satu\)\s*bulan|one\s*month|sebulan/i.test(text)
    ) {
      monthsToAdd = 1;
    } else if (
      /dua\s*belas\s*bulan|12\s*\(dua\s*belas\)\s*bulan|twelve\s*months/i.test(
        text,
      )
    ) {
      yearsToAdd = 1;
    } else if (/dua\s*puluh\s*empat\s*bulan|24\s*bulan/i.test(text)) {
      yearsToAdd = 2;
    }
  }
  const hasAutoRenewalClause =
    autoRenewNextYear ||
    /perpanjangan otomatis|auto[\s\-]renewal|automatically renew|diperpanjang otomatis/i.test(
      text,
    );
  if (
    hasAutoRenewalClause &&
    /1\s*tahun berikutnya|satu tahun berikutnya|another 1 year|one additional year/i.test(
      text,
    )
  ) {
    yearsToAdd += 1;
  }
  if (yearsToAdd === 0 && monthsToAdd === 0 && daysToAdd === 0) return null;
  const targetDate = new Date(
    year + yearsToAdd,
    month - 1 + monthsToAdd,
    day + daysToAdd,
  );
  targetDate.setDate(targetDate.getDate() - 1);
  const resYear = targetDate.getFullYear();
  const resMonth = String(targetDate.getMonth() + 1).padStart(2, "0");
  const resDay = String(targetDate.getDate()).padStart(2, "0");
  return {
    endDate: `${resYear}-${resMonth}-${resDay}`,
    isAutoRenewal: hasAutoRenewalClause,
  };
}
__name(
  computeContractEndDateFromDuration,
  "computeContractEndDateFromDuration",
);
/*
 * Startup (PRD §14.1): a fresh install initializes the canonical schema
 * directly; an existing database must have run 002_tenant_boundaries,
 * otherwise the API stays in a controlled MIGRATION_REQUIRED state and no
 * legacy administrative projection is hydrated or saved.
 */
ensureTenantBoundarySchema(sqliteDb);
const freshInstall = isEmptyInstall(sqliteDb);
if (freshInstall) {
  if (!IS_TEST_MODE) {
    seedOrganizationsFromDataset(sqliteDb, demoData, {
      bootstrapSuperuser: shouldSeedDemoAdmin && demoAdminEmail && demoAdminPassword
        ? { id: "demo-admin", email: demoAdminEmail, name: "Legalio Admin" }
        : undefined,
    });
  }
  markMigrationApplied(sqliteDb, { freshInstall: true });
} else if (!migrationApplied(sqliteDb)) {
  migrationBlock = "MIGRATION_REQUIRED";
  console.error("[startup] Legacy data found without migration 002_tenant_boundaries. Run `npm run tenant-boundaries:migrate` (dry-run, then --apply) before starting this version.");
}
if (!migrationBlock && !IS_TEST_MODE && shouldSeedDemoAdmin && demoAdminEmail && demoAdminPassword
  && !sqliteDb.prepare(`SELECT 1 FROM "user" WHERE id = 'demo-admin' OR LOWER(email) = ?`).get(demoAdminEmail)) {
  seedOrganizationsFromDataset(sqliteDb, { tenants: [], departments: [], allowedUsers: [] }, {
    bootstrapSuperuser: { id: "demo-admin", email: demoAdminEmail, name: "Legalio Admin" },
  });
  console.log(`Seeded bootstrap superuser: ${demoAdminEmail}`);
}
if (!migrationBlock) {
  const result = migrateNormalizedCore(sqliteDb, path.join(APP_DATA_DIR, 'backups', `before-normalized-core-${Date.now()}.db`));
  if (result.applied) console.log('Normalized SQLite business schema:', result.counts);
  const cleanup = removeLegacyCoreTables(sqliteDb, path.join(APP_DATA_DIR, 'backups', `before-remove-legacy-core-${Date.now()}.db`));
  if (cleanup.applied) console.log('Removed legacy SQLite snapshots:', cleanup.tables);
  if (addStatusIndexes(sqliteDb).applied) console.log('Added status indexes for dashboard and list queries.');
}
const sqliteInitialData = loadCoreDataFromSqlite();
const sqliteHasCoreData = ["partners", "contracts", "ios", "spendings", "evaluations", "notifications", "templates", "activityLogs"]
  .some((key) => Array.isArray((sqliteInitialData as any)[key]) && (sqliteInitialData as any)[key].length > 0);

// An initialized workspace may intentionally contain no business records after a reset.
if (sqliteHasCoreData || !freshInstall) {
  db = { ...db, ...sqliteInitialData,
    branding: sqliteInitialData.branding ?? db.branding,
    googleConfig: sqliteInitialData.googleConfig ?? db.googleConfig,
    newsTicker: sqliteInitialData.newsTicker ?? db.newsTicker,
  };
  console.log("Database loaded from SQLite as the source of truth.");
} else if (!IS_TEST_MODE && fs.existsSync(dataFilePath)) {
  try {
    const raw = fs.readFileSync(dataFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    db = { ...db, ...parsed };
    if (!migrationBlock) hydrateCoreDataFromJson(db);
    console.log("Imported legacy data_store.json into SQLite.");
  } catch (err) {
    console.error("Error importing data_store.json, using seed defaults", err);
  }
} else {
  db = {
    ...db,
    allowedUsers: sqliteInitialData.allowedUsers || [],
    branding: sqliteInitialData.branding || db.branding,
    googleConfig: sqliteInitialData.googleConfig || db.googleConfig,
    newsTicker: sqliteInitialData.newsTicker || db.newsTicker,
  };
  console.log("SQLite is empty; using seed defaults for the first initialization.");
}
// Only the canonical tables define organizations; legacy snapshot rows are migration input.
db.tenants = [];
delete db.departments;
delete db.activeTenantId;
refreshTenantProjection();
migrateLegacyRecords();
/**
 * Bring records written by earlier releases in line with the current model:
 * - Indonesian status labels become stable codes (see src/lib/domainStatus);
 * - due-diligence checklists are rebuilt from the tenant's policy packs,
 *   keeping every document that was already uploaded.
 * Idempotent: running it on migrated data changes nothing.
 */
function migrateLegacyRecords() {
  // Organization ownership is never guessed here: records without a canonical
  // organization stay quarantined until the 002 migration maps them (PRD §14.3).
  if (!db.templates) db.templates = [];
  (db.partners || []).forEach((p: any) => {
    if (p.country === undefined && p.badan_hukum) {
      // BHI = "Badan Hukum Indonesia"; BHA = foreign entity of unknown country.
      p.country = p.badan_hukum === "BHI" ? "ID" : "";
    }
    p.daftar_dokumen_dd = normalizePartnerDocuments(p);
    p.status_dd = computeDueDiligenceStatus(p.daftar_dokumen_dd);
  });
  (db.contracts || []).forEach((c: any) => {
    c.status = normalizeContractStatus(c.status);
    c.status_approval = normalizeApprovalStatus(c.status_approval);
    c.currency = normalizeCurrencyCode(c.currency || c.mata_uang, tenantDefaultCurrency(c.organizationId));
  });
  (db.ios || []).forEach((io: any) => {
    io.status = normalizeContractStatus(io.status);
    io.currency = normalizeCurrencyCode(io.currency || io.mata_uang, tenantDefaultCurrency(io.organizationId));
    io.mata_uang = io.currency;
  });
  (db.spendings || []).forEach((sp: any) => {
    sp.currency = normalizeCurrencyCode(sp.currency, tenantDefaultCurrency(sp.organizationId));
  });
}
// Demo-dataset logins share DEMO_ADMIN_PASSWORD, so a production server never keeps them —
// including servers that created them before this rule existed.
if (process.env.NODE_ENV === "production") {
  const { allowedUsers, removed } = removeDemoAccounts(sqliteDb, db.allowedUsers || []);
  db.allowedUsers = allowedUsers;
  if (removed) console.log(`Production: removed ${removed} demo login account(s).`);
}
saveDb();
// The auth console reads platform configuration (SMTP) from `db`; it no longer
// hydrates identities, memberships or organizations from this projection.
setConsoleDbReference(db, saveDb, (organizationId?: string) => (organizationId ? onOrganizationChanged(organizationId) : refreshTenantProjection()));
if (!IS_TEST_MODE && !migrationBlock) {
  ensureUserAccountsExist();
  ensureAllPartnersFolders().catch((err) =>
    console.error("Startup category folder provisioning error:", err),
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
    saveDb();
  }
}
function generateNextPartnerId() {
  let maxNum = 0;
  for (const p of db.partners || []) {
    if (!p.partner_id) continue;
    const match = p.partner_id.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num < 1e6) {
        if (num > maxNum) maxNum = num;
      }
    }
  }
  if (maxNum === 0 && db.partners && db.partners.length > 0) {
    maxNum = db.partners.length;
  }
  const nextNum = maxNum + 1;
  return `P${String(nextNum).padStart(4, "0")}`;
}
function generateNextContractId() {
  let maxNum = 0;
  for (const c of db.contracts || []) {
    if (!c.contract_id) continue;
    const match = c.contract_id.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num < 1e6) {
        if (num > maxNum) maxNum = num;
      }
    }
  }
  if (maxNum === 0 && db.contracts && db.contracts.length > 0) {
    maxNum = db.contracts.length;
  }
  const nextNum = maxNum + 1;
  return `C${String(nextNum).padStart(4, "0")}`;
}
function generateNextIOId() {
  let maxNum = 0;
  for (const io of db.ios || []) {
    if (!io.io_id) continue;
    const match = io.io_id.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num < 1e6) {
        if (num > maxNum) maxNum = num;
      }
    }
  }
  if (maxNum === 0 && db.ios && db.ios.length > 0) {
    maxNum = db.ios.length;
  }
  const nextNum = maxNum + 1;
  return `IO${String(nextNum).padStart(4, "0")}`;
}
function generateNextSpendingId() {
  let maxNum = 0;
  for (const s of db.spendings || []) {
    if (!s.id) continue;
    const match = s.id.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num < 1e6) {
        if (num > maxNum) maxNum = num;
      }
    }
  }
  if (maxNum === 0 && db.spendings && db.spendings.length > 0) {
    maxNum = db.spendings.length;
  }
  const nextNum = maxNum + 1;
  return `SP${String(nextNum).padStart(4, "0")}`;
}
function sanitizePartnerTags(tags) {
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
function sanitizeCountryCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
/**
 * Partner identifiers (PRD §3.2.2): `{ scheme, value, country }`. Values are
 * kept as entered — format checks are advisory only and done client-side.
 */
function sanitizeIdentifiers(value: unknown): Array<{ scheme: string; value: string; country: string }> {
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
if (db.partners && Array.isArray(db.partners)) {
  db.partners = db.partners.map((p) => ({
    ...p,
    tags: sanitizePartnerTags(p.tags),
  }));
  saveDb();
}
// Statuses only change when a date passes or a contract is saved, so a minute-old pass is as good as a new one.
let lifecyclesFreshUntil = 0;
function saveDb() {
  uploadIndex = null;
  lifecyclesFreshUntil = 0;
  if (migrationBlock) return; // never persist legacy projections before migration
  try {
    syncDbToSqlite(db);
  } catch (err) {
    console.error("Failed to save core data to SQLite", err);
    Object.assign(db, loadCoreDataFromSqlite());
    if (String((err as any)?.code || '').startsWith('SQLITE_CONSTRAINT')) (err as any).status = 409;
    throw err;
  }
}
function triggerAutoPushToGoogleSheet(_req?: any, _options?: any): Promise<void> {
  return Promise.resolve();
}
function syncAdderNames() {
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
  db.activityLogs.forEach((log) => {
    if (log.userEmail) {
      const matchedUser = userByEmail.get(log.userEmail.trim().toLowerCase());
      if (matchedUser) {
        log.userName = matchedUser.name;
      }
    }
  });
}
syncAdderNames();
saveDb();
const mailTemplates = createMailTemplateStore(sqliteDb);
async function sendSmtpEmail({
  to,
  subject,
  html,
  text,
}: {
  to: any;
  subject: any;
  html?: any;
  text?: any;
}) {
  const config = db.googleConfig;
  if (!config.smtpEnabled || !config.smtpHost || !config.smtpUser) {
    return {
      success: false,
      error: "SMTP Relay belum diaktifkan atau belum dikonfigurasi.",
    };
  }
  try {
    const port = Number(config.smtpPort) || (config.smtpSecure ? 465 : 587);
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port,
      secure: config.smtpSecure ?? port === 465,
      auth: { user: config.smtpUser, pass: config.smtpPassword || "" },
      tls: { rejectUnauthorized: false },
    });
    const fromAddress = config.smtpFromEmail || config.smtpUser;
    const fromName = config.smtpFromName || "Sistem Notifikasi Kontrak & IO";
    const from = `"${fromName}" <${fromAddress}>`;
    const recipients = Array.isArray(to) ? to.join(", ") : to;
    const info = await transporter.sendMail({
      from,
      to: recipients,
      subject,
      text: text || html.replace(/<[^>]*>/g, ""),
      html,
    });
    console.log(
      `[SMTP Relay] Email successfully sent to ${recipients} (MessageId: ${info.messageId})`,
    );
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("[SMTP Relay Error]", err);
    return { success: false, error: err.message || String(err) };
  }
}
/** Platform mail delivery used after commit; false when not delivered (never throws). */
async function sendPlatformMail(input: { to: string; subject: string; html: string }): Promise<boolean> {
  if (IS_TEST_MODE) return false;
  const result = await sendSmtpEmail(input);
  return Boolean(result?.success);
}
setVerificationMailer(async ({ email, name, url }) => {
  const sent = await sendPlatformMail({ to: email, ...mailTemplates.render('verification', { email, name, url }) });
  if (!sent) throw new Error("Verification email delivery is unavailable.");
});
function daysUntilForTenant(tenantId: string | null | undefined, date: string): number | null {
  return computeLifecycle(tenantId, date, "Active").daysRemaining;
}
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
/** Formatting locale for a tenant's e-mail/document language. */
function localeForTenantLanguage(settings: ReturnType<typeof getTenantSettings>): string {
  if (settings.language === "ID") return "id-ID";
  if (settings.language === "ZH") return "zh-CN";
  return getCountryPack(settings.countryCode).formattingLocale;
}
function formatAmountForTenant(amount: unknown, currency: string, tenantId?: string | null): string {
  const settings = getTenantSettings(tenantId);
  const locale = localeForTenantLanguage(settings);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: normalizeCurrencyCode(currency, settings.defaultCurrency) }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${Number(amount) || 0}`;
  }
}
/** Reminder e-mail in the tenant's language, with its own name and colour. */
function buildReminderEmail(params: {
  tenantId: string;
  kind: "contract" | "commercial";
  reference: string;
  title: string;
  endDate: string;
  daysRemaining: number;
  rows: Array<[string, string]>;
}): { subject: string; html: string } {
  const settings = getTenantSettings(params.tenantId);
  const tenant = findTenant(params.tenantId);
  const brandColor = /^#[0-9a-f]{6}$/i.test(tenant?.primaryColor || "") ? tenant.primaryColor : DEFAULT_BRANDING.primaryColor;
  const orgName = tenantDisplayName(params.tenantId);
  // en/id/zh in that order, matching settings.language.
  const pick = <T,>(en: T, id: T, zh: T): T => (settings.language === "ID" ? id : settings.language === "ZH" ? zh : en);
  const docLabel = params.kind === "contract"
    ? pick("Contract", "Kontrak", "合同")
    : getIndustryPack(settings.industry).commercialDocument.label;
  const subject = pick(
    `[${params.daysRemaining}-day reminder] ${docLabel} ${params.reference} — ${params.title}`,
    `[Pengingat ${params.daysRemaining} hari] ${docLabel} ${params.reference} — ${params.title}`,
    `【提醒：还剩 ${params.daysRemaining} 天】${docLabel} ${params.reference} — ${params.title}`,
  );
  const heading = pick(`${docLabel} approaching expiry`, `${docLabel} akan berakhir`, `${docLabel}即将到期`);
  const intro = pick(
    `The following ${docLabel.toLowerCase()} expires in ${params.daysRemaining} days. Please review any notice, renewal or termination action required.`,
    `${docLabel} berikut akan berakhir dalam ${params.daysRemaining} hari. Mohon tinjau kebutuhan pemberitahuan, perpanjangan, atau pengakhiran.`,
    `以下${docLabel}将在 ${params.daysRemaining} 天后到期，请审阅所需的通知、续约或终止事项。`,
  );
  const tableRows = [
    [pick("Reference", "Nomor", "编号"), params.reference],
    [pick("Title", "Judul", "名称"), params.title],
    [pick("End date", "Tanggal berakhir", "结束日期"), params.endDate],
    ...params.rows,
  ]
    .map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;width:35%;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join("");
  const footer = pick(
    `Automated e-mail from Legalio for ${orgName}.`,
    `E-mail otomatis dari Legalio untuk ${orgName}.`,
    `此邮件由 Legalio 为 ${orgName} 自动发送。`,
  );
  return mailTemplates.render(params.kind === 'contract' ? 'contract-reminder' : 'commercial-reminder', {
    subject, heading, intro, brandColor, details: tableRows, footer, organizationName: orgName,
    reference: params.reference, title: params.title, endDate: params.endDate, daysRemaining: String(params.daysRemaining),
  }, ['details']);
}
/** Roll an auto-renewing contract's end date forward past "today" (tenant timezone). */
function rollForwardAutoRenewal(contract: any): void {
  if (contractLifecycleMode(contract) === 'terminated') return;
  if (!contract.auto_renewal || !contract.tanggal_mulai || !contract.tanggal_berakhir) return;
  const settings = getTenantSettings(contract.organizationId);
  const today = todayInTimezone(settings.timezone);
  const start = String(contract.tanggal_mulai).slice(0, 10);
  let end = String(contract.tanggal_berakhir).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end >= today) return;
  const years = Math.max(1, Number(end.slice(0, 4)) - Number(start.slice(0, 4)) || 1);
  let guard = 0;
  while (end < today && guard++ < 200) {
    end = `${Number(end.slice(0, 4)) + years}${end.slice(4)}`;
  }
  contract.tanggal_berakhir = end;
}
/** Recipients from the record's OWNING organization (PRD §11.5), never global config. */
function reminderRecipients(tenantId: string, kind: "contract" | "commercial", owner?: string): string {
  const notifications = findTenant(tenantId)?.notifications || { notificationEmails: [], legalNotificationEmail: null, financeNotificationEmail: null };
  const dedicated = kind === "contract" ? notifications.legalNotificationEmail : notifications.financeNotificationEmail;
  const configured = dedicated ? [dedicated] : notifications.notificationEmails || [];
  const admins = (sqliteDb.prepare(`
    SELECT u.email FROM member m JOIN "user" u ON u.id = m.userId
    WHERE m.organizationId = ? AND m.status = 'active' AND m.role IN ('admin', 'manager') AND COALESCE(u.banned, 0) = 0
  `).all(tenantId) as any[]).map((r) => r.email);
  return Array.from(new Set([owner, ...configured, ...admins].filter(Boolean))).join(", ");
}
/**
 * Recompute lifecycle status for contracts and commercial documents and emit
 * reminders at the tenant's configured offsets (default 90/60/30/14 days).
 */
function recalculateStatuses() {
  let newNotifsCount = 0;
  const emitReminder = (kind: "contract" | "commercial", record: any, daysRemaining: number) => {
    const tenantId = record.organizationId;
    if (!findTenant(tenantId)) return; // unowned records get no reminders
    const settings = getTenantSettings(tenantId);
    if (!settings.reminderOffsetsDays.includes(daysRemaining)) return;
    const parentId = kind === "contract" ? record.contract_id : record.io_id;
    const jenis = `Reminder ${daysRemaining}d`;
    const legacyJenis = `Reminder H-${daysRemaining}`;
    const exists = (db.notifications || []).some(
      (n: any) => n.parent_id === parentId && (n.jenis_notifikasi === jenis || n.jenis_notifikasi === legacyJenis),
    );
    if (exists) return;
    const reference = kind === "contract" ? record.nomor_kontrak : record.nomor_io;
    const title = kind === "contract" ? record.judul_kontrak : record.judul_io;
    const amount = kind === "contract" ? record.nilai_kontrak : record.nilai_io;
    const recipients = reminderRecipients(tenantId, kind, record.pic_internal && String(record.pic_internal).includes("@") ? record.pic_internal : "");
    // en/id/zh in that order, matching settings.language.
    const pick = <T,>(en: T, id: T, zh: T): T => (settings.language === "ID" ? id : settings.language === "ZH" ? zh : en);
    const noticeType = record.notice_type_required || "Termination";
    const noticeDays = record.notice_period_hari || 30;
    const notif = {
      notif_id: `notif-${kind === "contract" ? "ctr" : "doc"}-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
      organizationId: tenantId,
      parent_type: kind === "contract" ? "Contract" : "IO",
      parent_id: parentId,
      parent_nomor: reference,
      parent_judul: title,
      jenis_notifikasi: jenis,
      tanggal_terkirim: new Date().toISOString(),
      status_terkirim: true,
      penerima: recipients,
      pesan: pick(
        `${reference} (${title}) expires in ${daysRemaining} days.${kind === "contract" ? ` ${noticeType} notice is due ${noticeDays} days before expiry.` : ""}`,
        `${reference} (${title}) berakhir dalam ${daysRemaining} hari.${kind === "contract" ? ` Pemberitahuan ${noticeType} diperlukan ${noticeDays} hari sebelumnya.` : ""}`,
        `${reference}（${title}）将在 ${daysRemaining} 天后到期。${kind === "contract" ? `需在到期前 ${noticeDays} 天发出${noticeType}通知。` : ""}`,
      ),
      // Lets the UI render the message in the viewer's language; `pesan` stays
      // in the organization language for e-mail/export and older clients.
      pesan_params: { kind, daysRemaining, noticeType, noticeDays },
      is_read: false,
    };
    db.notifications.unshift(notif);
    newNotifsCount++;
    if (db.googleConfig?.smtpEnabled) {
      const rows: Array<[string, string]> = [
        [pick("Value", "Nilai", "金额"), formatAmountForTenant(amount, record.currency, tenantId)],
      ];
      if (kind === "contract") {
        rows.push([pick("Notice period", "Periode pemberitahuan", "通知期"), `${noticeDays} ${pick("days", "hari", "天")} (${noticeType})`]);
        rows.push([pick("Auto-renewal", "Perpanjangan otomatis", "自动续约"), record.auto_renewal ? pick("Yes", "Ya", "是") : pick("No", "Tidak", "否")]);
      } else {
        rows.push([pick("Pricing model", "Model harga", "定价模式"), record.pricing_model || "-"]);
      }
      const { subject, html } = buildReminderEmail({
        tenantId, kind, reference, title, endDate: record.tanggal_berakhir, daysRemaining, rows,
      });
      const validRecipients = recipients.split(",").map((s: string) => s.trim()).filter((s: string) => s.includes("@"));
      if (validRecipients.length > 0) {
        sendSmtpEmail({ to: validRecipients, subject, html });
      }
    }
  };

  db.contracts = (db.contracts || []).map((contract) => {
    rollForwardAutoRenewal(contract);
    const { daysRemaining, status } = contractLifecycle(contract, getTenantSettings(contract.organizationId));
    if (status !== 'Terminated' && daysRemaining !== null) emitReminder("contract", contract, daysRemaining);
    return {
      ...contract,
      status,
      sisa_hari: daysRemaining ?? contract.sisa_hari,
      updated_at: contract.updated_at || new Date().toISOString(),
    };
  });
  db.ios = (db.ios || []).map((io) => {
    if (normalizeContractStatus(io.status) === "Terminated") return { ...io, status: "Terminated" };
    const { daysRemaining, status } = computeLifecycle(io.organizationId, io.tanggal_berakhir, io.status, false);
    if (daysRemaining !== null) emitReminder("commercial", io, daysRemaining);
    return {
      ...io,
      status,
      sisa_hari: daysRemaining ?? io.sisa_hari,
      updated_at: io.updated_at || new Date().toISOString(),
    };
  });
  saveDb();
  return newNotifsCount;
}
recalculateStatuses();
/** Reads refresh date-driven status without sending reminders or requiring a cron run. */
function refreshContractLifecycles() {
  if (Date.now() < lifecyclesFreshUntil) return;
  lifecyclesFreshUntil = Date.now() + 60_000;
  let changed = false;
  const settingsByOrg = new Map<string, ReturnType<typeof getTenantSettings>>();
  for (const contract of db.contracts || []) {
    const previousEnd = contract.tanggal_berakhir;
    rollForwardAutoRenewal(contract);
    const orgKey = String(contract.organizationId ?? "");
    if (!settingsByOrg.has(orgKey)) settingsByOrg.set(orgKey, getTenantSettings(contract.organizationId));
    const lifecycle = contractLifecycle(contract, settingsByOrg.get(orgKey)!);
    const remaining = lifecycle.daysRemaining ?? contract.sisa_hari;
    if (previousEnd !== contract.tanggal_berakhir || contract.status !== lifecycle.status || contract.sisa_hari !== remaining) {
      contract.status = lifecycle.status;
      contract.sisa_hari = remaining;
      changed = true;
    }
  }
  if (changed) saveDb();
}
/**
 * Operational activity entry (the History drawer's "activity" dataset). The
 * actor comes from the verified identity and the organization from the
 * verified context; caller-supplied names/roles are ignored when either exists.
 */
function addActivityLog(
  userEmail,
  userName,
  role,
  actionType,
  moduleName,
  description,
  req,
  organizationId?: string | null,
) {
  const identity = req?.identity;
  const ctx: OrgContext | undefined = req?.orgContext;
  if (identity) {
    userEmail = identity.email;
    userName = identity.name;
    role = ctx?.tenantRole
      ? ctx.tenantRole.replace(/^./, (c: string) => c.toUpperCase())
      : identity.platformRole === "superuser" ? "Platform administrator" : "User";
  }
  const log = {
    id: `act-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    organizationId: organizationId !== undefined ? organizationId : ctx?.organizationId ?? null,
    timestamp: new Date().toISOString(),
    userEmail,
    userName,
    role,
    actionType,
    module: moduleName,
    description,
    ipAddress: req?.ip || "127.0.0.1",
    userAgent: req?.headers["user-agent"] || "Browser Client",
  };
  db.activityLogs.unshift(log);
  if (db.activityLogs.length > 500) {
    db.activityLogs = db.activityLogs.slice(0, 500);
  }
  saveDb();
  return log;
}
async function getBetterAuthSession(req) {
  try {
    const identity = resolveIdentity(sqliteDb, req);
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
app.get("/api/user/my-role", (req: express.Request, res: express.Response) => {
  let identity;
  try {
    identity = resolveIdentity(sqliteDb, req);
  } catch (err: any) {
    // The start-up probe treats "signed out" as an expected answer.
    if (req.query.probe === "1") return res.status(204).end();
    return sendError(req, res, err?.status || 401, err?.error || "UNAUTHENTICATED");
  }
  const me = identityResponse(sqliteDb, identity);
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
    console.warn(
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
    saveDb();
    res.json({ items: entry.items, lastGeneratedAt: entry.lastGeneratedAt, cached: false });
  } catch (err: any) {
    console.error("Error generating news ticker:", err);
    // A stale cache in the previous language/industry beats nothing, unless the
    // settings just changed and no fresh headlines exist yet for the new choice.
    if (Array.isArray(ticker.items) && ticker.items.length > 0 && !settingsChanged) {
      return res.json({ items: ticker.items, lastGeneratedAt: ticker.lastGeneratedAt, cached: true, stale: true });
    }
    res.status(500).json({ error: err?.message || "Failed to load the news ticker." });
  }
});

/** Department names for operational forms: the verified organization, scoped to the caller (no fallback). */
app.get("/api/departments", (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const rows = sqliteDb.prepare("SELECT id, name FROM team WHERE organizationId = ? ORDER BY name COLLATE NOCASE, id").all(ctx.organizationId) as any[];
  const visible = hasOrganizationScope(ctx) ? rows : rows.filter((r) => ctx.departmentIds.includes(r.id));
  res.json({ success: true, departments: visible.map((r) => r.name), items: visible });
});
/** Records the caller's own sign-in/sign-out in their session's organization (if any). */
app.post("/api/user/log-activity", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  const actionType = req.body?.actionType === "LOGOUT" ? "LOGOUT" : "LOGIN";
  const orgId = identity.sessionDefaultOrganizationId;
  let ctx: OrgContext | null = null;
  try { ctx = orgId ? resolveOrganizationContext(sqliteDb, identity, orgId) : null; } catch { ctx = null; }
  addActivityLog("", "", "", actionType, "AUTH", actionType === "LOGOUT" ? "Signed out" : "Signed in", req, ctx?.organizationId ?? null);
  res.json({ success: true });
});
/**
 * Resolve the verified e-mail behind a Google OAuth access token using
 * Google's userinfo endpoint. Returns null when the token is invalid or the
 * e-mail is not verified.
 */
async function verifyGoogleAccessTokenEmail(accessToken: unknown): Promise<string | null> {
  if (!accessToken || typeof accessToken !== "string") return null;
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const info: any = await response.json();
    if (!info?.email || info.email_verified === false) return null;
    return String(info.email).toLowerCase().trim();
  } catch {
    return null;
  }
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
    const identity = resolveIdentity(sqliteDb, req);
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
  saveDb();
  addActivityLog(
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
  saveDb();
  addActivityLog(
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
  saveDb();
  addActivityLog(
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
    const authDb = sqliteDb;
    const trimmedEmail = email.trim().toLowerCase();
    let targetUser: any = authDb
      .prepare("SELECT id, name, email FROM user WHERE LOWER(email) = ?")
      .get(trimmedEmail);
    const hashedPassword = await hashPassword(newPassword.trim());
    const nowIso = new Date().toISOString();
    if (!targetUser) {
      const allowedUser = db.allowedUsers.find(
        (u) => u.email.toLowerCase() === trimmedEmail,
      );
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const userName = allowedUser?.name || email.split("@")[0];
      const userRole = "user"; // platform role only; organization access comes from memberships
      authDb
        .prepare(
          `
        INSERT INTO user (id, name, email, emailVerified, role, banned, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, 0, ?, ?)
      `,
        )
        .run(userId, userName, trimmedEmail, userRole, nowIso, nowIso);
      const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      authDb
        .prepare(
          `
        INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer)
        VALUES (?, ?, 'credential', ?, ?, ?, ?, 'local:credential')
      `,
        )
        .run(accountId, userId, userId, hashedPassword, nowIso, nowIso);
      targetUser = { id: userId, name: userName, email: trimmedEmail };
    } else {
      const existingAccount: any = authDb
        .prepare(
          "SELECT id FROM account WHERE userId = ? AND providerId = 'credential'",
        )
        .get(targetUser.id);
      if (existingAccount) {
        authDb
          .prepare(
            "UPDATE account SET password = ?, updatedAt = ? WHERE id = ?",
          )
          .run(hashedPassword, nowIso, existingAccount.id);
      } else {
        const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        authDb
          .prepare(
            `
          INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer)
          VALUES (?, ?, 'credential', ?, ?, ?, ?, 'local:credential')
        `,
          )
          .run(
            accountId,
            targetUser.id,
            targetUser.id,
            hashedPassword,
            nowIso,
            nowIso,
          );
      }
      authDb
        .prepare(
          "UPDATE user SET banned = 0, banReason = NULL, updatedAt = ? WHERE id = ?",
        )
        .run(nowIso, targetUser.id);
    }
    addActivityLog(
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
    console.error("Server error resetting password:", err);
    res
      .status(500)
      .json({
        error: err.message || "Terjadi kesalahan saat mereset password.",
      });
  }
});
/** Operational activity for the selected organization only (History drawer, tenant.audit.read). */
app.get("/api/activity-logs", (req: express.Request, res: express.Response) => {
  const orgId = getRequestTenantId(req);
  res.json((db.activityLogs || []).filter((log: any) => log?.organizationId === orgId));
});
app.get("/api/search", (req: express.Request, res: express.Response) => {
  const organizationId = getRequestTenantId(req);
  const kinds: Record<string, RecordKind> = { partners: 'partner', contracts: 'contract', insertion_orders: 'io', spendings: 'spending', evaluations: 'evaluation' };
  const hits = searchBusinessRows(sqliteDb, organizationId, String(req.query.q || '').slice(0, 1000));
  const permitted = hits.filter(hit => {
    const kind = kinds[hit.entity_type];
    if (!kind) return false;
    const record = readBusinessRows(sqliteDb, hit.entity_type, organizationId, [hit.entity_id])[0];
    return record && recordVisible(orgContextOf(req), scopeOf(req), kind, record);
  });
  res.json({ results: permitted.slice(0, 50), total: permitted.length });
});
app.get("/api/partners", (req: express.Request, res: express.Response) => {
  const partnerList = scopedRecords(req, "partner", db.partners);
  const normalizedPartners = partnerList.map((p) => ({
    ...p,
    tags: sanitizePartnerTags(p.tags),
  }));
  res.json(normalizedPartners);
});
/**
 * AI is an optional, per-tenant capability (PRD §4.1, §5.1): it needs a
 * configured provider key AND the tenant's `aiAssistant` module switched on.
 */
function ensureAiAvailable(req: express.Request, res: express.Response): boolean {
  const settings = getTenantSettings(getRequestTenantId(req));
  if (!settings.modules.aiAssistant) {
    res.status(403).json({ error: "AI_DISABLED", message: "AI features are disabled for this organization." });
    return false;
  }
  if (!getEffectiveGeminiApiKey()) {
    res.status(400).json({ error: "AI_NOT_CONFIGURED", message: "The AI assistant is not available. Ask your platform administrator to configure a provider." });
    return false;
  }
  return true;
}
/**
 * Adds an optional `document_text` field to a parse route's response schema,
 * but only when OCR ran in vision mode (a scanned/image document, the
 * expensive path). Vision mode already has Gemini "read" the whole document
 * to extract task-specific fields, so asking it to also return the plain
 * transcript is a free byproduct of a call that's happening anyway — that
 * transcript then gets cached (see `extractAndCacheDocumentTranscript`
 * below), so the NEXT analysis of the same file (any feature, not just this
 * one) skips OCR/vision entirely via `getCachedTranscript`. Digital-text PDFs
 * don't need this: `buildCheapOcrContents` already caches their transcript
 * for free, since local PDF text extraction cost nothing extra to begin with.
 */
function withDocumentTranscriptField(schema: any, ocrMode: "text" | "vision"): any {
  if (ocrMode !== "vision") return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      document_text: {
        type: Type.STRING,
        description:
          "The full plain-text transcript of the entire document, verbatim, all pages — used to cache this document's content so future analyses of the same file don't need to re-read it.",
      },
    },
  };
}
/** Pulls `document_text` out of a parsed AI response, caches it by file hash, and
 * strips it from the object so it never leaks into the API response or the
 * per-task result cache (which would otherwise duplicate the whole transcript). */
function extractAndCacheDocumentTranscript(parsedData: any, fileHash: string): void {
  const text = parsedData?.document_text;
  if (typeof text === "string" && text.trim()) {
    setCachedTranscript(fileHash, text);
  }
  delete parsedData?.document_text;
}
app.post("/api/partners/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!ensureAiAvailable(req, res)) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `partners:${tenantId}`;
    const cached = globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const prompt = `You are an expert legal document assistant. Extract the following information about the counterparty (partner/vendor/customer) from this contract or agreement so it can be registered in a contract management system. Our own organization is "${ctx.organizationName}" — never return our organization as the counterparty.

1. "nama_partner": the counterparty's full legal name exactly as written, including its legal form (e.g. "Pte. Ltd.", "Sdn. Bhd.", "PT", "Co., Ltd."). Do not abbreviate.
2. "country": ISO 3166-1 alpha-2 code of the counterparty's country of incorporation (e.g. "SG", "ID", "IN", "JP"). Return "" if it cannot be determined.
3. "entity_type": the counterparty's legal form as written (e.g. "Private Limited", "Sendirian Berhad", "Perseroan Terbatas"). Return "" if unknown.
4. "nama_pic": the counterparty's contact person or team named in the notices/correspondence clause. Return "-" if absent.
5. "email_pic": the counterparty's main notice e-mail address. Return "-" if absent.
6. "telepon_pic": the counterparty's phone number in international format (E.164, e.g. "+6591234567") when possible. Return "-" if absent.
7. "alamat_pic": the counterparty's registered or correspondence address. Return "-" if absent.
8. "notes": acting as a senior due-diligence and vendor-risk analyst, write ONE concise narrative paragraph in ${ctx.responseLanguage} describing the counterparty's core business, the services relevant to this agreement, notable technology or assets, and its jurisdictional context. No bullet points or headings; start directly with the entity name. Do not include personal identification numbers.

Return strictly one valid JSON object matching the schema.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    console.log(
      `[PDF-Inspector Partner Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
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
              nama_partner: { type: Type.STRING },
              country: { type: Type.STRING },
              entity_type: { type: Type.STRING },
              nama_pic: { type: Type.STRING },
              email_pic: { type: Type.STRING },
              telepon_pic: { type: Type.STRING },
              alamat_pic: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    const responsePayload = { success: true, data: parsedData, ocrStats };
    if (ocrStats.fileHash) {
      globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    console.error("Error parsing partner:", error);
    res
      .status(500)
      .json({
        error:
          error?.message ||
          "Failed to parse document. Google AI model is currently busy, please try again.",
      });
  }
});
app.post("/api/partners/generate-dd-notes", async (req: express.Request, res: express.Response) => {
  if (!ensureAiAvailable(req, res)) return;
  try {
    const { nama_partner, country, entity_type, tags, model, pdfBase64 } = req.body;
    if (!nama_partner) {
      return res
        .status(400)
        .json({ error: "Partner name is required." });
    }
    const selectedModel = getValidAiModel(model);
    const contents = [];
    if (pdfBase64 && typeof pdfBase64 === "string") {
      contents.push({
        inlineData: {
          data: pdfBase64.includes("base64,")
            ? pdfBase64.split("base64,")[1]
            : pdfBase64,
          mimeType: "application/pdf",
        },
      });
    }
    const ctx = aiPolicyContext(getRequestTenantId(req));
    const countryName = country ? getCountryPack(String(country)).name : "";
    const prompt = `Act as a senior due-diligence and vendor-risk analyst for ${ctx.organizationName}, an organization in the ${ctx.industryName} industry operating in ${ctx.countryName}.

Summarise the counterparty below in ONE comprehensive, professional paragraph written in ${ctx.responseLanguage}.

Counterparty: "${String(nama_partner).slice(0, 200)}"${countryName ? ` (incorporated in ${countryName})` : ""}${entity_type ? ` — legal form: ${String(entity_type).slice(0, 120)}` : ""}${Array.isArray(tags) && tags.length > 0 ? ` — relationship categories: ${tags.slice(0, 10).join(", ")}` : ""}

The paragraph must flow through: (1) core business and specialisation, (2) the products or services relevant to this relationship, (3) notable technology, assets or certifications, and (4) jurisdictional and risk context relevant to ${ctx.industryName} (for example: ${ctx.reviewFocus.slice(0, 3).join(", ")}).

Output rules: exactly one paragraph, no bullet points or headings, no opening or closing pleasantries, start with the entity name, and never invent registration or identification numbers.`;
    contents.push({ text: prompt });
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents,
    });
    const notesText = ((response as any).text || "").trim();
    res.json({ success: true, notes: notesText });
  } catch (error) {
    console.error("Error generating DD notes:", error);
    res
      .status(500)
      .json({
        error:
          error?.message || "Gagal menghasilkan ringkasan Due Diligence AI.",
      });
  }
});
app.post("/api/partners", async (req: express.Request, res: express.Response) => {
  const {
    nama_partner,
    codename,
    country,
    entity_type,
    identifiers,
    jenis_partner,
    nama_pic,
    email_pic,
    telepon_pic,
    alamat_pic,
    kontak_pic,
    pic_internal,
    catatan,
    tags,
    userEmail,
    userName,
    userRole,
  } = req.body;
  if (!nama_partner) {
    return res.status(400).json({ error: "Nama Partner wajib diisi." });
  }
  const targetOrgId = getRequestTenantId(req);
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] ||
      req.body.accessToken ||
      db.googleConfig.accessToken,
  );
  let driveFolderLink = `https://drive.google.com/drive/folders/Folder_${nama_partner.replace(/\s+/g, "_")}`;
  if (token || hasServiceAccountCredentials()) {
    try {
      const orgFolder = await getOrgFolderId(targetOrgId, token);
      const parentFolderId = orgFolder.id || db.googleConfig.driveFolderId;
      const vendorFolder = await getOrCreateDriveFolder(
        nama_partner,
        parentFolderId,
        token,
      );
      driveFolderLink =
        vendorFolder.webViewLink ||
        `https://drive.google.com/drive/folders/${vendorFolder.id}`;
      if (vendorFolder.id) {
        await getOrCreateDriveFolder("Folder Contract", vendorFolder.id, token);
        await getOrCreateDriveFolder(
          "Folder Invoice & Billing",
          vendorFolder.id,
          token,
        );
        await getOrCreateDriveFolder("Folder IO", vendorFolder.id, token);
        await getOrCreateDriveFolder("Folder DD", vendorFolder.id, token);
      }
    } catch (err) {
      console.warn(
        `[Drive Hierarchical] Error creating folders for partner '${nama_partner}':`,
        err?.message || err,
      );
    }
  }
  const partnerCountry = sanitizeCountryCode(country);
  const defaultDD = normalizePartnerDocuments({ organizationId: targetOrgId, country: partnerCountry, daftar_dokumen_dd: [] });
  const newPartner = {
    partner_id: generateNextPartnerId(),
    organizationId: targetOrgId,
    nama_partner,
    codename: codename || "",
    country: partnerCountry,
    entity_type: String(entity_type || "").slice(0, 120),
    identifiers: sanitizeIdentifiers(identifiers),
    jenis_partner: jenis_partner || "Vendor",
    nama_pic: nama_pic || "",
    email_pic: email_pic || "",
    telepon_pic: telepon_pic || "",
    alamat_pic: alamat_pic || "",
    kontak_pic:
      kontak_pic ||
      (email_pic && telepon_pic ? `${email_pic} / ${telepon_pic}` : ""),
    pic_internal: pic_internal || "",
    status_dd: computeDueDiligenceStatus(defaultDD),
    link_folder_dd: driveFolderLink,
    daftar_dokumen_dd: defaultDD,
    catatan: catatan || "",
    tags: sanitizePartnerTags(tags),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "partner", newPartner);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.partners.unshift(newPartner);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Business Owner",
    "CREATE",
    "PARTNER",
    `Menambahkan Partner baru: ${nama_partner}${partnerCountry ? ` (${partnerCountry})` : ""}`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, partner: newPartner });
});
app.put("/api/partners/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    nama_partner,
    codename,
    country,
    entity_type,
    identifiers,
    jenis_partner,
    nama_pic,
    email_pic,
    telepon_pic,
    alamat_pic,
    kontak_pic,
    pic_internal,
    catatan,
    tags,
    daftar_dokumen_dd,
    userEmail,
    userName,
    userRole,
  } = req.body;
  const partnerIndex = db.partners.findIndex((p) => p.partner_id === id);
  if (partnerIndex === -1) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const existing = db.partners[partnerIndex];
  const tenantDenial = assertRecordAccess(req, "partner", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const nextCountry = country !== void 0 ? sanitizeCountryCode(country) : existing.country || "";
  const nextDocuments = normalizePartnerDocuments({
    organizationId: existing.organizationId,
    country: nextCountry,
    daftar_dokumen_dd: Array.isArray(daftar_dokumen_dd) ? daftar_dokumen_dd : existing.daftar_dokumen_dd,
  });
  const status_dd = computeDueDiligenceStatus(nextDocuments);
  const updatedPartner = {
    ...existing,
    nama_partner: nama_partner || existing.nama_partner,
    codename: codename !== void 0 ? codename : existing.codename,
    country: nextCountry,
    entity_type: entity_type !== void 0 ? String(entity_type).slice(0, 120) : existing.entity_type || "",
    identifiers: identifiers !== void 0 ? sanitizeIdentifiers(identifiers) : existing.identifiers || [],
    jenis_partner: jenis_partner || existing.jenis_partner || "Vendor",
    nama_pic: nama_pic !== void 0 ? nama_pic : existing.nama_pic,
    email_pic: email_pic !== void 0 ? email_pic : existing.email_pic,
    telepon_pic: telepon_pic !== void 0 ? telepon_pic : existing.telepon_pic,
    alamat_pic: alamat_pic !== void 0 ? alamat_pic : existing.alamat_pic,
    kontak_pic: kontak_pic !== void 0 ? kontak_pic : existing.kontak_pic,
    pic_internal:
      pic_internal !== void 0 ? pic_internal : existing.pic_internal,
    catatan: catatan !== void 0 ? catatan : existing.catatan,
    tags:
      tags !== void 0
        ? sanitizePartnerTags(tags)
        : sanitizePartnerTags(existing.tags),
    daftar_dokumen_dd: nextDocuments,
    status_dd,
    tanggal_dd_diverifikasi:
      status_dd === "Complete" && existing.status_dd !== "Complete"
        ? new Date().toISOString().split("T")[0]
        : existing.tanggal_dd_diverifikasi,
    updated_at: new Date().toISOString(),
  };
  updatedPartner.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "partner", updatedPartner);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.partners[partnerIndex] = updatedPartner;
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "DD_UPDATE",
    "PARTNER",
    `Memperbarui profil & status DD Partner ${updatedPartner.nama_partner} menjadi '${status_dd}'`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, partner: updatedPartner });
});
app.delete("/api/partners/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole } = req.query;
  const partnerIndex = db.partners.findIndex((p) => p.partner_id === id);
  if (partnerIndex === -1) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const partner = db.partners[partnerIndex];
  const tenantDenial = assertRecordAccess(req, "partner", partner);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const sameOrg = (row: any) => row?.organizationId === partner.organizationId;
  const partnerContracts = db.contracts.filter((c) => sameOrg(c) && c.partner_id === id);
  const contractIds = partnerContracts.map((c) => c.contract_id);
  const partnerIOs = db.ios.filter(
    (io) => sameOrg(io) && (io.partner_id === id || contractIds.includes(io.contract_id)),
  );
  const ioIds = partnerIOs.map((io) => io.io_id);
  db.notifications = db.notifications.filter(
    (n) => !(sameOrg(n) && (contractIds.includes(n.parent_id) || ioIds.includes(n.parent_id))),
  );
  db.ios = db.ios.filter((io) => !partnerIOs.includes(io));
  db.contracts = db.contracts.filter((c) => !partnerContracts.includes(c));
  for (const spending of db.spendings) if (sameOrg(spending) && spending.vendor_id === id) spending.vendor_id = null;
  for (const evaluation of db.evaluations) if (sameOrg(evaluation) && evaluation.partner_id === id) evaluation.partner_id = null;
  db.partners.splice(partnerIndex, 1);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "DELETE",
    "PARTNER",
    `Menghapus Partner '${partner.nama_partner}' beserta ${partnerContracts.length} Kontrak dan ${partnerIOs.length} Insertion Order pendukung.`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({
    success: true,
    deletedContractsCount: partnerContracts.length,
    deletedIosCount: partnerIOs.length,
  });
});
function computeEvaluationScore(obligationTarget, incidentFreq, comm, pricing) {
  let targetScore = 10;
  if (obligationTarget === "Sangat baik" || obligationTarget === "Met")
    targetScore = 30;
  else if (obligationTarget === "Baik") targetScore = 20;
  else if (obligationTarget === "Kurang baik" || obligationTarget === "Not met")
    targetScore = 10;
  let incidentScore = 10;
  if (incidentFreq === "Never") incidentScore = 20;
  else if (incidentFreq === "Rare") incidentScore = 15;
  else if (incidentFreq === "Frequent") incidentScore = 10;
  let commScore = 10;
  if (comm === "Sangat baik" || comm === "Good") commScore = 20;
  else if (comm === "Baik") commScore = 15;
  else if (comm === "Kurang baik" || comm === "Poor/Needs Improvement")
    commScore = 10;
  let pricingScore = 10;
  if (pricing === "Cheap") pricingScore = 30;
  else if (pricing === "Moderate") pricingScore = 20;
  else if (pricing === "Expensive") pricingScore = 10;
  return targetScore + incidentScore + commScore + pricingScore;
}
app.get("/api/partner-evaluations", (req: express.Request, res: express.Response) => {
  const list = scopedRecords(req, "evaluation", db.evaluations);
  res.json(list);
});
app.post("/api/partner-evaluations", async (req: express.Request, res: express.Response) => {
  const {
    review_date,
    partner_id,
    supplier_name,
    type_of_work,
    sla_score,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes,
    userEmail,
    userName,
    userRole,
  } = req.body;
  if (
    !supplier_name ||
    !review_date ||
    !obligation_target ||
    !incident_frequency ||
    !communication ||
    !pricing ||
    !final_evaluation
  ) {
    return res
      .status(400)
      .json({
        error:
          "Harap lengkapi semua bidang isian formulir evaluasi yang wajib.",
      });
  }
  const targetOrgId = getRequestTenantId(req);
  const calculated_score = computeEvaluationScore(
    obligation_target,
    incident_frequency,
    communication,
    pricing,
  );
  const newEval = {
    id: `EVAL-${new Date().getFullYear()}-${String((db.evaluations?.length || 0) + 1).padStart(3, "0")}`,
    organizationId: targetOrgId,
    review_date,
    partner_id,
    supplier_name: supplier_name.trim(),
    type_of_work: (type_of_work || "General Service").trim(),
    sla_score: Number(sla_score) || 60,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes: (notes || "").trim(),
    calculated_score,
    evaluator_email: userEmail || "user@app",
    evaluator_name: userName || "User",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!db.evaluations) db.evaluations = [];
  const writeDenial = assertRecordWritable(req, "evaluation", newEval);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.evaluations.unshift(newEval);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "CREATE",
    "PARTNER",
    `Membuat Evaluasi Tahunan Vendor untuk '${newEval.supplier_name}' dengan hasil '${newEval.final_evaluation}' (Skor: ${calculated_score}/100)`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, evaluation: newEval });
});
app.put("/api/partner-evaluations/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    review_date,
    partner_id,
    supplier_name,
    type_of_work,
    sla_score,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes,
    userEmail,
    userName,
    userRole,
  } = req.body;
  const evalIndex = (db.evaluations || []).findIndex((e) => e.id === id);
  if (evalIndex === -1) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  const existing = db.evaluations[evalIndex];
  const accessDenial = assertRecordAccess(req, "evaluation", existing);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  const calculated_score = computeEvaluationScore(
    obligation_target || existing.obligation_target,
    incident_frequency || existing.incident_frequency,
    communication || existing.communication,
    pricing || existing.pricing,
  );
  const updatedEval = {
    ...existing,
    review_date: review_date || existing.review_date,
    partner_id: partner_id !== void 0 ? partner_id : existing.partner_id,
    supplier_name: supplier_name || existing.supplier_name,
    type_of_work: type_of_work || existing.type_of_work,
    sla_score: sla_score !== void 0 ? Number(sla_score) : existing.sla_score,
    obligation_target: obligation_target || existing.obligation_target,
    incident_frequency: incident_frequency || existing.incident_frequency,
    communication: communication || existing.communication,
    pricing: pricing || existing.pricing,
    final_evaluation: final_evaluation || existing.final_evaluation,
    notes: notes !== void 0 ? notes : existing.notes,
    calculated_score,
    updated_at: new Date().toISOString(),
  };
  updatedEval.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "evaluation", updatedEval);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.evaluations[evalIndex] = updatedEval;
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "UPDATE",
    "PARTNER",
    `Perbarui Evaluasi Tahunan Vendor '${updatedEval.supplier_name}' (${updatedEval.id})`,
    req,
  );
  res.json({ success: true, evaluation: updatedEval });
});
app.delete("/api/partner-evaluations/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole } = req.query;
  const evalIndex = (db.evaluations || []).findIndex((e) => e.id === id);
  if (evalIndex === -1) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  const removed = db.evaluations[evalIndex];
  const accessDenial = assertRecordAccess(req, "evaluation", removed);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  db.evaluations.splice(evalIndex, 1);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "DELETE",
    "PARTNER",
    `Menghapus Evaluasi Tahunan Vendor '${removed.supplier_name}' (${removed.id})`,
    req,
  );
  res.json({ success: true });
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
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/exchange-rate-historical", async (req: express.Request, res: express.Response) => {
  try {
    const currency = normalizeCurrencyCode(req.query.currency, "USD");
    const date = String(req.query.date || "");
    const { rate, isFallback } = await getUsdRate(currency);
    res.json({ currency, date, rate, isFallback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/partner-spendings", (req: express.Request, res: express.Response) => {
  const spendingsList = scopedRecords(req, "spending", db.spendings);
  const list = spendingsList.map((s) => {
    if (s.total_amount_usd === void 0 || s.total_amount_usd === null) {
      const amt = Number(s.total_amount) || 0;
      const cur = normalizeCurrencyCode(s.currency, tenantDefaultCurrency(s.organizationId));
      const usdVal =
        cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
      return { ...s, total_amount_usd: usdVal };
    }
    return s;
  });
  res.json(list);
});
app.post("/api/spendings/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!ensureAiAvailable(req, res)) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `spendings:v2-explicit-period:${tenantId}`;
    const cached = globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const prompt = `You are an expert OCR and data-extraction assistant processing a B2B invoice or billing document received by ${ctx.organizationName}. Extract:

1. "invoice_number": the official invoice number exactly as printed.
2. "invoice_date": the issue date, converted to ISO 8601 "YYYY-MM-DD".
3. "spending_months": all months in an explicitly printed billing/service/spending period, as an array of "YYYY-MM" strings. Expand a printed range (e.g. October–December 2026) into every covered month. Return [] when no period is printed. NEVER infer a spending month from invoice_date or the issue date.
   "invoice_month": the first explicitly identified spending month, or "" if none.
   "month_allocations": an array of {"month": "YYYY-MM", "amount": number}, ONLY for per-month amounts explicitly printed in that period. Return [] when amounts are not specified. Do not invent an equal split.
4. "invoice_description": every line-item description from the invoice table, joined with newline characters ("\n"), verbatim.
5. "currency": the ISO 4217 three-letter currency code of the invoice total (e.g. "USD", "SGD", "INR", "JPY"). If only a symbol is shown, infer the code from the issuer's country; default to "${ctx.defaultCurrency}" when still unclear.
6. "total_amount": the final invoice total as a plain number, without symbols or thousands separators.
7. "bank_name": the beneficiary bank name only.
8. "account_number": the beneficiary account number or IBAN exactly as printed, keeping separators.
9. "account_holder": the beneficiary account name exactly as printed.
10. "invoice_title": a short invoice/service title when present; keep it separate from the full line-item description. Use "" when absent.

Return strictly one valid JSON object matching the schema. Use an empty string "" for any text field that is not present.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    console.log(
      `[PDF-Inspector Spending Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
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
              invoice_number: { type: Type.STRING },
              invoice_date: { type: Type.STRING },
              invoice_month: { type: Type.STRING },
              invoice_title: { type: Type.STRING },
              spending_months: { type: Type.ARRAY, items: { type: Type.STRING } },
              month_allocations: { type: Type.ARRAY, items: {
                type: Type.OBJECT, properties: { month: { type: Type.STRING }, amount: { type: Type.NUMBER } },
              } },
              invoice_description: { type: Type.STRING },
              currency: { type: Type.STRING },
              total_amount: { type: Type.NUMBER },
              bank_name: { type: Type.STRING },
              account_number: { type: Type.STRING },
              account_holder: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.invoice_date) {
      parsedData.invoice_date = normalizeParsedDate(parsedData.invoice_date);
    }
    const responsePayload = { success: true, data: parsedData, ocrStats };
    if (ocrStats.fileHash) {
      globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    console.error("Error parsing Spending:", error);
    res
      .status(500)
      .json({
        error:
          error?.message ||
          "Failed to parse Spending document. Google AI model is currently busy, please try again.",
      });
  }
});
const getEndOfMonthDate = __name((year, month) => {
  const y = typeof year === "string" ? parseInt(year, 10) : year;
  const m = typeof month === "string" ? parseInt(month, 10) : month;
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return "";
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}, "getEndOfMonthDate");
const normalizeSpendingMonths = __name((input) => {
  if (!input) return [];
  const rawList = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const result = [];
  rawList.forEach((raw) => {
    const tokens = raw.split(/\s+/).filter(Boolean);
    tokens.forEach((t) => {
      const trimmed = t.trim();
      if (!trimmed) return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        result.push(trimmed);
      } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
        const [y, m] = trimmed.split("-");
        result.push(getEndOfMonthDate(y, m));
      } else if (/^\d{2}-\d{4}$/.test(trimmed)) {
        const [m, y] = trimmed.split("-");
        result.push(getEndOfMonthDate(y, m));
      } else if (/^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(trimmed)) {
        result.push(
          getEndOfMonthDate(trimmed.slice(0, 4), trimmed.slice(4, 6)),
        );
      } else if (/^(0[1-9]|1[0-2])(19|20)\d{2}$/.test(trimmed)) {
        result.push(getEndOfMonthDate(trimmed.slice(2), trimmed.slice(0, 2)));
      } else {
        result.push(trimmed);
      }
    });
  });
  return Array.from(new Set(result));
}, "normalizeSpendingMonths");
app.post("/api/partner-spendings", async (req: express.Request, res: express.Response) => {
  const {
    vendor_id,
    vendor_name,
    invoice_number,
    invoice_date,
    invoice_month,
    invoice_title,
    month_allocations,
    invoice_description,
    currency,
    total_amount,
    total_amount_usd: req_usd,
    bank_name,
    bank_account_number,
    bank_account_holder_name,
    invoice_file,
    billing_file,
    userEmail,
    userName,
    userRole,
  } = req.body;
  if (!vendor_name || !invoice_number || total_amount === void 0) {
    return res
      .status(400)
      .json({
        error: "Vendor Name, Invoice Number, and Total Amount are required.",
      });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "month_allocations")) {
    const allocationError = validateSpendingAllocations(month_allocations, total_amount);
    if (allocationError) return res.status(400).json({ error: "Invalid spending month allocation.", allocation_error: allocationError });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const monthsArray = normalizeSpendingMonths(month_allocations !== undefined
    ? allocationInvoiceMonths(month_allocations) : invoice_month);
  const formattedMonthStr =
    monthsArray.length > 0 ? monthsArray.join("_") : "Month";
  const cleanVendorName = vendor_name.replace(/[/\\?%*:|"<>]/g, "").trim();
  let invoice_file_url = "";
  let invoice_file_name = "";
  let billing_file_url = "";
  let billing_file_name = "";
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  let total_amount_usd = req_usd;
  if (
    total_amount_usd === void 0 ||
    total_amount_usd === null ||
    isNaN(Number(total_amount_usd))
  ) {
    const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
    const amt = Number(total_amount) || 0;
    if (cur === "USD") {
      total_amount_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const sheetId =
          targetTenant?.spreadsheetId || db.googleConfig?.spreadsheetId;
        rate = await getHistoricalExchangeRate(
          sheetId,
          token,
          cur,
          invoice_date,
        );
      } catch (e) {}
      total_amount_usd = Math.round(amt * rate * 100) / 100;
    }
  } else {
    total_amount_usd = Number(total_amount_usd);
  }
  const partner = db.partners.find(
    (p) =>
      p.partner_id === vendor_id ||
      p.nama_partner.toLowerCase() === vendor_name.toLowerCase(),
  );
  if (invoice_file && invoice_file.fileData) {
    const targetInvoiceName = formatInvoiceFileName({
      partnerName: partner?.nama_partner || vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: invoice_number,
      invoiceDate: invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: invoice_file.fileName,
    });
    invoice_file_name = targetInvoiceName;
    if (!invoice_file_url) {
      invoice_file_url = saveLocalFile(
        partner?.nama_partner || vendor_name,
        "Folder Invoice & Billing",
        targetInvoiceName,
        invoice_file.fileData,
        targetTenant?.name,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Finance",
        "UPLOAD_SUCCESS",
        "PARTNER",
        `File Invoice '${targetInvoiceName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
  }
  if (billing_file && billing_file.fileData) {
    const targetBillingName = formatBillingFileName({
      partnerName: partner?.nama_partner || vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: invoice_number,
      invoiceDate: invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: billing_file.fileName,
    });
    billing_file_name = targetBillingName;
    if (!billing_file_url) {
      billing_file_url = saveLocalFile(
        partner?.nama_partner || vendor_name,
        "Folder Invoice & Billing",
        targetBillingName,
        billing_file.fileData,
        targetTenant?.name,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Finance",
        "UPLOAD_SUCCESS",
        "PARTNER",
        `File Billing '${targetBillingName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
  }
  const newSpending = {
    id: req.body.id || generateNextSpendingId(),
    organizationId: targetOrgId,
    vendor_id: partner ? partner.partner_id : vendor_id || void 0,
    vendor_name,
    invoice_number,
    invoice_date: invoice_date || new Date().toISOString().split("T")[0],
    invoice_month: monthsArray,
    invoice_title: invoice_title || "",
    ...(month_allocations !== undefined ? { month_allocations: month_allocations.map(({ month, amount }) => ({ month, amount })) } : {}),
    invoice_description: invoice_description || "",
    currency: normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId)),
    total_amount: Number(total_amount) || 0,
    total_amount_usd,
    bank_name: bank_name || "",
    bank_account_number: bank_account_number || "",
    bank_account_holder_name: bank_account_holder_name || "",
    invoice_file_url,
    invoice_file_name,
    billing_file_url,
    billing_file_name,
    folder_link: partner ? partner.link_folder_dd : void 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.spendings = db.spendings || [];
  const writeDenial = assertRecordWritable(req, "spending", newSpending);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.spendings.unshift(newSpending);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Finance",
    "CREATE",
    "PARTNER",
    `Menambahkan Catatan Partner Spending untuk '${vendor_name}' (Invoice #${invoice_number}) senilai ${formatAmountForTenant(total_amount, normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId)), targetOrgId)}`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, spending: newSpending });
});
app.put("/api/partner-spendings/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    userEmail,
    userName,
    userRole,
    invoice_file,
    billing_file,
    ...updates
  } = req.body;
  const idx = (db.spendings || []).findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Data spending tidak ditemukan." });
  }
  const existing = db.spendings[idx];
  const accessDenial = assertRecordAccess(req, "spending", existing);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  const hasAllocations = Object.prototype.hasOwnProperty.call(updates, "month_allocations") || existing.month_allocations !== undefined;
  if (hasAllocations) {
    const rows = Object.prototype.hasOwnProperty.call(updates, "month_allocations") ? updates.month_allocations : existing.month_allocations;
    const allocationError = validateSpendingAllocations(rows, Object.prototype.hasOwnProperty.call(updates, "total_amount") ? updates.total_amount : existing.total_amount);
    if (allocationError) return res.status(400).json({ error: "Invalid spending month allocation.", allocation_error: allocationError });
    updates.month_allocations = rows.map(({ month, amount }) => ({ month, amount }));
    updates.invoice_month = allocationInvoiceMonths(updates.month_allocations);
  }
  if (
    updates.total_amount_usd === void 0 ||
    updates.total_amount_usd === null
  ) {
    const cur = normalizeCurrencyCode(updates.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
    const amt =
      Number(
        updates.total_amount !== void 0
          ? updates.total_amount
          : existing.total_amount,
      ) || 0;
    const invDate = updates.invoice_date || existing.invoice_date;
    if (cur === "USD") {
      updates.total_amount_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token2 = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"],
        );
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token2,
          cur,
          invDate,
        );
      } catch (e) {}
      updates.total_amount_usd = Math.round(amt * rate * 100) / 100;
    }
  } else {
    updates.total_amount_usd = Number(updates.total_amount_usd);
  }
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const partner = db.partners.find(
    (p) =>
      p.partner_id === updated.vendor_id ||
      p.nama_partner.toLowerCase() === updated.vendor_name.toLowerCase(),
  );
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  if (updated.invoice_month) {
    updated.invoice_month = normalizeSpendingMonths(updated.invoice_month);
  }
  const monthsArray = normalizeSpendingMonths(updated.invoice_month);
  if (invoice_file && invoice_file.fileData) {
    const targetInvoiceName = formatInvoiceFileName({
      partnerName: partner?.nama_partner || updated.vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: updated.invoice_number,
      invoiceDate:
        updated.invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: invoice_file.fileName,
    });
    updated.invoice_file_name = targetInvoiceName;
    let invoice_file_url = "";
    if (!invoice_file_url) {
      invoice_file_url = saveLocalFile(
        partner?.nama_partner || updated.vendor_name,
        "Folder Invoice & Billing",
        targetInvoiceName,
        invoice_file.fileData,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Finance",
        "UPLOAD_SUCCESS",
        "PARTNER",
        `File Invoice '${targetInvoiceName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
    updated.invoice_file_url = invoice_file_url;
  }
  if (billing_file && billing_file.fileData) {
    const targetBillingName = formatBillingFileName({
      partnerName: partner?.nama_partner || updated.vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: updated.invoice_number,
      invoiceDate:
        updated.invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: billing_file.fileName,
    });
    updated.billing_file_name = targetBillingName;
    let billing_file_url = "";
    if (!billing_file_url) {
      billing_file_url = saveLocalFile(
        partner?.nama_partner || updated.vendor_name,
        "Folder Invoice & Billing",
        targetBillingName,
        billing_file.fileData,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Finance",
        "UPLOAD_SUCCESS",
        "PARTNER",
        `File Billing '${targetBillingName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
    updated.billing_file_url = billing_file_url;
  }
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "spending", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.spendings[idx] = updated;
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Finance",
    "UPDATE",
    "PARTNER",
    `Memperbarui Catatan Partner Spending untuk '${updated.vendor_name}' (Invoice #${updated.invoice_number})`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, spending: updated });
});
app.delete("/api/partner-spendings/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole } = req.query;
  const idx = (db.spendings || []).findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Data spending tidak ditemukan." });
  }
  const removed = db.spendings[idx];
  const accessDenial = assertRecordAccess(req, "spending", removed);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  db.spendings.splice(idx, 1);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Finance",
    "DELETE",
    "PARTNER",
    `Menghapus Catatan Partner Spending '${removed.vendor_name}' (Invoice #${removed.invoice_number})`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.post("/api/partners/:id/upload-dd", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    docName,
    fileName,
    fileData,
    nomorDokumen,
    tanggalKadaluarsa,
    userEmail,
    userName,
    userRole,
  } = req.body;
  const partner = db.partners.find((p) => p.partner_id === id);
  if (!partner) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const uploadDenial = assertRecordAccess(req, "partner", partner);
  if (uploadDenial) return res.status(uploadDenial.status).json(uploadDenial.body);
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const docObj = partner.daftar_dokumen_dd.find((d) => d.nama === docName);
  const currentFilesCount = (docObj?.files || []).length;
  const finalFileName =
    fileName ||
    formatDueDiligenceFileName({
      vendorName: partner.nama_partner,
      documentName: docName,
      documentDate: tanggalKadaluarsa || new Date().toISOString(),
      sequence: currentFilesCount + 1,
      rawFileName: "document.pdf",
    });
  let driveLink = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    driveLink = saveLocalFile(
      partner.nama_partner,
      "Folder DD",
      finalFileName,
      fileData,
      findTenant(partner.organizationId)?.name,
    );
    addActivityLog(
      userEmail || "user@app",
      userName || "User",
      userRole || "Legal",
      "UPLOAD_SUCCESS",
      "PARTNER",
      `Dokumen DD '${finalFileName}' untuk vendor '${partner.nama_partner}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
      req,
    );
  }
  partner.daftar_dokumen_dd = partner.daftar_dokumen_dd.map((doc) => {
    if (doc.nama === docName) {
      const nowIso = new Date().toISOString();
      const newFileItem = driveLink
        ? {
            id:
              "dd_file_" +
              Date.now() +
              "_" +
              Math.random().toString(36).substring(2, 7),
            fileName: finalFileName,
            linkDrive: driveLink,
            uploadedAt: nowIso,
            year: new Date().getFullYear().toString(),
            tanggalKadaluarsa: tanggalKadaluarsa || "",
          }
        : null;
      const existingFiles = doc.files || [];
      if (
        existingFiles.length === 0 &&
        doc.linkDrive &&
        doc.linkDrive !== driveLink
      ) {
        existingFiles.push({
          id: "dd_file_prev_" + Date.now(),
          fileName: `${doc.nama} (Versi Sebelumnya).pdf`,
          linkDrive: doc.linkDrive,
          uploadedAt: doc.uploadedAt || nowIso,
          year: doc.uploadedAt
            ? new Date(doc.uploadedAt).getFullYear().toString()
            : "",
          tanggalKadaluarsa: doc.tanggalKadaluarsa || "",
        });
      }
      const updatedFiles = newFileItem
        ? [
            newFileItem,
            ...existingFiles.filter((f) => f.linkDrive !== driveLink),
          ]
        : existingFiles;
      const expiry = tanggalKadaluarsa || doc.tanggalKadaluarsa;
      const expiryDays = expiry ? daysUntilForTenant(partner.organizationId, expiry) : null;
      return {
        ...doc,
        status: updatedFiles.length === 0 ? "Missing" : expiryDays !== null && expiryDays < 0 ? "Expired" : "Available",
        nomorDokumen: nomorDokumen || doc.nomorDokumen || "",
        tanggalKadaluarsa: tanggalKadaluarsa || doc.tanggalKadaluarsa,
        linkDrive: driveLink || doc.linkDrive || "",
        uploadedAt: driveLink ? nowIso : doc.uploadedAt,
        files: updatedFiles,
      };
    }
    return doc;
  });
  const previousDdStatus = partner.status_dd;
  partner.status_dd = computeDueDiligenceStatus(partner.daftar_dokumen_dd);
  if (partner.status_dd === "Complete" && previousDdStatus !== "Complete") {
    partner.tanggal_dd_diverifikasi = new Date().toISOString().split("T")[0];
  }
  partner.updated_at = new Date().toISOString();
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "DD_UPDATE",
    "PARTNER",
    `Mengunggah dokumen DD '${docName}' untuk partner ${partner.nama_partner}`,
    req,
  );
  triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, partner });
});
app.delete("/api/partners/:id/dd-file", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { docName, fileId, userEmail, userName, userRole } = req.body;
  const partner = db.partners.find((p) => p.partner_id === id);
  if (!partner) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const deleteDenial = assertRecordAccess(req, "partner", partner);
  if (deleteDenial) return res.status(deleteDenial.status).json(deleteDenial.body);
  partner.daftar_dokumen_dd = partner.daftar_dokumen_dd.map((doc) => {
    if (doc.nama === docName) {
      const remainingFiles = (doc.files || []).filter((f) => f.id !== fileId);
      const hasFiles = remainingFiles.length > 0;
      return {
        ...doc,
        files: remainingFiles,
        status: hasFiles ? "Available" : "Missing",
        linkDrive: hasFiles ? remainingFiles[0].linkDrive : void 0,
        uploadedAt: hasFiles ? remainingFiles[0].uploadedAt : void 0,
      };
    }
    return doc;
  });
  const previousDdStatus = partner.status_dd;
  partner.status_dd = computeDueDiligenceStatus(partner.daftar_dokumen_dd);
  if (partner.status_dd === "Complete" && previousDdStatus !== "Complete") {
    partner.tanggal_dd_diverifikasi = new Date().toISOString().split("T")[0];
  }
  partner.updated_at = new Date().toISOString();
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "DELETE",
    "PARTNER",
    `Menghapus file dari dokumen DD '${docName}' partner ${partner.nama_partner}`,
    req,
  );
  res.json({ success: true, partner });
});

app.post("/api/contracts/export-google-docs", async (req: express.Request, res: express.Response) => {
  try {
    const title = req.body.title || req.body.docTitle || "Partnership Agreement";
    const contentHtml = req.body.contentHtml || req.body.htmlContent || req.body.html;
    const partnerName = req.body.partnerName || req.body.partner_nama || req.body.partnerId;

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
        const partner = scopedRecords(req, "partner", db.partners).find(
          (p: any) => p.nama_partner?.toLowerCase() === String(partnerName).toLowerCase() || p.partner_id === partnerName
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
        console.warn("Folder resolve fallback:", fErr);
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
    console.error("Error creating Google Doc:", error);
    res.status(500).json({
      error: error?.message || "Gagal membuat dokumen Google Docs.",
    });
  }
});

// Aggregation Endpoint for Fast Initial Data Load (replaces multi-endpoint polling)
/**
 * Operational workspace payload (PRD §11.4): one verified organization,
 * department-scoped before any client aggregation, no tenant directory and
 * no provider configuration — only non-sensitive service availability.
 */
app.get("/api/init-data", (req: express.Request, res: express.Response) => {
  refreshContractLifecycles();
  const organizationId = getRequestTenantId(req);
  const settings = getTenantSettings(organizationId);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    organizationId,
    contracts: scopedRecords(req, "contract", db.contracts),
    ios: scopedRecords(req, "io", db.ios),
    partners: scopedRecords(req, "partner", db.partners),
    notifications: scopedRecords(req, "notification", db.notifications),
    evaluations: scopedRecords(req, "evaluation", db.evaluations),
    spendings: scopedRecords(req, "spending", db.spendings),
    services: {
      aiAvailable: Boolean(getEffectiveGeminiApiKey()) && settings.modules.aiAssistant,
      googleUploadsAvailable: Boolean(sanitizeParentFolderId(db.googleConfig?.driveFolderId)) &&
        Boolean(db.googleConfig?.accessToken || db.googleConfig?.refreshToken || hasServiceAccountCredentials()),
    },
    timestamp: Date.now(),
  });
});

app.get("/api/contracts", (req: express.Request, res: express.Response) => {
  refreshContractLifecycles();
  const contractsList = scopedRecords(req, "contract", db.contracts);
  const result = contractsList.map((c) => {
    const cur = normalizeCurrencyCode(c.currency, tenantDefaultCurrency(c.organizationId));
    const amt = Number(c.nilai_kontrak) || 0;
    const usdVal =
      c.nilai_kontrak_usd !== void 0 && c.nilai_kontrak_usd !== null
        ? c.nilai_kontrak_usd
        : cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
    return {
      ...c,
      currency: cur,
      nilai_kontrak_usd: usdVal,
    };
  });
  res.json(result);
});
app.post("/api/contracts/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!ensureAiAvailable(req, res)) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `contracts:${tenantId}`;
    const cached = globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const startTime = Date.now();
    const prompt = `You are an expert legal contract analyst. Our organization is "${ctx.organizationName}" (${ctx.industryName}, primary jurisdiction: ${ctx.countryName}). Extract the following from this contract so it can be registered in our contract repository. The contract may be written in any language and governed by any jurisdiction.

1. "jenis_dokumen": "Agreement Addendum" if this is an amendment, addendum, variation or extension; otherwise "Master Agreement".
2. "judul_kontrak": the full official title of the agreement.
3. "nama_partner": the full legal name of the counterparty — the party that is NOT ${ctx.organizationName}.
4. "nomor_kontrak": the contract reference number issued by ${ctx.organizationName}. When the document carries two reference numbers (ours and the counterparty's), prefer the one issued by ${ctx.organizationName}; if ours cannot be identified, return the first reference number shown.
5. "nomor_kontrak_induk": for an addendum, the reference number of the master agreement it amends; otherwise "".
6. "tanggal_mulai": the effective (or signing) date as ISO 8601 "YYYY-MM-DD".
7. "tanggal_berakhir": the expiry date as "YYYY-MM-DD", computed precisely:
   a. An explicit end date without automatic renewal: use it as written.
   b. A relative term ("valid for 1 year from the start date"): end date = start date + term − 1 day (e.g. start 2024-11-04, 1 year → 2025-11-03; 6 months → 2025-05-03).
   c. A fixed end date plus automatic renewal for another period: add one renewal period to the written end date and set auto_renewal to true.
   d. Evergreen / renews until terminated by either party: return the day before the start date in year 9999 (start 2024-11-04 → "9999-11-03") and set auto_renewal to true.
   e. An extension addendum: compute the new end date from the previous term's end date.
8. "klausul_jangka_waktu": quote verbatim the term/renewal clause.
9. "durasi_perjanjian": the term as short text (e.g. "1 year", "6 months", "Until terminated").
10. "nilai_kontrak": the total committed contract value as a number, or 0 when the value is variable, commission-based, or not stated.
11. "currency": the ISO 4217 code of the contract value (e.g. "USD", "SGD", "IDR", "INR", "JPY"); "${ctx.defaultCurrency}" if no currency is stated.
12. "auto_renewal": true when the contract renews automatically or runs until terminated; otherwise false.
13. "notice_period_hari": the notice period in days for termination or non-renewal (default 30 when not specified).
14. "ringkasan_perubahan": for an addendum, a clear summary of which clauses changed and how; otherwise "".
15. "field_yang_berubah": for an addendum, an array containing any of exactly these codes: "Nilai Kontrak / IO", "Jangka Waktu Periode", "Ruang Lingkup / Deliverables", "Syarat Pembayaran", "Pihak Berwenang". Otherwise [].
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
    console.log(
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
              jenis_dokumen: { type: Type.STRING },
              judul_kontrak: { type: Type.STRING },
              nama_partner: { type: Type.STRING },
              nomor_kontrak: { type: Type.STRING },
              nomor_kontrak_induk: { type: Type.STRING },
              tanggal_mulai: { type: Type.STRING },
              tanggal_berakhir: { type: Type.STRING },
              klausul_jangka_waktu: { type: Type.STRING },
              durasi_perjanjian: { type: Type.STRING },
              nilai_kontrak: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              auto_renewal: { type: Type.BOOLEAN },
              notice_period_hari: { type: Type.NUMBER },
              ringkasan_perubahan: { type: Type.STRING },
              field_yang_berubah: {
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
    extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.tanggal_mulai) {
      parsedData.tanggal_mulai = normalizeParsedDate(parsedData.tanggal_mulai);
    }
    if (parsedData.tanggal_berakhir) {
      parsedData.tanggal_berakhir = normalizeParsedDate(
        parsedData.tanggal_berakhir,
      );
    }
    const clauseText = `${parsedData.durasi_perjanjian || ""} ${parsedData.klausul_jangka_waktu || ""}`;
    const isPerpetualClause =
      /sampai pengakhiran|until terminated|salah satu pihak mengakhiri|terus menerus|tanpa batas|unlimited|perpetual/i.test(
        clauseText,
      );
    if (isPerpetualClause && parsedData.tanggal_mulai) {
      parsedData.auto_renewal = true;
      const parts = parsedData.tanggal_mulai.split("-").map(Number);
      if (parts.length === 3) {
        const prevDay = new Date(parts[0], parts[1] - 1, parts[2]);
        prevDay.setDate(prevDay.getDate() - 1);
        const prevMonth = String(prevDay.getMonth() + 1).padStart(2, "0");
        const prevDate = String(prevDay.getDate()).padStart(2, "0");
        parsedData.tanggal_berakhir = `9999-${prevMonth}-${prevDate}`;
      }
    } else if (
      parsedData.tanggal_mulai &&
      (!parsedData.tanggal_berakhir ||
        parsedData.tanggal_berakhir === parsedData.tanggal_mulai ||
        new Date(parsedData.tanggal_berakhir) <=
          new Date(parsedData.tanggal_mulai))
    ) {
      const computedResult = computeContractEndDateFromDuration(
        parsedData.tanggal_mulai,
        clauseText || (parsedData.auto_renewal ? "1 tahun" : ""),
        Boolean(parsedData.auto_renewal),
      );
      if (computedResult) {
        parsedData.tanggal_berakhir = computedResult.endDate;
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
      globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    console.error("Error parsing contract:", error);
    res
      .status(500)
      .json({
        error:
          error?.message ||
          "Failed to parse contract document. Google AI model is currently busy, please try again.",
      });
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
  if (!ensureAiAvailable(req, res)) return;
  const partner = db.partners.find((p) => p.partner_id === contract.partner_id && p.organizationId === contract.organizationId);
  try {
    const selectedModel = getValidAiModel(req.body.model);
    const ctx = aiPolicyContext(contract.organizationId);
    const regulatorLine = ctx.regulators.length > 0
      ? `Regulators relevant to our industry in ${ctx.countryName}: ${ctx.regulators.join(", ")}. Assess outsourcing, audit-right and reporting expectations they typically impose.`
      : "No specific sector regulator is configured; assess against general commercial law and good practice.";
    const prompt = `You are a senior corporate legal counsel and AI contract reviewer acting for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName}.
Perform a risk and compliance analysis of the commercial contract below and propose balanced redlines. Write every narrative field in ${ctx.responseLanguage}.

=== CONTRACT ===
Reference: ${contract.nomor_kontrak}
Title: ${contract.judul_kontrak}
Document type: ${contract.jenis_dokumen || "Master Agreement"}
Counterparty: ${partner?.nama_partner || "-"}${partner?.country ? ` (${getCountryPack(partner.country).name})` : ""}
Categories: ${(contract.kategori_kerjasama || []).join(", ") || "-"}
Value: ${normalizeCurrencyCode(contract.currency, ctx.defaultCurrency)} ${Number(contract.nilai_kontrak || 0)}
Term: ${contract.tanggal_mulai} to ${contract.tanggal_berakhir} (days remaining: ${contract.sisa_hari ?? "-"})
Auto-renewal: ${contract.auto_renewal ? "yes" : "no"}
Notice period: ${contract.notice_period_hari || 30} days (${contract.notice_type_required || "termination/extension"})
Internal notes / clause summary: ${contract.internal_notes || contract.ringkasan_perubahan || "Standard B2B commercial services agreement."}
Counterparty due-diligence status: ${partner?.status_dd || "unknown"}
${req.body.customClauseText ? `
Additional clause text to review:
${String(req.body.customClauseText).slice(0, 20000)}` : ""}

=== REVIEW INSTRUCTIONS ===
Assess liability, termination, indemnities, confidentiality and data protection (reference ${ctx.dataProtectionLaw} where our own processing is concerned), governing law and dispute resolution (our default position: ${ctx.governingLaw}), and these industry focus areas: ${ctx.reviewFocus.join("; ")}.
${regulatorLine}
Industry standards and regulatory frameworks to check against: ${ctx.complianceStandards.join("; ")}.
Industry rule checks — apply every rule below; each rule that is triggered must appear in keyFindings and in analyzedClauses:
${ctx.clauseRules.map((rule) => `- ${rule}`).join("\n")}
Tax points to consider (${ctx.indirectTaxName} and withholding): ${ctx.taxConsiderations.join(" ")}
Do not invent statute or regulation numbers — cite them only when you are certain; otherwise describe the requirement in general terms.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: 2-3 short paragraphs on negotiating position, regulatory fit and key risks.
4. keyFindings: 3-5 of the most important issues.
5. analyzedClauses: the main clauses, each with clauseTitle, riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue, identifiedRisk, recommendedRedline (balanced replacement wording) and legalRationale (legal basis or negotiation argument).
6. complianceChecklist: 5-6 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes. Cover: data protection, audit and regulator access (if a regulator applies), notice period and auto-renewal clarity, governing law and dispute forum, and the industry focus areas above.
`;
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallRiskScore: { type: Type.INTEGER },
            riskLevel: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
            analyzedClauses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  clauseTitle: { type: Type.STRING },
                  riskCategory: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  originalTextOrIssue: { type: Type.STRING },
                  identifiedRisk: { type: Type.STRING },
                  recommendedRedline: { type: Type.STRING },
                  legalRationale: { type: Type.STRING },
                },
                required: [
                  "clauseTitle",
                  "severity",
                  "originalTextOrIssue",
                  "identifiedRisk",
                  "recommendedRedline",
                  "legalRationale",
                ],
              },
            },
            complianceChecklist: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  item: { type: Type.STRING },
                  status: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
                required: ["item", "status", "notes"],
              },
            },
          },
          required: [
            "overallRiskScore",
            "riskLevel",
            "executiveSummary",
            "keyFindings",
            "analyzedClauses",
            "complianceChecklist",
          ],
        },
      },
    });
    const parsed = JSON.parse((response as any).text);
    const nowIso = new Date().toISOString();
    parsed.analyzed_at = nowIso;
    contract.redline_analysis = parsed;
    contract.redline_analyzed_at = nowIso;
    contract.updated_at = nowIso;
    saveDb();
    res.json({
      success: true,
      cached: false,
      analysis: parsed,
      analyzed_at: nowIso,
    });
  } catch (error) {
    console.error("Error during redline analysis:", error);
    res
      .status(500)
      .json({
        error:
          error?.message ||
          "Gagal melakukan analisis redline AI. Silakan coba kembali.",
      });
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
  const document = sqliteDb
    .prepare(`SELECT id, organization_id, name FROM contract_documents WHERE id = ?`)
    .get(req.params.id) as { id: string; organization_id: string; name: string } | undefined;
  if (!document || !isMatchingOrg(document.organization_id, getRequestTenantId(req))) {
    return res.status(404).json({ error: "Document not found." });
  }
  if (!ensureAiAvailable(req, res)) return;
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
      sqliteDb.prepare(`
        INSERT INTO contract_comments (id, contract_id, parent_id, comment_type, body, quote, new_text, status, author_id, created_at)
        VALUES (?, ?, NULL, 'suggestion', ?, ?, ?, 'open', ?, ?)
      `).run(id, document.id, rationale ? `AI Redlining: ${rationale}` : "AI Redlining suggestion.", quote, newText, actor.id, nowIso);
      created.push({ id, quote, new_text: newText });
    }
    res.status(201).json({ success: true, created, skipped });
  } catch (error: any) {
    console.error("Error during AI redlining:", error);
    res.status(500).json({ error: error?.message || "AI redlining failed. Please try again." });
  }
});

// Custom Template & Translation Endpoints
// Contract templates are tenant-scoped (PRD §3.3.3, §3.4.1).
app.get("/api/templates", (req, res) => {
  const tenantId = getRequestTenantId(req);
  res.json((db.templates || []).filter((t: any) => isMatchingOrg(t.organizationId, tenantId)));
});

app.post("/api/templates", (req, res) => {
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

    saveDb();
    res.json({ success: true, template: templateData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/templates/:id", (req, res) => {
  const tenantId = getRequestTenantId(req);
  const index = (db.templates || []).findIndex(
    (t: any) => t.id === req.params.id && isMatchingOrg(t.organizationId, tenantId),
  );
  if (index < 0) {
    return res.status(404).json({ error: "Template not found." });
  }
  db.templates.splice(index, 1);
  saveDb();
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
  if (!ensureAiAvailable(req, res)) return;

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
    console.error("Error generating AI template:", error);
    res.status(500).json({ error: error?.message || "Gagal membuat template. Coba lagi." });
  }
});

app.use("/api", createGoogleCredentialsRouter(googleCredentials));

// Create Contract documents: explorer, draft versions, metadata, comments/redlines.
app.use("/api", createDocumentRouter({ db: sqliteDb, tenantOf: getRequestTenantId }));
// Document Approval: sequential sign-off on a My Documents item or an uploaded file.
app.use("/api", createApprovalRouter({ db: sqliteDb, tenantOf: getRequestTenantId }));

async function persistContractTerminationFile(req: express.Request, record: { organizationId?: string; partner_id?: string }, file: TerminationFile) {
  const partner = db.partners.find(p => p.partner_id === record.partner_id);
  const tenant = findTenant(record.organizationId);
  const storedName = `termination-${randomUUID()}.${file.extension}`;
  const url = saveLocalFile(partner?.nama_partner, 'Folder Termination', storedName, file.fileData, tenant?.name);
  return { fileName: file.fileName, url };
}

function terminationWriteError(res: express.Response, code: string) {
  return res.status(400).json({ code, error: CONTRACT_TERMINATION_TRANSLATIONS.EN[code] || code });
}

app.post("/api/contracts", async (req: express.Request, res: express.Response) => {
  const {
    nomor_kontrak,
    judul_kontrak,
    partner_id,
    jenis_dokumen,
    parent_contract_id,
    parent_contract_nomor,
    kategori_kerjasama,
    tanggal_mulai,
    tanggal_berakhir,
    currency,
    nilai_kontrak,
    nilai_kontrak_usd: req_usd,
    auto_renewal,
    notice_period_hari,
    notice_type_required,
    status_approval,
    status,
    pic_internal,
    internal_notes,
    field_yang_berubah,
    ringkasan_perubahan,
    fileName,
    fileData,
    userEmail,
    userName,
    userRole,
  } = req.body;
  if (
    !nomor_kontrak ||
    !judul_kontrak ||
    !partner_id ||
    !tanggal_mulai ||
    !tanggal_berakhir
  ) {
    return res
      .status(400)
      .json({
        error:
          "Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi.",
      });
  }
  if (new Date(tanggal_berakhir) <= new Date(tanggal_mulai)) {
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
      String(c.nomor_kontrak || "").trim().toLowerCase() ===
      nomor_kontrak.trim().toLowerCase(),
  );
  if (existingContractDup) {
    return res
      .status(400)
      .json({
        error: `Nomor Kontrak '${nomor_kontrak}' sudah terdaftar dalam sistem.`,
      });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = db.partners.find((p) => p.partner_id === partner_id);
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(nilai_kontrak) || 0;
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
          tanggal_mulai,
        );
      } catch (e) {
        console.error("Failed fetching historical rate for contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatContractFileName({
    partnerName: partner?.nama_partner,
    documentType: jenis_dokumen || "Master Agreement",
    contractNumber: nomor_kontrak,
    startDate: tanggal_mulai,
    rawFileName: fileName || `${nomor_kontrak}.pdf`,
  });
  let link_file_kontrak = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!link_file_kontrak) {
      link_file_kontrak = saveLocalFile(
        partner?.nama_partner,
        "Folder Contract",
        targetFileName,
        fileData,
        targetTenant?.name,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Legal",
        "UPLOAD_SUCCESS",
        "CONTRACT",
        `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
  }
  const lifecycleDraft: any = {
    organizationId: targetOrgId,
    tanggal_mulai,
    tanggal_berakhir,
    auto_renewal: lifecycleMode !== 'terminated' && Boolean(auto_renewal),
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleMode === 'terminated' ? req.body.termination_date : null,
  };
  rollForwardAutoRenewal(lifecycleDraft);
  const finalTanggalBerakhir = lifecycleDraft.tanggal_berakhir;
  const { status: finalStatus, daysRemaining: diffDays } = contractLifecycle(lifecycleDraft, getTenantSettings(targetOrgId));
  const terminationDocument = terminationFile ? await persistContractTerminationFile(req, { organizationId: targetOrgId, partner_id }, terminationFile) : undefined;
  const newContract = {
    contract_id: generateNextContractId(),
    organizationId: targetOrgId,
    jenis_dokumen: jenis_dokumen || "Master Agreement",
    parent_contract_id:
      jenis_dokumen === "Agreement Addendum" ? parent_contract_id : void 0,
    parent_contract_nomor:
      jenis_dokumen === "Agreement Addendum" ? parent_contract_nomor : void 0,
    nomor_kontrak,
    judul_kontrak,
    partner_id,
    kategori_kerjasama: Array.isArray(kategori_kerjasama)
      ? kategori_kerjasama
      : ["Umum"],
    tanggal_mulai,
    tanggal_berakhir: finalTanggalBerakhir,
    currency: cur,
    nilai_kontrak: amt,
    nilai_kontrak_usd: Number(total_usd),
    auto_renewal: lifecycleDraft.auto_renewal,
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleDraft.termination_date,
    termination_reason: String(req.body.termination_reason || '').trim().slice(0, 10000),
    termination_document: terminationDocument,
    notice_period_hari: Number(notice_period_hari) || 30,
    notice_type_required: notice_type_required || "Termination",
    status: finalStatus,
    status_approval: normalizeApprovalStatus(status_approval),
    pic_internal: pic_internal || "Legal Team",
    internal_notes: internal_notes ? String(internal_notes).trim() : void 0,
    link_file_kontrak,
    fileName: targetFileName,
    field_yang_berubah: Array.isArray(field_yang_berubah)
      ? field_yang_berubah
      : void 0,
    ringkasan_perubahan: ringkasan_perubahan || void 0,
    sisa_hari: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "contract", newContract);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.contracts.unshift(newContract);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "CREATE",
    "CONTRACT",
    `Membuat Kontrak Baru '${nomor_kontrak}' (${judul_kontrak}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, contract: newContract });
});
app.put("/api/contracts/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole, fileData, fileName, termination_document_file, ...updates } =
    req.body;
  const idx = db.contracts.findIndex((c) => c.contract_id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  }
  const existing = db.contracts[idx];
  const tenantDenial = assertRecordAccess(req, "contract", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  delete (updates as any).organizationId;
  delete updates.termination_document;
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
  const amt = Number(updated.nilai_kontrak) || 0;
  let total_usd = updates.nilai_kontrak_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"] || req.body.accessToken,
        );
        const startDate = updated.tanggal_mulai || existing.tanggal_mulai;
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token,
          cur,
          startDate,
        );
      } catch (e) {
        console.error("Failed fetching rate for edit contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.nilai_kontrak = amt;
  updated.nilai_kontrak_usd = Number(total_usd);
  if (
    updated.tanggal_mulai &&
    updated.tanggal_berakhir &&
    new Date(updated.tanggal_berakhir) <= new Date(updated.tanggal_mulai)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.nomor_kontrak) {
    const dup = db.contracts.find(
      (c) =>
        c.nomor_kontrak.trim().toLowerCase() ===
          updated.nomor_kontrak.trim().toLowerCase() && c.contract_id !== id,
    );
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor Kontrak '${updated.nomor_kontrak}' sudah digunakan oleh kontrak lain.`,
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
      partnerName: partner?.nama_partner,
      documentType: updated.jenis_dokumen || "Master Agreement",
      contractNumber: updated.nomor_kontrak,
      startDate: updated.tanggal_mulai,
      rawFileName:
        fileName || updated.fileName || `${updated.nomor_kontrak}.pdf`,
    });
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] || req.body.accessToken,
    );
    let link_file_kontrak = "";
    if (!link_file_kontrak) {
      link_file_kontrak = saveLocalFile(
        partner?.nama_partner,
        "Folder Contract",
        targetFileName,
        fileData,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Legal",
        "UPLOAD_SUCCESS",
        "CONTRACT",
        `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
    updated.link_file_kontrak = link_file_kontrak;
    updated.fileName = targetFileName;
  }
  if (terminationFile) updated.termination_document = await persistContractTerminationFile(req, updated, terminationFile);
  updated.status = normalizeContractStatus(updated.status);
  updated.status_approval = normalizeApprovalStatus(updated.status_approval);
  rollForwardAutoRenewal(updated);
  const lifecycle = contractLifecycle(updated, getTenantSettings(updated.organizationId));
  updated.sisa_hari = lifecycle.daysRemaining ?? updated.sisa_hari;
  updated.status = lifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "contract", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.contracts[idx] = updated;
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Legal",
    "UPDATE",
    "CONTRACT",
    `Memperbarui data Kontrak '${updated.nomor_kontrak}'`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, contract: updated });
});
app.delete("/api/contracts/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole } = req.query;
  const ctr = db.contracts.find((c) => c.contract_id === id);
  if (!ctr) return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "contract", ctr);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  for (const io of db.ios) if (io.organizationId === ctr.organizationId && io.contract_id === id) io.contract_id = null;
  for (const child of db.contracts) if (child.organizationId === ctr.organizationId && child.parent_contract_id === id) child.parent_contract_id = null;
  db.notifications = db.notifications.filter((n) => !(n.organizationId === ctr.organizationId && n.parent_type === 'Contract' && n.parent_id === id));
  db.contracts = db.contracts.filter((c) => c !== ctr);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Admin",
    "DELETE",
    "CONTRACT",
    `Menghapus Kontrak '${ctr.nomor_kontrak}' (${ctr.judul_kontrak})`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.get("/api/ios", (req: express.Request, res: express.Response) => {
  const iosList = scopedRecords(req, "io", db.ios);
  const result = iosList.map((io) => {
    const c = db.contracts.find((ctr) => ctr.contract_id === io.contract_id && ctr.organizationId === io.organizationId);
    const cur = normalizeCurrencyCode(io.currency || io.mata_uang, tenantDefaultCurrency(io.organizationId));
    const amt = Number(io.nilai_io) || 0;
    const usdVal =
      io.nilai_io_usd !== void 0 && io.nilai_io_usd !== null
        ? io.nilai_io_usd
        : cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
    return {
      ...io,
      currency: cur,
      nilai_io_usd: usdVal,
      contract_nomor: c ? c.nomor_kontrak : io.contract_nomor || "-",
    };
  });
  res.json(result);
});
app.post("/api/ios/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!ensureAiAvailable(req, res)) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `ios:${tenantId}`;
    const cached = globalOcrCache.get(inputHash, cacheScope);
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

1. "nomor_io": the document's reference number; "-" if it has none.
2. "judul_io": the order, campaign, project or engagement title.
3. "nama_partner": the counterparty's full legal name (not ${ctx.organizationName}).
4. "contract_nomor": the reference number of the master agreement it refers to, if any.
5. "kanal_media": the ${profile.channelLabel.toLowerCase()} this document covers (e.g. ${profile.channelPlaceholder.replace(/^e\.g\. /, "")}); "-" if not stated.
6. "pricing_model": one of ${profile.pricingModels.map((m) => `"${m}"`).join(", ")} — or the closest short label used in the document.
7. "tanggal_mulai": the start date as ISO 8601 "YYYY-MM-DD"; "-" if not separately stated.
8. "tanggal_berakhir": the end date as "YYYY-MM-DD". If only a duration is given, end date = start date + duration − 1 day. "-" if unknown.
9. "durasi_campaign": the duration as short text (e.g. "3 months", "14 days").
10. "nilai_io": the total committed value as a plain number; 0 when the value is variable or uncapped.
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
    console.log(
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
              nomor_io: { type: Type.STRING },
              judul_io: { type: Type.STRING },
              nama_partner: { type: Type.STRING },
              contract_nomor: { type: Type.STRING },
              kanal_media: { type: Type.STRING },
              pricing_model: { type: Type.STRING },
              tanggal_mulai: { type: Type.STRING },
              tanggal_berakhir: { type: Type.STRING },
              durasi_campaign: { type: Type.STRING },
              nilai_io: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              deliverables: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.tanggal_mulai) {
      parsedData.tanggal_mulai = normalizeParsedDate(parsedData.tanggal_mulai);
    }
    if (parsedData.tanggal_berakhir) {
      parsedData.tanggal_berakhir = normalizeParsedDate(
        parsedData.tanggal_berakhir,
      );
    }
    if (
      parsedData.tanggal_mulai &&
      (!parsedData.tanggal_berakhir ||
        parsedData.tanggal_berakhir === parsedData.tanggal_mulai ||
        new Date(parsedData.tanggal_berakhir) <=
          new Date(parsedData.tanggal_mulai))
    ) {
      const computedEnd = computeContractEndDateFromDuration(
        parsedData.tanggal_mulai,
        parsedData.durasi_campaign || "",
      );
      if (computedEnd) {
        parsedData.tanggal_berakhir = computedEnd;
      }
    }
    if (
      parsedData.nilai_io === null ||
      parsedData.nilai_io === void 0 ||
      isNaN(parsedData.nilai_io)
    ) {
      parsedData.nilai_io = 0;
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
      globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    console.error("Error parsing IO:", error);
    res
      .status(500)
      .json({
        error:
          error?.message ||
          "Failed to parse IO document. Google AI model is currently busy, please try again.",
      });
  }
});
app.post("/api/ios", async (req: express.Request, res: express.Response) => {
  const {
    contract_id,
    nomor_io,
    judul_io,
    partner_id,
    kanal_media,
    tanggal_mulai,
    tanggal_berakhir,
    pricing_model,
    charging_type,
    currency,
    nilai_io,
    nilai_io_usd: req_usd,
    deliverables,
    notice_period_hari,
    notice_type_required,
    fileName,
    fileData,
    userEmail,
    userName,
    userRole,
  } = req.body;
  if (
    !nomor_io ||
    !judul_io ||
    !partner_id ||
    !tanggal_mulai ||
    !tanggal_berakhir ||
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
  if (new Date(tanggal_berakhir) <= new Date(tanggal_mulai)) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  const ioTenantId = getRequestTenantId(req);
  const existingIODup = db.ios.find(
    (i) => isMatchingOrg(i.organizationId, ioTenantId) && String(i.nomor_io || "").trim().toLowerCase() === nomor_io.trim().toLowerCase(),
  );
  if (existingIODup) {
    return res
      .status(400)
      .json({ error: `Nomor IO '${nomor_io}' sudah terdaftar dalam sistem.` });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = db.partners.find((p) => p.partner_id === partner_id);
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const contract = db.contracts.find((c) => c.contract_id === contract_id);
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(nilai_io) || 0;
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
          tanggal_mulai,
        );
      } catch (e) {
        console.error("Failed fetching historical rate for IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatIOFileName({
    partnerName: partner?.nama_partner,
    mediaChannel: kanal_media || "Digital Channel",
    ioNumber: nomor_io,
    startDate: tanggal_mulai,
    rawFileName: fileName || `${nomor_io}.pdf`,
  });
  let link_file_io = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!link_file_io) {
      link_file_io = saveLocalFile(
        partner?.nama_partner,
        "Folder IO",
        targetFileName,
        fileData,
        targetTenant?.name,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Business Owner",
        "UPLOAD_SUCCESS",
        "IO",
        `File IO '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
  }
  const { status, daysRemaining: diffDays } = computeLifecycle(targetOrgId, tanggal_berakhir, "Active", false);
  const newIO = {
    io_id: generateNextIOId(),
    organizationId: targetOrgId,
    contract_id: contract_id || void 0,
    contract_nomor: contract ? contract.nomor_kontrak : "-",
    nomor_io,
    judul_io,
    partner_id,
    kanal_media: kanal_media || "",
    tanggal_mulai,
    tanggal_berakhir,
    pricing_model,
    charging_type,
    currency: cur,
    mata_uang: cur,
    nilai_io: amt,
    nilai_io_usd: Number(total_usd),
    deliverables: deliverables || "-",
    notice_period_hari: Number(notice_period_hari) || 14,
    notice_type_required: notice_type_required || "Termination",
    status,
    link_file_io,
    fileName: targetFileName,
    sisa_hari: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "io", newIO);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.ios.unshift(newIO);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Business Owner",
    "CREATE",
    "IO",
    `Membuat dokumen komersial baru '${nomor_io}' (${judul_io}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, io: newIO });
});
app.put("/api/ios/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole, ...updates } = req.body;
  const idx = db.ios.findIndex((i) => i.io_id === id);
  if (idx === -1) return res.status(404).json({ error: "IO tidak ditemukan." });
  const existing = db.ios[idx];
  const tenantDenial = assertRecordAccess(req, "io", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  delete (updates as any).organizationId;
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const cur = normalizeCurrencyCode(updated.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
  updated.currency = cur;
  updated.mata_uang = cur;
  const amt = Number(updated.nilai_io) || 0;
  let total_usd = updates.nilai_io_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"] || req.body.accessToken,
        );
        const startDate = updated.tanggal_mulai || existing.tanggal_mulai;
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token,
          cur,
          startDate,
        );
      } catch (e) {
        console.error("Failed fetching rate for edit IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.nilai_io = amt;
  updated.nilai_io_usd = Number(total_usd);
  if (
    updates.fileData &&
    typeof updates.fileData === "string" &&
    updates.fileData.includes("base64,")
  ) {
    const fileData = updates.fileData;
    delete updated.fileData;
    const partner = db.partners.find(
      (p) => p.partner_id === updated.partner_id,
    );
    const targetFileName = formatIOFileName({
      partnerName: partner?.nama_partner,
      mediaChannel: updated.kanal_media || "Digital Channel",
      ioNumber: updated.nomor_io,
      startDate: updated.tanggal_mulai,
      rawFileName:
        updates.fileName || updated.fileName || `${updated.nomor_io}.pdf`,
    });
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] || req.body.accessToken,
    );
    let link_file_io = "";
    if (!link_file_io) {
      link_file_io = saveLocalFile(
        partner?.nama_partner,
        "Folder IO",
        targetFileName,
        fileData,
      );
      addActivityLog(
        userEmail || "user@app",
        userName || "User",
        userRole || "Business Owner",
        "UPLOAD_SUCCESS",
        "IO",
        `File IO '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`,
        req,
      );
    }
    updated.link_file_io = link_file_io;
    updated.fileName = targetFileName;
  }
  if (
    updated.tanggal_mulai &&
    updated.tanggal_berakhir &&
    new Date(updated.tanggal_berakhir) <= new Date(updated.tanggal_mulai)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.nomor_io) {
    const dup = db.ios.find(
      (i) =>
        isMatchingOrg(i.organizationId, updated.organizationId) &&
        String(i.nomor_io || "").trim().toLowerCase() ===
          updated.nomor_io.trim().toLowerCase() && i.io_id !== id,
    );
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor IO '${updated.nomor_io}' sudah digunakan oleh IO lain.`,
        });
    }
  }
  const ioLifecycle = computeLifecycle(updated.organizationId, updated.tanggal_berakhir, updated.status, false);
  updated.sisa_hari = ioLifecycle.daysRemaining ?? updated.sisa_hari;
  updated.status = ioLifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "io", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.ios[idx] = updated;
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Business Owner",
    "UPDATE",
    "IO",
    `Memperbarui data Insertion Order '${updated.nomor_io}'`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, io: updated });
});
app.delete("/api/ios/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { userEmail, userName, userRole } = req.query;
  const item = db.ios.find((i) => i.io_id === id);
  if (!item) return res.status(404).json({ error: "IO tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "io", item);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  db.ios = db.ios.filter((i) => i !== item);
  saveDb();
  addActivityLog(
    userEmail || "user@app",
    userName || "User",
    userRole || "Admin",
    "DELETE",
    "IO",
    `Menghapus Insertion Order '${item.nomor_io}' (${item.judul_io})`,
    req,
  );
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
app.get("/api/notification-logs", (req: express.Request, res: express.Response) => {
  res.json(scopedRecords(req, "notification", db.notifications));
});
/**
 * Matches in-memory notifications the caller may touch. scopedRecords re-reads rows from SQLite,
 * so this matches by organization + notif_id; object identity never matches db.notifications.
 */
function visibleNotificationFilter(req: express.Request) {
  const org = orgContextOf(req).organizationId;
  const ids = new Set(scopedRecords(req, "notification", db.notifications).map((n: any) => n.notif_id));
  return { has: (n: any) => n.organizationId === org && ids.has(n.notif_id) };
}
/** Only notifications attached to records the caller can see are touched (PRD §4.5.2). */
app.post("/api/notification-logs/mark-read", (req: express.Request, res: express.Response) => {
  const { notif_id, markAll } = req.body || {};
  const visible = visibleNotificationFilter(req);
  db.notifications = (db.notifications || []).map((n) =>
    visible.has(n) && (markAll || (notif_id && n.notif_id === notif_id)) ? { ...n, is_read: true } : n,
  );
  saveDb();
  res.json({ success: true, notifications: scopedRecords(req, "notification", db.notifications) });
});
app.post("/api/notification-logs/delete", (req: express.Request, res: express.Response) => {
  const { notif_id, notif_ids, deleteAll } = req.body || {};
  const visible = visibleNotificationFilter(req);
  const chosen = new Set<string>(Array.isArray(notif_ids) ? notif_ids : notif_id ? [notif_id] : []);
  db.notifications = (db.notifications || []).filter((n) => !(visible.has(n) && (deleteAll || chosen.has(n.notif_id))));
  saveDb();
  res.json({ success: true, notifications: scopedRecords(req, "notification", db.notifications) });
});
app.post("/api/cron/trigger-check", (req: express.Request, res: express.Response) => {
  const count = recalculateStatuses();
  res.json({ success: true, newNotificationsGenerated: count });
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
        console.warn(
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
      console.error("Error exchanging Google OAuth code:", err);
      res
        .status(500)
        .json({
          error: err.message || "Gagal menukarkan Google Authorization Code.",
        });
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
      res
        .status(500)
        .json({
          success: false,
          error: err?.message || "Gagal memeriksa token Google.",
        });
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
      res
        .status(500)
        .json({
          success: false,
          error: err?.message || "Gagal me-refresh token Google.",
        });
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
      const invited = hasApprovalInvitation(sqliteDb, cleanEmail, req.get('x-invitation-token'));
      let existingUser: any = sqliteDb.prepare(`SELECT id, name, role, banned, banReason, banExpires FROM "user" WHERE LOWER(email) = ?`).get(cleanEmail);
      if (!existingUser) {
        const newId = `usr_${crypto.randomUUID()}`;
        sqliteDb.prepare(`
          INSERT INTO "user" (id, name, email, emailVerified, image, role, banned, banReason, createdAt, updatedAt)
          VALUES (?, ?, ?, 1, ?, 'user', ?, ?, ?, ?)
        `).run(newId, userName, cleanEmail, photoURL || null, invited ? 0 : 1, invited ? null : 'PENDING_APPROVAL', now, now);
        existingUser = sqliteDb.prepare('SELECT id, name, role, banned, banReason, banExpires FROM "user" WHERE id = ?').get(newId);
      }
      if (existingUser.banReason === 'PENDING_APPROVAL' && invited) {
        sqliteDb.prepare('UPDATE "user" SET banned = 0, banReason = NULL, banExpires = NULL, updatedAt = ? WHERE id = ?').run(now, existingUser.id);
        existingUser.banned = 0;
        existingUser.banReason = null;
        existingUser.banExpires = null;
      }
      if (isIdentityBanned(existingUser)) {
        const pending = existingUser.banReason === 'PENDING_APPROVAL';
        return res.status(403).json({ success: false, error: pending ? "ACCOUNT_PENDING_APPROVAL" : "ACCOUNT_DISABLED",
          message: pending ? "Your account is waiting for manual superuser approval." : "This account is disabled." });
      }
      // Google verified this address, so the identity's email is verified.
      sqliteDb.prepare(`UPDATE "user" SET image = COALESCE(?, image), emailVerified = 1, updatedAt = ? WHERE id = ?`).run(photoURL || null, now, existingUser.id);
      const userId = existingUser.id;
      const existingAcc: any = sqliteDb.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'google'").get(userId);
      if (!existingAcc) {
        sqliteDb.prepare(`
          INSERT INTO account (id, accountId, providerId, userId, idToken, createdAt, updatedAt, issuer)
          VALUES (?, ?, 'google', ?, ?, ?, ?, 'google')
        `).run(`acc_${crypto.randomUUID()}`, cleanEmail, userId, idToken || null, now, now);
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      sqliteDb.prepare(`
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId, activeOrganizationId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(`sess_${crypto.randomUUID()}`, sessionExpiry, sessionToken, now, now, req.ip || "", String(req.headers["user-agent"] || ""), userId);

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
      console.error("Error in /api/auth/google/sync-session:", err);
      res.status(500).json({
        success: false,
        error: err?.message || "Gagal menyinkronkan sesi Google ke Better Auth.",
      });
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
      saveDb();
      if (token) {
        backupLocalFilesToGoogleDrive(token).catch((e) => {
          console.warn(
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
      res
        .status(500)
        .json({
          success: false,
          error: err?.message || "Gagal menyinkronkan status koneksi Google.",
        });
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
      saveDb();
      res.json({
        success: true,
        isConnected: false,
        message: "Akun Google berhasil diputuskan dari konfigurasi server.",
      });
    } catch (err) {
      res
        .status(500)
        .json({
          success: false,
          error: err?.message || "Gagal memutuskan akun Google di server.",
        });
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
    uiTexts: { overrides: (g.uiTextOverrides || { ID: {}, EN: {}, ZH: {} }) as UITextOverrides },
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
      smtpSecure: Boolean(g.smtpSecure), smtpUser: g.smtpUser || "", smtpFromEmail: g.smtpFromEmail || "",
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
  smtp: ["smtpEnabled", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPassword", "smtpFromEmail", "smtpFromName"],
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
    case "smtp.smtpEnabled": case "smtp.smtpSecure":
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
function applyPlatformConfiguration(section: unknown, values: unknown, actor: ReturnType<typeof auditActorFor>) {
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
    sqliteDb.transaction(() => {
      syncDbToSqlite(db);
      appendAudit(sqliteDb, actor, {
        organizationId: null, action: "platform.configuration.update", targetType: "installation", targetId: "installation",
        outcome: "success", changedFields: Object.keys(next).map((k) => `${section}.${k}`),
      });
    })();
  } catch (err) {
    const restored = JSON.parse(before);
    db.branding = restored.branding;
    db.googleConfig = restored.googleConfig;
    throw err;
  }
  return (readPlatformConfiguration() as any)[section as string];
}
/** Committed organization change: rebuild projections and re-derive policy-dependent state. */
function onOrganizationChanged(organizationId: string) {
  refreshTenantProjection();
  (db.partners || []).forEach((p: any) => {
    if (p.organizationId !== organizationId) return;
    p.daftar_dokumen_dd = normalizePartnerDocuments(p);
    p.status_dd = computeDueDiligenceStatus(p.daftar_dokumen_dd);
  });
  recalculateStatuses();
  saveDb();
}
app.get("/api/google-integration", (_req: express.Request, res: express.Response) => {
  const config = readPlatformConfiguration();
  res.json({ ...config.google, ...config.ai, ...config.smtp });
});
/** Legacy platform write adapter: splits a flat body into strict sections. Tenant fields are rejected. */
app.post("/api/google-integration", async (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
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
    for (const [section, values] of Object.entries(sections)) applyPlatformConfiguration(section, values, auditActorFor(req, identity));
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
  if (!IS_TEST_MODE && db.googleConfig?.driveFolderId && db.googleConfig.driveFolderId !== previousFolder) {
    autoEnsureTenantGoogleResources(db.googleConfig.accessToken, true).catch((e) => console.warn("[Google Integration Save]", e?.message));
  }
  const config = readPlatformConfiguration();
  res.json({ success: true, config: { ...config.google, ...config.ai, ...config.smtp } });
});
app.get('/api/mailer/templates', (_req, res) => res.json({ templates: mailTemplates.list() }));
app.put('/api/mailer/templates/:id', (req, res) => {
  const { subject, html, expectedVersion } = req.body || {};
  const template = sqliteDb.transaction(() => {
    const saved = mailTemplates.save(String(req.params.id), { subject, html }, expectedVersion);
    appendAudit(sqliteDb, auditActorFor(req, resolveIdentity(sqliteDb, req)), {
      organizationId: null, action: 'platform.configuration.update', targetType: 'mail_template', targetId: String(req.params.id),
      outcome: 'success', changedFields: ['subject', 'html'],
    });
    return saved;
  })();
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
      tls: { rejectUnauthorized: false },
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
      ...mailTemplates.render('smtp-test', { host, port: String(port), fromAddress, testedAt: new Date().toISOString() }),
    });
    res.json({
      success: true,
      message: `Email uji coba berhasil dikirim ke '${recipient}'! (Message ID: ${info.messageId})`,
    });
  } catch (err) {
    console.error("SMTP Test Error:", err);
    res
      .status(400)
      .json({
        error: `Gagal mengirim email via SMTP Relay: ${err.message || String(err)}`,
      });
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
        console.warn(
          `[Test API Key] Model ${targetModel} attempt failed:`,
          err?.message || err,
        );
      }
    }
    throw lastErr || new Error("Tidak ada respon dari Gemini API.");
  } catch (err) {
    console.error("Test API Key error:", err);
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
      console.warn(
        "[AutoProvision] Warning auto-ensuring org folders:",
        orgErr?.message,
      );
    }
    saveDb();
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
    console.error("Auto provision master root error:", err);
    return res
      .status(500)
      .json({
        error: err.message || "Gagal membuat Master Root secara otomatis.",
      });
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
    console.error("Auto provision tenant folders error:", err);
    return res
      .status(500)
      .json({
        error:
          err.message ||
          "Gagal menyinkronkan folder organisasi ke Master Root.",
      });
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
    saveDb();
    return res.json({
      success: true,
      message: `4 Subfolder Kategori (Folder Contract, Folder Invoice & Billing, Folder IO, Folder DD) berhasil dibuat/diperbarui untuk ${db.partners.length} partner.`,
      stats,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: err.message || "Gagal membuat folder kategori." });
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
  const identity = resolveIdentity(sqliteDb, req);

  /*
   * Application-wide reset (PRD §2.3, §14.5). Non-demo identities, their
   * credentials and platform roles are kept, but nobody silently gains a
   * membership in the new organization; the acting superuser manages it in
   * platform context. The append-only audit log is never cleared.
   */
  const previousState = { ...db };
  try {
    sqliteDb.transaction(() => {
      // Clear editor data and extraction caches with the same reset.
      for (const table of ["contract_comments", "document_metadata", "contract_drafts", "contract_documents", "metadata_fields", "ai_ocr_cache", "tenants", "departments", "search_records"]) {
        if (sqliteDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
          sqliteDb.prepare(`DELETE FROM "${table}"`).run();
        }
      }
      removeDemoAccounts(sqliteDb, [], identity.userId);
      for (const table of ["invitation", "apikey", "teamMember", "team", "member", "organization_settings", "organization_integrations", "organization"]) {
        sqliteDb.prepare(`DELETE FROM ${table}`).run();
      }
      seedOrganizationsFromDataset(sqliteDb, {
        tenants: dataset.tenants,
        departments: dataset.departments,
        allowedUsers: mode === "demo" && process.env.NODE_ENV !== "production" ? dataset.allowedUsers : [],
      });
      sqliteDb.prepare("UPDATE session SET activeOrganizationId = NULL, activeTeamId = NULL").run();

      // Mutate `db` in place: the auth console holds a reference to this object.
      const provider = db.googleConfig || {};
      Object.assign(db, {
        tenants: [],
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
      refreshTenantProjection();
      migrateLegacyRecords();
      // Organization replacement and its referencing business records must commit together.
      syncDbToSqlite(db);
      appendAudit(sqliteDb, auditActorFor(req, identity), {
        organizationId: null, action: "platform.application.reset", targetType: "installation", targetId: "installation",
        outcome: "success", changedFields: [`mode:${mode}`],
      });
    })();
  } catch (err) {
    Object.assign(db, previousState);
    console.error("Error resetting auth organization tables:", err);
    return res.status(500).json({ error: "Failed to reset organization tables." });
  }

  if (fs.existsSync(uploadsDir)) {
    try {
      for (const item of fs.readdirSync(uploadsDir)) {
        fs.rmSync(path.join(uploadsDir, item), { recursive: true, force: true });
      }
    } catch (e) {
      console.error("Error cleaning uploads during reset:", e);
    }
  }

  recalculateStatuses();
  saveDb();
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
    res
      .status(500)
      .json({ success: false, error: err?.message || String(err) });
  }
});
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
  jenis_dokumen: ["Master Agreement", "Agreement Addendum"],
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
      const name = (row.nama_partner || "").trim();
      if (!name) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom nama_partner wajib diisi.",
        });
        continue;
      }
      const exists = db.partners.find(
        (p) => inTenant(p) && inTenant(p) && p.nama_partner?.toLowerCase() === name.toLowerCase(),
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
          row.pic_internal ||
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
          row.kontak_pic ||
          (row.email_pic || row.telepon_pic
            ? `${(row.email_pic || "").trim()} / ${(row.telepon_pic || "").trim()}`
            : "");
        const newPartner = {
          partner_id: generateNextPartnerId(),
          nama_partner: name,
          codename: partnerChannel,
          partner_channel: partnerChannel,
          pic_internal: internalPic,
          internal_pic: internalPic,
          jenis_partner: row.jenis_partner || "Vendor",
          nama_pic: row.nama_pic || "",
          email_pic: row.email_pic || "",
          telepon_pic: row.telepon_pic || "",
          alamat_pic: row.alamat_pic || "",
          kontak_pic: fullKontakPic,
          organizationId: tenantId,
          country: sanitizeCountryCode(row.country) || (row.badan_hukum === "BHI" ? "ID" : ""),
          entity_type: String(row.entity_type || "").slice(0, 120),
          identifiers: sanitizeIdentifiers(
            bulkSplitList(row.identifiers).map((pair) => {
              const at = pair.indexOf(":");
              return { scheme: at > 0 ? pair.slice(0, at).trim() : "other", value: at > 0 ? pair.slice(at + 1).trim() : pair, country: row.country };
            }),
          ),
          status_dd: "Incomplete",
          catatan: row.catatan || "",
          tags: sanitizePartnerTags(row.tags),
          daftar_dokumen_dd: [],
          created_at: now,
          updated_at: now,
        };
        newPartner.daftar_dokumen_dd = normalizePartnerDocuments(newPartner);
        newPartner.status_dd = computeDueDiligenceStatus(newPartner.daftar_dokumen_dd);
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
          message: err.message || "Gagal membuat partner.",
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
      const nomor = (row.nomor_kontrak || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom nomor_kontrak wajib diisi.",
        });
        continue;
      }
      const exists = db.contracts.find(
        (c) => inTenant(c) && c.nomor_kontrak?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `Kontrak "${nomor}" sudah ada (ID: ${exists.contract_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_nama || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.nama_partner?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      try {
        const kategori = bulkSplitList(row.kategori_kerjasama);
        const jenisDokumen = pickEnum(row.jenis_dokumen, BULK_ENUMS.jenis_dokumen);
        const statusApproval = pickEnum(row.status_approval, BULK_ENUMS.status_approval);
        const noticeType = pickEnum(row.notice_type_required, BULK_NOTICE_TYPES);
        const invalid = jenisDokumen === null ? `jenis_dokumen harus salah satu dari: ${BULK_ENUMS.jenis_dokumen.join(", ")}.`
          : statusApproval === null ? `status_approval harus salah satu dari: ${BULK_ENUMS.status_approval.join(", ")}.`
          : noticeType === null ? `notice_type_required harus salah satu dari: ${BULK_NOTICE_TYPES.join(", ")}.`
          : "";
        if (invalid) {
          failed.push({ rowIndex, identifier: nomor, message: invalid });
          continue;
        }
        const parentNomor = (row.parent_contract_nomor || "").trim();
        const parentContract = parentNomor
          ? db.contracts.find((c) => inTenant(c) && c.nomor_kontrak?.toLowerCase() === parentNomor.toLowerCase())
          : null;
        if (parentNomor && !parentContract) {
          failed.push({ rowIndex, identifier: nomor, message: `Kontrak induk "${parentNomor}" tidak ditemukan. Impor kontrak induk lebih dulu.` });
          continue;
        }
        let contractPic = (row.pic_internal || row.internal_pic || "").trim();
        if (forceDept) {
          contractPic = defDept;
        } else if (!contractPic && defDept) {
          contractPic = defDept;
        } else if (!contractPic && partner?.pic_internal) {
          contractPic = partner.pic_internal;
        }
        if (contractPic && !scopeOf(req).teamOf(contractPic)) {
          failed.push({ rowIndex, identifier: nomor, message: `Department "${contractPic}" does not exist in this organization.` });
          continue;
        }
        const newContract = {
          contract_id: generateNextContractId(),
          organizationId: tenantId,
          nomor_kontrak: nomor,
          judul_kontrak: row.judul_kontrak || nomor,
          partner_id: partner.partner_id,
          jenis_dokumen: jenisDokumen || "Master Agreement",
          ...(parentContract ? { parent_contract_id: parentContract.contract_id, parent_contract_nomor: parentContract.nomor_kontrak } : {}),
          kategori_kerjasama: kategori,
          tanggal_mulai: row.tanggal_mulai || "",
          tanggal_berakhir: row.tanggal_berakhir || "",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          nilai_kontrak: bulkNumber(row.nilai_kontrak),
          auto_renewal: bulkBool(row.auto_renewal),
          notice_period_hari: parseInt(row.notice_period_hari) || 30,
          notice_type_required: noticeType || "Both",
          pic_internal: contractPic,
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
          message: err.message || "Gagal membuat kontrak.",
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
      const nomor = (row.nomor_io || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom nomor_io wajib diisi.",
        });
        continue;
      }
      const exists = db.ios.find(
        (io) => inTenant(io) && io.nomor_io?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `IO "${nomor}" sudah ada (ID: ${exists.io_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_nama || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.nama_partner?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      const contractNomor = (row.contract_nomor || "").trim();
      const contract = db.contracts.find(
        (c) => inTenant(c) && c.nomor_kontrak?.toLowerCase() === contractNomor.toLowerCase(),
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
          nomor_io: nomor,
          judul_io: row.judul_io || nomor,
          partner_id: partner.partner_id,
          contract_id: contract?.contract_id || "",
          kanal_media: row.kanal_media || "",
          tanggal_mulai: row.tanggal_mulai || "",
          tanggal_berakhir: row.tanggal_berakhir || "",
          // Standard models are normalised ("cpm" -> "CPM"); anything else is kept as a custom model.
          pricing_model: pickEnum(row.pricing_model, BULK_PRICING_MODELS) || String(row.pricing_model || "").trim() || "Fixed",
          charging_type: chargingType || "Prepaid",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          nilai_io: bulkNumber(row.nilai_io),
          deliverables: row.deliverables || "",
          notice_period_hari: parseInt(row.notice_period_hari) || 14,
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
        (p) => inTenant(p) && p.nama_partner?.toLowerCase() === supplierName.toLowerCase(),
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
          message: err.message || "Gagal membuat evaluasi.",
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
        (p) => inTenant(p) && p.nama_partner?.toLowerCase() === vendorName.toLowerCase(),
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
          message: err.message || "Gagal membuat spending.",
        });
      }
    }
  } else {
    return res
      .status(400)
      .json({ error: `Tipe import tidak dikenal: ${type}` });
  }
  recalculateStatuses(); // once per import: it saves the whole database
  const totalSucceeded = succeeded.length;
  if (totalSucceeded > 0) {
    addActivityLog(
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
app.get("/api/tenants", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  const accessible = accessibleOrganizations(sqliteDb, identity);
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
app.post("/api/tenants/switch", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId : req.body?.organizationId;
  try {
    const result = selectActiveOrganization(sqliteDb, identity, Object.assign(Object.create(req), { body: { organizationId: tenantId } }));
    return res.json({ success: true, activeTenantId: result.organizationId });
  } catch (err: any) {
    if (err instanceof RequestDenied || err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.post("/api/tenants", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return sendError(req, res, 400, "INVALID_INPUT", "Organization name is required (1–200 characters).");
  try {
    const id = sqliteDb.transaction(() => {
      const orgId = createOrganizationRecord(sqliteDb, {
        name,
        slug: typeof body.domainSlug === "string" ? body.domainSlug : undefined,
        legalEntity: typeof body.legalEntity === "string" ? body.legalEntity.slice(0, 200) : "",
        brandName: typeof body.brandName === "string" ? body.brandName.slice(0, 200) : name,
        tagline: typeof body.tagline === "string" ? body.tagline.slice(0, 500) : "",
        primaryColor: typeof body.primaryColor === "string" ? body.primaryColor : undefined,
        settings: { countryCode: body.countryCode || body.settings?.countryCode, industry: body.industry || body.settings?.industry, defaultCurrency: body.currency },
      }, identity.userId);
      appendAudit(sqliteDb, auditActorFor(req, identity), {
        organizationId: orgId, action: "organization.create", targetType: "organization", targetId: orgId, outcome: "success", changedFields: ["name"],
      });
      return orgId;
    })();
    refreshTenantProjection();
    return res.status(201).json({ success: true, newTenant: findTenant(id), tenants: db.tenants });
  } catch (err: any) {
    return sendError(req, res, 400, "INVALID_INPUT", err?.message);
  }
});
app.put("/api/tenants/:id", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  try {
    const current = readOrganizationSettings(sqliteDb, req.params.id);
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
      if (sqliteDb.prepare("SELECT 1 FROM organization WHERE slug = ? AND id <> ?").get(slug, req.params.id)) return sendError(req, res, 409, "SLUG_EXISTS");
      sqliteDb.prepare("UPDATE organization SET slug = ? WHERE id = ?").run(slug, req.params.id);
    }
    if (patch.name !== undefined || patch.profile || patch.policy) {
      patchOrganizationSettings(sqliteDb, req.params.id, patch, auditActorFor(req, identity));
    }
    onOrganizationChanged(req.params.id);
    return res.json({ success: true, tenants: db.tenants });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.delete("/api/tenants/:id", (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
  const id = req.params.id;
  if (!findTenant(id)) return sendError(req, res, 404, "RESOURCE_NOT_FOUND");
  // Deleting an organization never cascades into business data (PRD §9.4).
  const owned = ["partners", "contracts", "ios", "spendings", "evaluations", "notifications", "templates"]
    .some((key) => (db[key] || []).some((row: any) => row?.organizationId === id));
  if (owned) return sendError(req, res, 409, "ORGANIZATION_IN_USE", "Move or remove this organization's records first.");
  sqliteDb.transaction(() => {
    sqliteDb.prepare("DELETE FROM teamMember WHERE teamId IN (SELECT id FROM team WHERE organizationId = ?)").run(id);
    for (const table of ["member", "team", "invitation", "organization_settings", "organization_integrations"]) {
      sqliteDb.prepare(`DELETE FROM ${table} WHERE organizationId = ?`).run(id);
    }
    sqliteDb.prepare("UPDATE session SET activeOrganizationId = NULL WHERE activeOrganizationId = ?").run(id);
    sqliteDb.prepare("DELETE FROM organization WHERE id = ?").run(id);
    appendAudit(sqliteDb, auditActorFor(req, identity), {
      organizationId: id, action: "organization.delete", targetType: "organization", targetId: id, outcome: "success", changedFields: [],
    });
  })();
  refreshTenantProjection();
  return res.json({ success: true, tenants: db.tenants });
});
/** Legacy Integrations write: validated folder AND sheet mapping through the canonical store. */
app.post("/api/tenants/:id/setup-google", (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const identity = resolveIdentity(sqliteDb, req);
  const current = readIntegration(sqliteDb, ctx.organizationId);
  const body: any = { expectedVersion: typeof req.body?.expectedVersion === "number" ? req.body.expectedVersion : current.version };
  if (req.body?.driveFolderId !== undefined) body.driveFolderId = req.body.driveFolderId || null;
  if (req.body?.spreadsheetId !== undefined) body.spreadsheetId = req.body.spreadsheetId || null;
  try {
    patchIntegration(sqliteDb, ctx.organizationId, body, auditActorFor(req, identity, ctx));
    onOrganizationChanged(ctx.organizationId);
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
app.post("/api/branding", (req: express.Request, res: express.Response) => {
  try {
    const branding = applyPlatformConfiguration("branding", req.body, auditActorFor(req, resolveIdentity(sqliteDb, req)));
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
  if (!ensureAiAvailable(req, res)) return;
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
    const partnerNameOf = (id: string) => db.partners.find((p) => p.partner_id === id && p.organizationId === tenantId)?.nama_partner || "";
    /*
     * Privacy by design (PRD §3.4.1, §5.1): only the active tenant's records
     * are sent, and direct identifiers — phone numbers, e-mail addresses,
     * postal addresses, identity/tax numbers and bank account numbers — are
     * stripped or masked before anything leaves this server.
     */
    const dbContext = {
      organization: { name: ctx.organizationName, country: ctx.countryName, industry: ctx.industryName },
      partners: readBusinessRows(sqliteDb, 'partners', tenantId).filter(visibleTo("partner")).map((p: any) => ({
        partner_id: p.partner_id || p.id,
        name: p.nama_partner,
        codename: p.codename || p.partner_channel || "",
        type: p.jenis_partner || "Vendor",
        country: p.country || "",
        entity_type: p.entity_type || "",
        dd_status: p.status_dd,
        dd_verified_at: p.tanggal_dd_diverifikasi || "",
        internal_owner: p.pic_internal || p.internal_pic || "",
        contact_name: p.nama_pic || "",
        categories: p.tags || [],
        internal_notes: p.catatan || p.internal_notes || p.notes || "",
        dd_documents: Array.isArray(p.daftar_dokumen_dd)
          ? p.daftar_dokumen_dd.map((d: any) => ({
              name: d.nama,
              status: d.status,
              required: d.wajib,
              expires_at: d.tanggalKadaluarsa || "",
            }))
          : [],
      })),
      contracts: readBusinessRows(sqliteDb, 'contracts', tenantId).filter(visibleTo("contract")).map((c: any) => ({
        contract_id: c.contract_id || c.id,
        reference: c.nomor_kontrak,
        title: c.judul_kontrak,
        counterparty: partnerNameOf(c.partner_id),
        partner_id: c.partner_id || "",
        document_type: c.jenis_dokumen || "Master Agreement",
        parent_reference: c.parent_contract_nomor || c.parent_nomor || "",
        categories: c.kategori_kerjasama || [],
        start_date: c.tanggal_mulai,
        end_date: c.tanggal_berakhir,
        currency: c.currency,
        value: c.nilai_kontrak || 0,
        value_usd: c.nilai_kontrak_usd || 0,
        auto_renewal: Boolean(c.auto_renewal),
        notice_period_days: c.notice_period_hari || c.notice_period_days || 30,
        notice_type: c.notice_type_required || "Termination",
        status: c.status,
        approval_status: c.status_approval,
        internal_owner: c.pic_internal || "",
        internal_notes: c.internal_notes || c.notes || c.catatan || "",
        change_summary: c.ringkasan_perubahan || "",
        changed_fields: c.field_yang_berubah || [],
        days_remaining: c.sisa_hari,
      })),
      commercial_documents: readBusinessRows(sqliteDb, 'insertion_orders', tenantId).filter(visibleTo("io")).map((i: any) => {
        const endDateStr = i.tanggal_berakhir || i.tanggal_selesai || i.period_end || "";
        const lifecycle = computeLifecycle(i.organizationId, endDateStr, i.status);
        return {
          id: i.io_id || i.id,
          reference: i.nomor_io,
          title: i.judul_io,
          counterparty: partnerNameOf(i.partner_id),
          partner_id: i.partner_id || "",
          contract_reference: i.contract_nomor || "",
          scope: i.kanal_media || i.channel || "",
          start_date: i.tanggal_mulai || i.period_start || "",
          end_date: endDateStr,
          pricing_model: i.pricing_model || "",
          charging_type: i.charging_type || "",
          payment_scheme: i.skema_pembayaran || i.model_pembayaran || "",
          currency: i.currency,
          value: i.nilai_io || i.total_nominal || 0,
          value_usd: i.nilai_io_usd || 0,
          deliverables: i.deliverables || "",
          notice_period_days: i.notice_period_hari || i.notice_period_days || 14,
          status: lifecycle.status,
          internal_notes: i.internal_notes || i.notes || i.catatan || "",
          days_remaining: lifecycle.daysRemaining,
        };
      }),
      spendings_and_invoices: readBusinessRows(sqliteDb, 'spendings', tenantId).filter(visibleTo("spending")).map((s: any) => ({
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
      evaluations: readBusinessRows(sqliteDb, 'evaluations', tenantId).filter(visibleTo("evaluation")).map((e: any) => ({
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
        internal_notes: e.notes || e.catatan || "",
      })),
    };
    const moduleNote = settings.modules.commercialDocuments
      ? `"commercial_documents" are ${ctx.commercialDocumentLabel}s issued under master agreements.`
      : "";
    const systemInstruction = `You are a context-aware legal, commercial and business assistant embedded in the Legalio contract lifecycle management workspace of ${ctx.organizationName}.
Answer strictly from the workspace JSON below and the ongoing conversation. ${moduleNote}
Contact details, identity/tax numbers and full bank account numbers are intentionally withheld for privacy; if asked for them, say they are not available to the assistant.

Workspace JSON:
${JSON.stringify(dbContext, null, 2)}

Guidelines:
1. When asked about notes, remarks or summaries, check every "internal_notes" field.
2. Keep conversational context; resolve follow-up references ("that contract", "its notes") to previously discussed items.
3. Be concise, direct, professional and accurate. Compute sums, counts and currency breakdowns strictly from the JSON and state the currency of every amount.
4. If a record or note is missing, say so clearly.
5. Never answer with Markdown tables (the chat widget is narrow). Use bullet lists with bold entity names and indented sub-bullets instead.
6. Answer in ${ctx.responseLanguage} unless the user writes in, or asks for, another language.`;
    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        if (msg && typeof msg.text === "string" && msg.text.trim()) {
          const role =
            msg.role === "ai" || msg.role === "model" ? "model" : "user";
          contents.push({ role, parts: [{ text: msg.text.trim() }] });
        }
      }
    }
    if (query && typeof query === "string" && query.trim()) {
      const lastMsg = contents[contents.length - 1];
      if (
        !lastMsg ||
        lastMsg.role !== "user" ||
        lastMsg.parts[0]?.text !== query.trim()
      ) {
        contents.push({ role: "user", parts: [{ text: query.trim() }] });
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
    console.error("AI Chat Error:", error);
    res
      .status(500)
      .json({ error: error?.message || "Failed to process AI request" });
  }
});
/* ------------------------------------------------------------------ */
/* Health, first-run status, policy packs and tenant settings          */
/* ------------------------------------------------------------------ */
app.get("/api/health", (_req: express.Request, res: express.Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/** True while an install upgraded from an older release still uses the old shipped admin password. */
async function isBootstrapPasswordActive(): Promise<boolean> {
  try {
    const row: any = sqliteDb.prepare(`
      SELECT password FROM account WHERE userId = 'demo-admin' AND providerId = 'credential' LIMIT 1
    `).get();
    if (!row?.password) return false;
    return await verifyPassword({ hash: row.password, password: LEGACY_DEFAULT_ADMIN_PASSWORD });
  } catch {
    return false;
  }
}

/** A fresh install has no Superuser until someone completes the first-run setup page. */
const needsFirstRunSetup = () => !sqliteDb.prepare(`SELECT 1 FROM "user" WHERE role = 'superuser' LIMIT 1`).get();

// Unauthenticated: tells the sign-in page whether to show the first-run setup form instead.
app.get("/api/system/public-status", (_req: express.Request, res: express.Response) => {
  res.set('Cache-Control', 'no-store').json({
    appName: db.branding?.appName || DEFAULT_BRANDING.appName,
    needsSetup: !migrationBlock && needsFirstRunSetup(),
    publicUrl: getPublicBaseUrl(),
    migrationRequired: Boolean(migrationBlock),
  });
});

// Unauthenticated, and only usable while no Superuser exists: creates the first admin.
app.post("/api/system/setup", async (req: express.Request, res: express.Response) => {
  if (!needsFirstRunSetup()) {
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
  const hashed = await hashPassword(password);
  const id = `usr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    // Re-checked inside the transaction: hashing above yields, so a second request could have won.
    const created = sqliteDb.transaction(() => {
      if (!needsFirstRunSetup()) return false;
      if (sqliteDb.prepare(`SELECT 1 FROM user WHERE LOWER(email) = ?`).get(email)) {
        throw Object.assign(new Error("That email is already used by another account."), { status: 409 });
      }
      sqliteDb.prepare(`
        INSERT INTO user (id, name, email, emailVerified, role, banned, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, 'superuser', 0, ?, ?)
      `).run(id, name, email, now, now);
      sqliteDb.prepare(`
        INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer)
        VALUES (?, ?, 'credential', ?, ?, ?, ?, 'local:credential')
      `).run(`acc_${id}`, id, id, hashed, now, now);
      saveInstallationPublicUrl(sqliteDb, publicUrl);
      return true;
    }).immediate(); // write lock before the check: concurrent setups cannot both pass
    if (!created) {
      return res.status(409).json({ error: "ALREADY_SET_UP", message: "An administrator already exists. Please sign in." });
    }
  } catch (err: any) {
    return res.status(err?.status || 500).json({ error: "SETUP_FAILED", message: err?.message || "Setup failed." });
  }
  reloadAuthConfiguration();
  appendAudit(sqliteDb, { actorId: id, actorPlatformRole: "superuser", accessMode: "platform", requestId: String((req as any).requestId || crypto.randomUUID()) }, {
    organizationId: null, action: "platform.setup", targetType: "installation", targetId: "installation", outcome: "success", changedFields: ["superuser", "publicUrl"],
  });
  // Outside production the demo-workspace logins stay usable with the same password.
  if (!IS_TEST_MODE) await ensureUserAccountsExist(password);
  console.log(`First-run setup: created superuser ${email}`);
  res.status(201).json({ success: true, publicUrl });
});

app.get("/api/system/status", async (req: express.Request, res: express.Response) => {
  const identity = resolveIdentity(sqliteDb, req);
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
app.put("/api/tenant-settings", (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  for (const key of Object.keys(body)) {
    if (!["settings", "legalEntity", "expectedVersion", "organizationId"].includes(key)) {
      return sendError(req, res, 400, "INVALID_INPUT", `Unknown field: ${key}`);
    }
  }
  try {
    const current = readOrganizationSettings(sqliteDb, ctx.organizationId);
    const patch: any = { expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : current.version };
    if (body.settings !== undefined) patch.policy = body.settings;
    if (typeof body.legalEntity === "string") patch.profile = { legalEntity: body.legalEntity };
    patchOrganizationSettings(sqliteDb, ctx.organizationId, patch, auditActorFor(req, resolveIdentity(sqliteDb, req), ctx));
    onOrganizationChanged(ctx.organizationId);
    res.json({ success: true, ...tenantSettingsPayload(ctx.organizationId) });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});

/* Canonical tenant administration API (PRD §9). */
app.use("/api", createOrganizationAdminRouter({
  db: sqliteDb,
  policyView: (organizationId: string) => tenantSettingsPayload(organizationId),
  providerConfigured: () => hasServiceAccountCredentials() || Boolean(db.googleConfig?.accessToken || db.googleConfig?.refreshToken),
  onOrganizationChanged,
  departmentReferenced: (organizationId: string, department: { id: string; name: string }) => {
    const key = normalizeDepartmentName(department.name);
    return ["partners", "contracts"].some((collection) => (db[collection] || []).some((row: any) =>
      row?.organizationId === organizationId && normalizeDepartmentName(row.pic_internal || row.internal_pic) === key));
  },
  inviteUrl: (req: express.Request, token: string) => {
    const base = getPublicBaseUrl() || `${req.protocol}://${req.get("host")}`;
    return `${base}/app?accept_invite=${encodeURIComponent(token)}`;
  },
  sendInvitation: async ({ email, organizationName, tenantRole, inviteUrl, expiresAt, inviterName }) => {
    if (IS_TEST_MODE) return false;
    return sendPlatformMail({
      to: email,
      ...mailTemplates.render('invitation', { organizationName, tenantRole, inviteUrl, expiresAt: String(expiresAt).slice(0, 10), inviterName: inviterName || 'An administrator' }),
    });
  },
  platformConfiguration: {
    read: readPlatformConfiguration,
    patch: (section: string, values: unknown, actor) => applyPlatformConfiguration(section, values, actor),
  },
}));

app.use("/api/auth-console/backups", createSQLiteBackupRouter(sqliteDb, sqliteBackups));
app.use("/api/auth-console", authConsoleRouter);
app.all("/api/*", (req: express.Request, res: express.Response) => {
  res
    .status(404)
    .json({ error: `API route not found: ${req.method} ${req.path}` });
});
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[API Unhandled Error]", err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith("/api/")) {
    return res
      .status(err.status || 500)
      .json({
        error: err.message || "Terjadi kesalahan internal server.",
        status: err.status || 500,
      });
  }
  next(err);
});
async function startServer() {
  mountSystemConsole(app, process.env.SYSTEM_CONSOLE_DIR || path.join(REPOSITORY_DIR, "apps/backend/dist/console"));
  let viteServer;
  // API_ONLY=true (set by `npm run dev:backend`) skips Vite entirely, for
  // running the backend as its own process against a separate `npm run
  // dev:frontend` — the default `npm run dev` still runs both combined.
  if (process.env.NODE_ENV !== "production" && process.env.API_ONLY !== "true") {
    // Dynamically imported so `vite` never ends up in the production
    // server bundle — the backend is a standalone API in production, the
    // frontend build is served separately (see README).
    const { createServer: createViteServer } = await import("vite");
    viteServer = await createViteServer({
      root: path.join(REPOSITORY_DIR, "apps/frontend"),
      configFile: path.join(REPOSITORY_DIR, "apps/frontend/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(viteServer.middlewares);
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Pengelola Kontrak & IO Server running on http://0.0.0.0:${PORT}`,
    );
  });
  const shutdown = __name(async () => {
    console.log("Shutting down server...");
    if (viteServer) {
      await viteServer.close();
    }
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forcing shutdown after 3s");
      process.exit(1);
    }, 3e3).unref();
  }, "shutdown");
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
startServer();
export { getFreshGoogleAccessToken, isMatchingOrg, resolveActiveGoogleToken };
