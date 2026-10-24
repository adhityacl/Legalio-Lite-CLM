import { partnerRepository } from './repositories/partnerRepository';
import { readIntegration, writeIntegrationRow } from './organizationSettingsStore';
import { sql } from './db';
import { refreshTenantProjection, db, saveDb } from './memoryDb';
import { sanitizeParentFolderId, getOrCreateDriveFolder, createNewDriveFolderInParent, extractFolderIdFromLink, setInvalidTokenCallback, setRefreshTokenGetter } from './lib/googleDriveSync';
import { findTenant } from './tenantPolicy';
import { IS_TEST_MODE } from './runtimePaths';
import { hasServiceAccountCredentials } from './lib/googleServiceAccountAuth';
import { backupLocalFilesToGoogleDrive } from './driveBackup';
import { googleCredentials } from './googleCredentialStore';
import { OAuth2Client } from 'google-auth-library';
import { componentLog } from './logger';
const log = componentLog('googleDrive');

/** Google access tokens and the Drive folder hierarchy (organization root, partner folder, category folders). */


/** Persists a platform-provisioned folder mapping through the canonical integration store. */
export async function persistTenantFolder(tenantId: string, folderId: string) {
  try {
    const current = await readIntegration(sql, tenantId);
    const claimed = await sql.get('SELECT 1 FROM organization_integrations WHERE "driveFolderId" = ? AND "organizationId" <> ?', folderId, tenantId);
    if (claimed) return;
    await writeIntegrationRow(sql, { ...current, driveFolderId: folderId, version: current.version + 1 }, null);
    await refreshTenantProjection();
  } catch (err: any) {
    log.warn(`[Drive] Could not record folder mapping for ${tenantId}:`, err?.message);
  }
}
export async function getOrgFolderId(tenantInput, token) {
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
      await persistTenantFolder(tenant.id, orgFolder.id);
      return orgFolder;
    }
  } catch (err) {
    log.warn(
      `[Drive Hierarchical] Error creating org folder '${orgFolderName}':`,
      err?.message || err,
    );
  }
  return { id: "" };
}
/** Platform-only provisioning of every organization's Drive folder (explicit service authority). */
export async function autoEnsureTenantGoogleResources(token, forceNew = false) {
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
          log.warn(`[AutoProvision] createNewDriveFolderInParent failed, falling back to getOrCreateDriveFolder:`, createErr?.message);
        }
      }
      if (!orgFolder || !orgFolder.id) {
        orgFolder = await getOrCreateDriveFolder(orgFolderName, masterRootId, activeToken);
      }
      if (orgFolder && orgFolder.id && orgFolder.id !== masterRootId) {
        await persistTenantFolder(tenant.id, orgFolder.id);
        updatedCount++;
      }
    } catch (err) {
      log.warn(`[AutoProvision] Failed to create folder for tenant '${tenant.name}':`, err?.message || err);
    }
  }
  return { success: true, updatedCount };
}
export async function getPartnerFolderId(partner, token, orgId) {
  if (!partner) {
    const orgFolder2 = await getOrgFolderId(orgId, token);
    return orgFolder2.id || db.googleConfig.driveFolderId;
  }
  const targetOrgId = orgId || partner.organizationId;
  const orgFolder = await getOrgFolderId(targetOrgId, token);
  const parentFolderId = orgFolder.id || db.googleConfig.driveFolderId;
  const extractedId = extractFolderIdFromLink(partner.dd_folder_link);
  if (extractedId) {
    return extractedId;
  }
  const activeToken = await resolveActiveGoogleToken(token);
  if (activeToken || hasServiceAccountCredentials()) {
    try {
      const folderRes = await getOrCreateDriveFolder(
        partner.partner_name,
        parentFolderId,
        activeToken,
      );
      partner.dd_folder_link = folderRes.webViewLink;
      // A link nobody edits by hand: stored without a new version, under the row lock, so open editors are not invalidated.
      if (partner.partner_id && targetOrgId) {
        await partnerRepository.mutate(targetOrgId, partner.partner_id, (row) => { row.dd_folder_link = folderRes.webViewLink; }, { bumpVersion: false });
      }
      return folderRes.id;
    } catch (err) {
      log.warn(
        `[Drive Hierarchical] Failed creating partner folder for '${partner.partner_name}':`,
        err,
      );
    }
  }
  return parentFolderId;
}
export async function getPartnerCategoryFolderId(partner: any, category: string, token?: string, orgId?: string) {
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
    log.error(`Error getting/creating category folder '${category}':`, err);
    return vendorFolderId;
  }
}
export async function ensureAllPartnersFolders(token?: string, targetTenantId?: string) {
  let driveFoldersCreated = 0;
  const activeToken = await resolveActiveGoogleToken(token);
  for await (const batch of partnerRepository.batches(500, targetTenantId ? "organization_id = ?" : "TRUE", targetTenantId ? [targetTenantId] : []))
  for (const partner of batch) {
    if (!partner.partner_name) continue;
    const orgId = partner.organizationId;
    const tenant = findTenant(orgId);
    if (!tenant) continue; // unowned records are quarantined, never filed under another tenant
    const cleanOrg = (tenant?.name || "Organization")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim();
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
        log.error(
          `Error provisioning Drive folders for partner ${partner.partner_name} (${cleanOrg}):`,
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
  return { driveFoldersCreated };
}
setInvalidTokenCallback((badToken) => {
  if (db.googleConfig && db.googleConfig.accessToken === badToken) {
    log.warn(
      "[Server] Membersihkan Google accessToken yang kedaluwarsa dari database.",
    );
    db.googleConfig.accessToken = "";
    saveDb().catch((err) => log.error("[Server] Could not save the cleared Google token:", err));
  }
});
export async function getFreshGoogleAccessToken() {
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
      await saveDb();
      log.info(
        "[Google Auth] Access Token berhasil di-refresh otomatis menggunakan Refresh Token.",
      );
    }
    return freshToken || currentToken || null;
  } catch (err) {
    log.error(
      "[Google Auth] Gagal me-refresh Google Access Token:",
      err.message || err,
    );
    if (err?.message?.includes("invalid_grant")) {
      log.warn(
        "[Google Auth] Refresh token tidak lagi valid (invalid_grant). Menghapus kredensial.",
      );
      db.googleConfig.refreshToken = "";
      db.googleConfig.accessToken = "";
      await saveDb();
      return null;
    }
    return currentToken || null;
  }
}
setRefreshTokenGetter(async () => {
  return await getFreshGoogleAccessToken();
});
export async function resolveActiveGoogleToken(reqToken) {
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
