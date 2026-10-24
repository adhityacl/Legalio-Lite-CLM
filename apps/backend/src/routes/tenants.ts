import { organizationOwnsBusinessData } from '../businessData';
import { identityOf, accessibleOrganizations, RequestDenied, sendError } from '../identity';
import { sql, isUniqueViolation } from '../db';
import { db, refreshTenantProjection } from '../memoryDb';
import { selectActiveOrganization, auditActorFor } from '../organizationAdminRoutes';
import { ApiError, appendAudit, readOrganizationSettings, patchOrganizationSettings } from '../organizationSettingsStore';
import { createOrganizationRecord } from '../organizationProvisioning';
import { findTenant } from '../tenantPolicy';
import { sendRouteError } from '../apiErrors';
import { onOrganizationChanged } from '../platformSettings';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createTenantsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

/*
 * /api/tenants adapters (PRD §10.1): listing is side-effect free (no global
 * active tenant, no provisioning); switching only updates this session's
 * default; lifecycle writes are platform-only canonical services.
 */
app.get("/api/tenants", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const accessible = await accessibleOrganizations(sql, identity);
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
app.post("/api/tenants/switch", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId : req.body?.organizationId;
  try {
    const result = await selectActiveOrganization(sql, identity, Object.assign(Object.create(req), { body: { organizationId: tenantId } }));
    return res.json({ success: true, activeTenantId: result.organizationId });
  } catch (err: any) {
    if (err instanceof RequestDenied || err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.post("/api/tenants", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return sendError(req, res, 400, "INVALID_INPUT", "Organization name is required (1–200 characters).");
  try {
    const id = await sql.tx(async () => {
      const orgId = await createOrganizationRecord(sql, {
        name,
        slug: typeof body.domainSlug === "string" ? body.domainSlug : undefined,
        legalEntity: typeof body.legalEntity === "string" ? body.legalEntity.slice(0, 200) : "",
        brandName: typeof body.brandName === "string" ? body.brandName.slice(0, 200) : name,
        tagline: typeof body.tagline === "string" ? body.tagline.slice(0, 500) : "",
        primaryColor: typeof body.primaryColor === "string" ? body.primaryColor : undefined,
        settings: { countryCode: body.countryCode || body.settings?.countryCode, industry: body.industry || body.settings?.industry, defaultCurrency: body.currency },
      }, identity.userId);
      await appendAudit(sql, auditActorFor(req, identity), {
        organizationId: orgId, action: "organization.create", targetType: "organization", targetId: orgId, outcome: "success", changedFields: ["name"],
      });
      return orgId;
    });
    await refreshTenantProjection();
    return res.status(201).json({ success: true, newTenant: findTenant(id), tenants: db.tenants });
  } catch (err: any) {
    if (err instanceof ApiError || err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
    return sendRouteError(req, res, err, "organization create failed", "The organization could not be created.", { status: 400, code: "INVALID_INPUT", extra: { error: "INVALID_INPUT" } });
  }
});
app.put("/api/tenants/:id", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  try {
    const current = await readOrganizationSettings(sql, req.params.id);
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
      if (await sql.get("SELECT 1 FROM organization WHERE slug = ? AND id <> ?", slug, req.params.id)) return sendError(req, res, 409, "SLUG_EXISTS");
      try {
        await sql.run("UPDATE organization SET slug = ? WHERE id = ?", slug, req.params.id);
      } catch (err) {
        if (isUniqueViolation(err)) return sendError(req, res, 409, "SLUG_EXISTS"); // taken between the check and the write
        throw err;
      }
    }
    if (patch.name !== undefined || patch.profile || patch.policy) {
      await patchOrganizationSettings(sql, req.params.id, patch, auditActorFor(req, identity));
    }
    await onOrganizationChanged(req.params.id);
    return res.json({ success: true, tenants: db.tenants });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
app.delete("/api/tenants/:id", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const id = req.params.id;
  if (!findTenant(id)) return sendError(req, res, 404, "RESOURCE_NOT_FOUND");
  // Deleting an organization never cascades into business data (PRD §9.4).
  const owned = await organizationOwnsBusinessData(id);
  if (owned) return sendError(req, res, 409, "ORGANIZATION_IN_USE", "Move or remove this organization's records first.");
  await sql.tx(async () => {
    await sql.run('DELETE FROM "teamMember" WHERE "teamId" IN (SELECT id FROM team WHERE "organizationId" = ?)', id);
    for (const table of ["member", "team", "invitation", "organization_settings", "organization_integrations"]) {
      await sql.run(`DELETE FROM ${table} WHERE "organizationId" = ?`, id);
    }
    await sql.run('UPDATE session SET "activeOrganizationId" = NULL WHERE "activeOrganizationId" = ?', id);
    await sql.run("DELETE FROM organization WHERE id = ?", id);
    await appendAudit(sql, auditActorFor(req, identity), {
      organizationId: id, action: "organization.delete", targetType: "organization", targetId: id, outcome: "success", changedFields: [],
    });
  });
  await refreshTenantProjection();
  return res.json({ success: true, tenants: db.tenants });
});
  return app;
}
