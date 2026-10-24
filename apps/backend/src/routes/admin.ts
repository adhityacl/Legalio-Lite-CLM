import crypto from 'crypto';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { resolveTenantSettings } from '@legalio/shared/policy';
import { DEFAULT_BRANDING, coreSaver, db, migrateLegacyRecords, normalizeContractRecord, normalizeIoRecord, normalizePartnerRecord, normalizeSpendingRecord, saveDb } from '../memoryDb';
import { clearRepositoryRows, insertRepositoryRows } from '../repositories/seed';
import { identityOf } from '../identity';
import { sql } from '../db';
import { removeDemoAccounts } from '../demoAccounts';
import { seedOrganizationsFromDataset } from '../organizationProvisioning';
import { buildTenantProjection, appendAudit } from '../organizationSettingsStore';
import { resetSyncCache } from '../normalizedCoreStore';
import { saveCoreData } from '../lib/auth';
import { auditActorFor } from '../organizationAdminRoutes';
import { getStore } from '../uploadStorage';
import { recalculateStatuses } from '../reminderJobs';
import { IS_TEST_MODE } from '../runtimePaths';
import { ensureUserAccountsExist } from '../authConsoleRoutes';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('admin');

export function createAdminRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

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
        dataset.contracts.forEach(normalizeContractRecord);
        dataset.partners.forEach(normalizePartnerRecord);
        dataset.ios.forEach(normalizeIoRecord);
        dataset.spendings.forEach(normalizeSpendingRecord);
        snapshot = coreSaver.snapshot();
        nextState = { ...db };
      } finally {
        Object.assign(db, liveState);
      }
      // search_records was emptied above, so no fingerprint may skip a row; the replacement and its business records commit together.
      resetSyncCache(sql);
      await saveCoreData(snapshot);
      // Contracts are repository-backed: the snapshot sync neither removes the old ones nor writes the dataset's. Reverse order
      // keeps the dataset's order (each insert goes to the front).
      await clearRepositoryRows(sql);
      await insertRepositoryRows(sql, dataset);
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
  return app;
}
