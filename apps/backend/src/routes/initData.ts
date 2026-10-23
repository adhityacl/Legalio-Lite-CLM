import { refreshContractLifecycles } from '../reminderJobs';
import { getRequestTenantId, scopedRecords } from '../recordAccess';
import { getTenantSettings } from '../tenantPolicy';
import { db } from '../memoryDb';
import { getEffectiveGeminiApiKey } from '../aiClient';
import { sanitizeParentFolderId } from '../lib/googleDriveSync';
import { hasServiceAccountCredentials } from '../lib/googleServiceAccountAuth';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createInitDataRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

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
  return app;
}
