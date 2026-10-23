import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPERATIONAL_TABS, SETTINGS_TABS } from '../lib/appRoutes';
import { ROUTES, moduleDisabled } from './registry';
import { decideGate, type GateInput } from './useRouteGate';

test('every operational and settings tab has a lazily loaded page; tabs outside the registry have none', () => {
  for (const tab of [...OPERATIONAL_TABS, ...SETTINGS_TABS]) assert.ok(ROUTES[tab], `no page registered for ?tab=${tab}`);
  assert.equal(ROUTES['admin-system-dashboard'], undefined, 'the System Console is a separate application');
  assert.equal(ROUTES.login, undefined);
  // React.lazy objects: the component is not loaded until the page is rendered.
  assert.equal((ROUTES.dashboard.component as { $$typeof?: symbol }).$$typeof?.toString(), 'Symbol(react.lazy)');
});

test('module switches hide exactly the pages that belong to them', () => {
  const off = { commercialDocuments: false, spending: false, evaluation: false };
  assert.deepEqual(['ios', 'io', 'partner-spending', 'partner-evaluation'].map((tab) => moduleDisabled(tab, off)), [true, true, true, true]);
  assert.deepEqual(['contracts', 'partners', 'dashboard', 'notifikasi'].map((tab) => moduleDisabled(tab, off)), [false, false, false, false]);
  assert.equal(moduleDisabled('ios', { ...off, commercialDocuments: true }), false);
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  tab: 'contracts', isPlatformAdmin: false, selectionStatus: 'ready', activeTenantId: 'org-1', capabilityStatus: 'ready',
  can: () => true, modules: { commercialDocuments: true, spending: true, evaluation: true }, tenantSettingsReady: true, ...over,
});

test('the gate waits for the organization and its capabilities before deciding, and never shows a page on an error', () => {
  assert.equal(decideGate(input({ selectionStatus: 'loading' })).kind, 'pending');
  assert.equal(decideGate(input({ activeTenantId: null })).kind, 'no-org');
  assert.equal(decideGate(input({ capabilityStatus: 'loading' })).kind, 'pending');
  assert.equal(decideGate(input({ capabilityStatus: 'idle' })).kind, 'pending');
  assert.equal(decideGate(input({ capabilityStatus: 'error' })).kind, 'caps-error');
  assert.equal(decideGate(input()).kind, 'allow');
});

test('the gate applies permissions, aliases, module switches and platform-only pages', () => {
  assert.equal(decideGate(input({ tab: 'bulk-import', can: (p) => p !== 'tenant.data.import' })).kind, 'denied');
  assert.deepEqual(decideGate(input({ tab: 'settings' })), { kind: 'redirect', tab: 'settings-organization' });
  assert.equal(decideGate(input({ tab: 'ios', modules: { commercialDocuments: false } })).kind, 'denied');
  assert.equal(decideGate(input({ tab: 'ios', modules: { commercialDocuments: false }, tenantSettingsReady: false })).kind, 'pending', 'module flags are not trusted before the settings load');
  assert.equal(decideGate(input({ tab: 'admin-system-dashboard' })).kind, 'denied');
  assert.equal(decideGate(input({ tab: 'admin-system-dashboard', isPlatformAdmin: true, activeTenantId: null })).kind, 'allow');
  assert.equal(decideGate(input({ tab: 'definitely-not-a-page' })).kind, 'denied');
  assert.deepEqual(decideGate(input({ tab: 'dashboard', isPlatformAdmin: true, activeTenantId: null, capabilityStatus: 'idle' })).kind, 'redirect');
});
