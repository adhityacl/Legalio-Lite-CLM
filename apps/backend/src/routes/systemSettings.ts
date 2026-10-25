import { checkIsAdmin } from '../adminCheck';
import nodemailer from 'nodemailer';
import { readPlatformConfiguration, PLATFORM_SECTIONS, isMaskedSecret, applyPlatformConfiguration, onOrganizationChanged } from '../platformSettings';
import { identityOf, sendError } from '../identity';
import { db, DEFAULT_BRANDING } from '../memoryDb';
import { auditActorFor } from '../organizationAdminRoutes';
import { ApiError, appendAudit, readOrganizationSettings, patchOrganizationSettings } from '../organizationSettingsStore';
import { IS_TEST_MODE } from '../runtimePaths';
import { mailTemplates } from '../mailHelpers';
import { sql } from '../db';
import { smtpTlsOptions } from '../smtpTls';
import { sendApiError } from '../apiErrors';
import { tenantSettingsPayload } from '../tenantSettingsView';
import { getRequestTenantId, orgContextOf } from '../recordAccess';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('systemSettings');

export function createSystemSettingsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.get('/api/system/ui-texts', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(readPlatformConfiguration().uiTexts);
});
app.get("/api/platform-settings", (_req: express.Request, res: express.Response) => {
  const config = readPlatformConfiguration();
  res.json({ ...config.ai, ...config.smtp });
});
/** Legacy platform write adapter: splits a flat body into strict sections. Tenant fields are rejected. */
app.post("/api/platform-settings", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sections: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(body)) {
    const section = Object.keys(PLATFORM_SECTIONS).find((name) => name !== "branding" && PLATFORM_SECTIONS[name].includes(key));
    if (!section) return sendError(req, res, 400, "INVALID_INPUT", `Unknown or tenant-owned field: ${key}`);
    if ((key === "geminiApiKey" || key === "smtpPassword") && (value === "" || isMaskedSecret(value))) continue;
    (sections[section] ||= {})[key] = value;
  }
  try {
    for (const [section, values] of Object.entries(sections)) await applyPlatformConfiguration(section, values, auditActorFor(req, identity));
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
  const config = readPlatformConfiguration();
  res.json({ success: true, config: { ...config.ai, ...config.smtp } });
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
  return app;
}
