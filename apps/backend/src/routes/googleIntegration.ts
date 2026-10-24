import { partnerRepository } from '../repositories/partnerRepository';
import { checkIsAdmin } from '../adminCheck';
import { backupLocalFilesToGoogleDrive } from '../driveBackup';
import { getRequestTenantId, orgContextOf } from '../recordAccess';
import { resolveActiveGoogleToken, autoEnsureTenantGoogleResources, ensureAllPartnersFolders } from '../googleDrive';
import { hasServiceAccountCredentials, loadServiceAccountCredentials, getGoogleSheetsClient } from '../lib/googleServiceAccountAuth';
import { createDriveFolder, extractFolderIdFromLink, createSpreadsheetInFolder } from '../lib/googleDriveSync';
import { db, saveDb } from '../memoryDb';
import { sendRouteError } from '../apiErrors';
import { identityOf, sendError } from '../identity';
import { readIntegration, patchIntegration, ApiError } from '../organizationSettingsStore';
import { sql } from '../db';
import { auditActorFor } from '../organizationAdminRoutes';
import { onOrganizationChanged } from '../platformSettings';
import { findTenant } from '../tenantPolicy';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('googleIntegration');
const __name = <T>(target: T, value: string): T => Object.defineProperty(target, "name", { value, configurable: true });

export function createGoogleIntegrationRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.post("/api/google-integration/backup", async (req: express.Request, res: express.Response) => {
  if (!(await checkIsAdmin(req)).isAdmin) {
    return res.status(403).json({ error: "Forbidden: only administrators can run the Google Drive backup." });
  }
  res.json({ success: true, ...(await backupLocalFilesToGoogleDrive(req.headers["x-google-access-token"] as string | undefined)) });
});
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
      message: `4 Subfolder Kategori (Folder Contract, Folder Invoice & Billing, Folder IO, Folder DD) berhasil dibuat/diperbarui untuk ${await partnerRepository.count()} partner.`,
      stats,
    });
  } catch (err) {
    return sendRouteError(req, res, err, "request failed", "Gagal membuat folder kategori.", { status: 500 });
  }
}, "provisionFoldersHandler");
app.post("/api/google-integration/provision-folders", provisionFoldersHandler);
app.post("/api/partners/provision-folders", provisionFoldersHandler);
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
  return app;
}
