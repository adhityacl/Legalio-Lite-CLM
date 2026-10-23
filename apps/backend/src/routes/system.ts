import { LEGACY_DEFAULT_ADMIN_PASSWORD } from '../demoAdmin';
import { db, DEFAULT_BRANDING } from '../memoryDb';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { getExchangeRates, getUsdRate } from '@legalio/shared/currencyRates';
import { sendRouteError, sendApiError } from '../apiErrors';
import { sql } from '../db';
import { verifyPassword, hashPassword } from 'better-auth/crypto';
import { getPublicBaseUrl, normalizePublicUrl, saveInstallationPublicUrl } from '../installationSettings';
import { IS_TEST_MODE } from '../runtimePaths';
import { checkCosInput } from '../googleCredentials';
import { CosConfig } from '../objectStore';
import { googleCredentials } from '../googleCredentialStore';
import { ApiError, appendAudit } from '../organizationSettingsStore';
import { RequestDenied, identityOf } from '../identity';
import { reloadAuthConfiguration } from '../lib/auth';
import { ensureUserAccountsExist } from '../authConsoleRoutes';
import { listCountryPacks, listIndustryPacks } from '@legalio/shared/policy';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('system');

export function createSystemRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

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
  return app;
}
