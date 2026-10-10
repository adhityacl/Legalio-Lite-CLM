import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affectedApps } from '../scripts/affected-apps.mjs';

test('CI selects only changed apps and propagates shared changes to both', () => {
  assert.deepEqual(affectedApps(['apps/frontend/src/App.tsx']), ['frontend']);
  assert.deepEqual(affectedApps(['packages/ui-components/src/button.tsx']), ['frontend', 'backend']);
  assert.deepEqual(affectedApps(['apps/backend/src/server.ts']), ['backend']);
  for (const path of ['packages/types/src/index.ts', 'packages/shared/src/policy/index.ts', 'packages/ts-config/base.json', 'package-lock.json', 'turbo.json', 'tests/buildIsolation.test.ts']) {
    assert.deepEqual(affectedApps([path]), ['frontend', 'backend'], path);
  }
  assert.deepEqual(affectedApps(['docs/design.md', 'README.md']), []);
  assert.deepEqual(affectedApps(['apps/frontend/src/App.tsx', 'apps/backend/src/server.ts']), ['frontend', 'backend']);
  assert.deepEqual(affectedApps(['apps/backend/console/src/main.tsx']), ['backend']);
  assert.deepEqual(affectedApps(['packages/platform-console/src/context/AuthContext.tsx']), ['frontend', 'backend']);
  assert.deepEqual(affectedApps(['unknown-config']), ['frontend', 'backend']);
});
