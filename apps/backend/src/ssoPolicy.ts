/**
 * "SSO required" enforcement, kept free of protocol code so the sign-in paths (Better Auth session hook, Google sync-session) can import it.
 *
 * A member of an organization that requires SSO may not start a password (or social) session, with two exceptions: a platform superuser,
 * and a break-glass administrator of that organization (an active organization admin the organization listed explicitly). SSO sessions
 * themselves are created by sso.ts, not through the sign-in endpoints, so they never pass through this check.
 */
import type { Sql } from './db';

export const SSO_REQUIRED_MESSAGE = 'Your organization requires single sign-on. Use "Continue with SSO" to sign in.';

export async function ssoBlocksPasswordSignIn(db: Sql, userId: string): Promise<{ blocked: boolean; organizationId?: string }> {
  const user = await db.get<{ role: string | null }>(`SELECT role FROM "user" WHERE id = ?`, userId);
  if (!user || user.role === 'superuser') return { blocked: false };
  const rows = await db.all<{ organization_id: string; break_glass_user_ids: string; member_role: string }>(`
    SELECT p.organization_id, p.break_glass_user_ids, m.role AS member_role
    FROM sso_providers p JOIN member m ON m."organizationId" = p.organization_id
    WHERE m."userId" = ? AND m.status = 'active' AND p.enabled AND p.require_sso`, userId);
  for (const row of rows) {
    let ids: unknown = [];
    try { ids = JSON.parse(row.break_glass_user_ids); } catch { /* treated as empty */ }
    const breakGlass = Array.isArray(ids) && ids.includes(userId) && row.member_role === 'admin';
    if (!breakGlass) return { blocked: true, organizationId: row.organization_id };
  }
  return { blocked: false };
}
