import type { Sql } from "./db";
import { buildDemoDataset } from "@legalio/shared/data/demoDataset";

/** Login accounts shipped with the demo dataset — all on the reserved example.com domain. */
export const DEMO_ACCOUNT_EMAILS = new Set(buildDemoDataset().allowedUsers.map((u) => String(u.email).toLowerCase()));

const LEGACY_DEMO_ACCOUNT_EMAILS = new Set([
  'legal.sg@example.com',
  'procurement.sg@example.com',
  'viewer.sg@example.com',
  'legal.id@example.com',
  'finance.id@example.com',
  'legal.jp@example.com',
  'admin.id@example.com',
  'admin.my@example.com',
  'admin.ph@example.com',
]);

export const isDemoAccountEmail = (email: unknown) => {
  const normalized = String(email ?? "").trim().toLowerCase();
  return DEMO_ACCOUNT_EMAILS.has(normalized) || LEGACY_DEMO_ACCOUNT_EMAILS.has(normalized);
};

/**
 * Deletes the demo-dataset login accounts (user, credentials, sessions, memberships) and returns
 * the app user list without them. Both must go: every boot recreates a login, with the
 * DEMO_ADMIN_PASSWORD, for each entry left in the app user list.
 */
export async function removeDemoAccounts<T extends { id?: unknown; email?: unknown }>(auth: Sql, allowedUsers: T[], keepUserId?: string) {
  const doomed = (await auth.all(`SELECT id, email FROM "user"`) as Array<{ id: string; email: string }>).filter(
    (u) => isDemoAccountEmail(u.email) && u.id !== keepUserId,
  );
  await auth.tx(async () => {
    for (const { id } of doomed) {
      for (const table of ["session", "account", "member", "teamMember"]) {
        await auth.run(`DELETE FROM "${table}" WHERE "userId" = ?`, id);
      }
      await auth.run(`DELETE FROM "user" WHERE id = ?`, id);
    }
  });
  return {
    allowedUsers: allowedUsers.filter((u) => !isDemoAccountEmail(u.email) || u.id === keepUserId),
    removed: doomed.length,
  };
}
