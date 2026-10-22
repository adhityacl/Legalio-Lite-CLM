import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRoute } from './appRoutes';

const ctxFor = (permissions: string[]) => ({ isPlatformAdmin: false, organizationReady: true, can: (p: string) => permissions.includes(p) });

test('My Approval is denied to viewers and allowed from editor up', () => {
  assert.deepEqual(resolveRoute('document-approval', ctxFor(['document.view'])), { kind: 'denied' });
  assert.deepEqual(resolveRoute('document-approval', ctxFor(['document.view', 'document.create'])), { kind: 'allow', tab: 'document-approval' });
});

test('removed database and backup pages send platform admins to the System Console dashboard', () => {
  const admin = { isPlatformAdmin: true, organizationReady: true, can: () => false };
  for (const tab of ['settings-security', 'admin-system-database', 'admin-system-backups']) {
    assert.deepEqual(resolveRoute(tab, admin), { kind: 'redirect', tab: 'admin-system-dashboard' });
    assert.deepEqual(resolveRoute(tab, ctxFor([])), { kind: 'denied' });
  }
});
