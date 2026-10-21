import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRoute } from './appRoutes';

const ctxFor = (permissions: string[]) => ({ isPlatformAdmin: false, organizationReady: true, can: (p: string) => permissions.includes(p) });

test('My Approval is denied to viewers and allowed from editor up', () => {
  assert.deepEqual(resolveRoute('document-approval', ctxFor(['document.view'])), { kind: 'denied' });
  assert.deepEqual(resolveRoute('document-approval', ctxFor(['document.view', 'document.create'])), { kind: 'allow', tab: 'document-approval' });
});
