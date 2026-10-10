/**
 * Role sessions for the live browser specs.
 *
 * Sessions are created only in the isolated temporary database started by
 * tests/e2e/isolated/globalSetup.ts (synthetic `example.test` fixtures from
 * tests/tenant-boundaries/harness.ts). There is no fallback to the workspace
 * auth.db: without the isolated environment this throws.
 */
import { newSession, testDb } from './isolated/state';

export interface SeededRole {
  role: 'superuser' | 'admin' | 'manager' | 'editor' | 'viewer';
  token: string;
  userId: string;
}

/** Fixture identity per role: platform superuser, and admin/manager/editor/viewer members of Alpha Org. */
const FIXTURE_FOR_ROLE: Record<SeededRole['role'], string> = {
  superuser: 'super', admin: 'adminA', manager: 'managerA', editor: 'editorA', viewer: 'viewerA',
};

const seededTokens: string[] = [];

export function seedRoleSessions(): SeededRole[] {
  return (Object.keys(FIXTURE_FOR_ROLE) as SeededRole['role'][]).map((role) => {
    const token = newSession(FIXTURE_FOR_ROLE[role]);
    seededTokens.push(token);
    return { role, token, userId: `u-${FIXTURE_FOR_ROLE[role]}` };
  });
}

/** Removes the sessions this module created (the whole database is deleted at teardown anyway). */
export function cleanupRoleSessions(): void {
  const db = testDb();
  try {
    const remove = db.prepare(`DELETE FROM session WHERE token = ?`);
    for (const token of seededTokens.splice(0)) remove.run(token);
  } finally {
    db.close();
  }
}
