import { refreshContractLifecycles } from '../reminderJobs';
import { getRequestTenantId, scopedRecords } from '../recordAccess';
import { getTenantSettings } from '../tenantPolicy';
import { aiProviderAvailable } from '../aiClient';
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
    contracts: await scopedRecords(req, "contract"),
    ios: await scopedRecords(req, "io"),
    partners: await scopedRecords(req, "partner"),
    notifications: await scopedRecords(req, "notification"),
    evaluations: await scopedRecords(req, "evaluation"),
    spendings: await scopedRecords(req, "spending"),
    services: {
      aiAvailable: aiProviderAvailable() && settings.modules.aiAssistant,
    },
    timestamp: Date.now(),
  });
});
  return app;
}
