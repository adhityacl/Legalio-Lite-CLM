import { identityOf, resolveLegacyContext, sendError, RequestDenied, resolveOrganizationContext } from '../identity';
import { OrgContext, buildMatrix as buildRbacMatrix, can, hasOrganizationScope } from '../rbac';
import { sql } from '../db';
import { capabilitiesOf, identityResponse } from '../organizationAdminRoutes';
import { orgContextOf, addActivityLog } from '../recordAccess';
import { randomBytes } from 'node:crypto';
import { allowedUserRepository, withAdderNames, LastAdminError } from '../repositories/allowedUserRepository';
import { RecordNotFoundError, RepositoryError } from '../repositories/errors';
import { checkIsAdmin } from '../adminCheck';
import { hashPassword } from 'better-auth/crypto';
import { sendRouteError } from '../apiErrors';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('users');

export function createUsersRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);


/* Legacy RBAC adapters (PRD §10.1): server-resolved actor, explicit catalogs, no wildcard. */
app.get("/api/rbac/me", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  let ctx: OrgContext | null = null;
  try { ctx = await resolveLegacyContext(sql, identity, req, { includeBody: false }); } catch { ctx = null; }
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
app.post("/api/rbac/check", async (req: express.Request, res: express.Response) => {
  const permission = req.body?.permission;
  if (typeof permission !== "string") return sendError(req, res, 400, "INVALID_INPUT", "permission is required.");
  try {
    const ctx = await resolveLegacyContext(sql, identityOf(req), req, { includeBody: false });
    return res.json({ ok: true, allow: can(ctx, permission) });
  } catch (err: any) {
    if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
    throw err;
  }
});
async function getBetterAuthSession(req) {
  try {
    const identity = identityOf(req);
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
app.get("/api/user/my-role", async (req: express.Request, res: express.Response) => {
  let identity;
  try {
    identity = identityOf(req);
  } catch (err: any) {
    // The start-up probe treats "signed out" as an expected answer.
    if (req.query.probe === "1") return res.status(204).end();
    return sendError(req, res, err?.status || 401, err?.error || "UNAUTHENTICATED");
  }
  const me = await identityResponse(sql, identity);
  res.json({ ...me, email: identity.email, name: identity.name, platformRole: identity.platformRole, loginTime: new Date().toISOString() });
});

/** Department names for operational forms: the verified organization, scoped to the caller (no fallback). */
app.get("/api/departments", async (req: express.Request, res: express.Response) => {
  const ctx = orgContextOf(req);
  const rows = await sql.all('SELECT id, name FROM team WHERE "organizationId" = ? ORDER BY lower(name), id', ctx.organizationId) as any[];
  const visible = hasOrganizationScope(ctx) ? rows : rows.filter((r) => ctx.departmentIds.includes(r.id));
  res.json({ success: true, departments: visible.map((r) => r.name), items: visible });
});
/** Records the caller's own sign-in/sign-out in their session's organization (if any). */
app.post("/api/user/log-activity", async (req: express.Request, res: express.Response) => {
  const identity = identityOf(req);
  const actionType = req.body?.actionType === "LOGOUT" ? "LOGOUT" : "LOGIN";
  const orgId = identity.sessionDefaultOrganizationId;
  let ctx: OrgContext | null = null;
  try { ctx = orgId ? await resolveOrganizationContext(sql, identity, orgId) : null; } catch { ctx = null; }
  await addActivityLog("", "", "", actionType, "AUTH", actionType === "LOGOUT" ? "Signed out" : "Signed in", req, ctx?.organizationId ?? null);
  res.json({ success: true });
});
app.get("/api/user/allowed-users", async (req: express.Request, res: express.Response) => {
  res.json(withAdderNames(await allowedUserRepository.list()));
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
  if (await allowedUserRepository.findByEmail(email)) {
    return res
      .status(400)
      .json({ error: `Email '${email}' sudah ada dalam daftar whitelist.` });
  }
  const newUser = {
    id: `usr-${Date.now()}-${randomBytes(3).toString("hex")}`,
    email: email.trim().toLowerCase(),
    name,
    role,
    department: department || "Umum",
    status: "Active",
    addedBy: adminCheck.adminName || "Admin",
    addedByEmail: adminCheck.adminEmail,
    createdAt: new Date().toISOString(),
  };
  await allowedUserRepository.insert(newUser);
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "ADD_USER",
    "ADMIN",
    `Menambahkan email '${email}' (${name} - ${role}) ke whitelist akses`,
    req,
  );
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
  let user;
  try {
    user = await allowedUserRepository.mutate(id, (entry) => {
      if (role) entry.role = role;
      if (department) entry.department = department;
      if (status) entry.status = status;
      if (name) entry.name = name;
    });
  } catch (err) {
    if (err instanceof RecordNotFoundError) return res.status(404).json({ error: "Pengguna tidak ditemukan." });
    if (err instanceof LastAdminError) return res.status(400).json({ error: err.message });
    throw err;
  }
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "UPDATE",
    "ADMIN",
    `Memperbarui hak akses/role pengguna '${user.email}' (${user.name}) menjadi '${user.role}'`,
    req,
  );
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
  let user;
  try {
    user = await allowedUserRepository.remove(id, (entry) => {
      if (adminCheck.adminEmail && entry.email.toLowerCase() === adminCheck.adminEmail.toLowerCase()) {
        throw new RepositoryError(400, "SELF_DELETE", "Anda tidak dapat menghapus akun Anda sendiri saat sedang login.");
      }
    });
  } catch (err) {
    if (err instanceof RecordNotFoundError) return res.status(404).json({ error: "Pengguna tidak ditemukan." });
    if (err instanceof LastAdminError || (err instanceof RepositoryError && err.apiCode === "SELF_DELETE")) return res.status(400).json({ error: (err as Error).message });
    throw err;
  }
  await addActivityLog(
    adminCheck.adminEmail || "admin@app",
    adminCheck.adminName || "Admin",
    "Admin",
    "REMOVE_USER",
    "ADMIN",
    `Mencabut akses email '${user.email}' (${user.name}) dari whitelist`,
    req,
  );
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
    const authDb = sql;
    const trimmedEmail = email.trim().toLowerCase();
    let targetUser: any = await authDb.get('SELECT id, name, email FROM "user" WHERE LOWER(email) = ?', trimmedEmail);
    const hashedPassword = await hashPassword(newPassword.trim());
    const nowIso = new Date().toISOString();
    if (!targetUser) {
      const allowedUser = await allowedUserRepository.findByEmail(trimmedEmail);
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const userName = allowedUser?.name || email.split("@")[0];
      const userRole = "user"; // platform role only; organization access comes from memberships
      await authDb.run(`
        INSERT INTO "user" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
        VALUES (?, ?, ?, true, ?, false, ?, ?)
      `, userId, userName, trimmedEmail, userRole, nowIso, nowIso);
      const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await authDb.run(`
        INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (?, ?, 'credential', ?, ?, ?, ?)
      `, accountId, userId, userId, hashedPassword, nowIso, nowIso);
      targetUser = { id: userId, name: userName, email: trimmedEmail };
    } else {
      const existingAccount: any = await authDb.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'credential'`, targetUser.id);
      if (existingAccount) {
        await authDb.run('UPDATE account SET password = ?, "updatedAt" = ? WHERE id = ?', hashedPassword, nowIso, existingAccount.id);
      } else {
        const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        await authDb.run(`
          INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
          VALUES (?, ?, 'credential', ?, ?, ?, ?)
        `, accountId, targetUser.id, targetUser.id, hashedPassword, nowIso, nowIso);
      }
      await authDb.run('UPDATE "user" SET banned = false, "banReason" = NULL, "updatedAt" = ? WHERE id = ?', nowIso, targetUser.id);
    }
    await addActivityLog(
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
    log.error("Server error resetting password:", err);
    sendRouteError(req, res, err, "request failed", "Terjadi kesalahan saat mereset password.", { status: 500 });
  }
});
  return app;
}
