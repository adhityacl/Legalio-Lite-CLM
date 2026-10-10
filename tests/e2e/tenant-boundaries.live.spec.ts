/**
 * Live browser acceptance tests against the isolated server (tenant-boundaries
 * PRD §16: AC-004, AC-019, AC-030, AC-043, AC-044, AC-045). Real API, real
 * authorization, temporary database with synthetic `example.test` fixtures
 * (tests/e2e/isolated/globalSetup.ts). Tests run in order in one worker.
 */
import { test, expect, type Page } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { api, ids, newSession, signIn, testDb } from './isolated/state';

const A = 'org-a';
const B = 'org-b';

test('Connect Google opens both JSON upload slots, persists uploads and allows removal', async ({ page }) => {
  const token = await signIn(page, 'super', A);
  const base = '/api/integrations/google/credentials';
  const credentialHeaders: Array<Record<string, string>> = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith(base)) credentialHeaders.push(request.headers());
  });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const files = [
    { type: 'service_account', project_id: 'browser-test', client_email: 'test@browser-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    { web: { client_id: '42-browser.apps.googleusercontent.com', client_secret: 'browser-test-secret', javascript_origins: ['http://localhost:3000'] } },
  ];
  const dialog = page.getByRole('dialog', { name: 'Connect Google', exact: true });
  try {
    await page.goto('/app?tab=admin-system-google');
    await page.getByRole('button', { name: 'Manage credential files', exact: true }).click();
    await expect(dialog.locator('input[type=file]')).toHaveCount(2);
    for (const [index, file] of files.entries()) {
      const slot = dialog.locator('section').nth(index);
      await slot.locator('input[type=file]').setInputFiles({ name: `google-${index}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await expect(slot).toContainText('Installed from uploaded file');
      await expect(slot.getByRole('button', { name: 'Reset uploaded file', exact: true })).toBeEnabled();
    }
    await page.reload();
    await page.getByRole('button', { name: 'Manage credential files', exact: true }).click();
    await expect(dialog).toContainText('test@browser-test.iam.gserviceaccount.com');
    await expect(dialog).toContainText('42-browser.apps.googleusercontent.com');
    const oauthSlot = dialog.locator('section').nth(1);
    await oauthSlot.getByRole('button', { name: 'Reset uploaded file', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(oauthSlot).toContainText('Not configured');
    expect(credentialHeaders.length).toBeGreaterThanOrEqual(5);
    for (const headers of credentialHeaders) {
      expect(headers['x-organization-id']).toBeUndefined();
      expect(headers['x-tenant-id']).toBeUndefined();
    }
  } finally {
    for (const kind of ['service-account', 'oauth-client']) await api(token, `${base}/${kind}`, { method: 'DELETE' });
  }
});

test('organization card currency matches region settings and follows a saved currency change', async ({ page }) => {
  const token = await signIn(page, 'super', A);
  const initial = await api(token, `/api/organizations/${A}/settings`);
  expect(initial.status).toBe(200);
  const currency = initial.data.policy.defaultCurrency === 'EUR' ? 'JPY' : 'EUR';
  const card = page.locator('div.rounded-xl.border.p-5').filter({ has: page.getByRole('heading', { name: 'Alpha Org', exact: true }) });
  try {
    await page.goto('/app?tab=admin-system-organizations');
    await expect(card.getByText(initial.data.policy.defaultCurrency, { exact: true })).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await card.getByRole('button', { name: 'Manage organization', exact: true }).click();
    const organizationPage = await popupPromise;
    await organizationPage.getByRole('button', { name: /^Region and formatting/ }).click();
    await expect(organizationPage.getByLabel('Default currency', { exact: true })).toHaveValue(initial.data.policy.defaultCurrency);
    await organizationPage.getByLabel('Default currency', { exact: true }).selectOption(currency);
    await organizationPage.getByRole('button', { name: 'Save Region and formatting', exact: true }).click();
    await expect(organizationPage.getByText('Saved.', { exact: true })).toBeVisible();
    await organizationPage.close();
    await page.goto('/app?tab=admin-system-organizations');
    await expect(card.getByText(currency, { exact: true })).toBeVisible();
    await page.reload();
    await expect(card.getByText(currency, { exact: true })).toBeVisible();
  } finally {
    const current = await api(token, `/api/organizations/${A}/settings`);
    await api(token, `/api/organizations/${A}/settings`, {
      method: 'PATCH', body: { expectedVersion: current.data.version, policy: { defaultCurrency: initial.data.policy.defaultCurrency } },
    });
  }
});

function apiRequests(page: Page) {
  const list: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) list.push(`${request.method()} ${url.pathname}`);
  });
  return list;
}

const sidebar = (page: Page) => page.locator('aside');
const switcher = (page: Page) => page.locator('aside button[aria-haspopup="listbox"]');
const metric = (page: Page, label: string) => page.locator('.dashboard-metric').filter({ hasText: label });
const denied = (page: Page) => page.getByRole('heading', { name: 'You do not have access to this page' });

/** Card shows `<value>/ <total>`; `count` is written as "3 / 3". */
const ratio = (count: string) => new RegExp(count.replace(/\s*\/\s*/, '\\s*/\\s*'));
async function expectCounts(page: Page, partners: string, contracts: string) {
  await expect(metric(page, 'Active Partners')).toContainText(ratio(partners));
  await expect(metric(page, 'Active Contracts')).toContainText(ratio(contracts));
}
/** The sidebar's workspace button (a listbox trigger only when several organizations are accessible). */
const workspace = (page: Page) => page.locator('aside button').first();

function identityRows(userKey: string) {
  const db = testDb();
  try {
    return {
      user: db.prepare(`SELECT id, email, name, role, banned, emailVerified FROM "user" WHERE id = ?`).get(ids()[userKey]),
      members: db.prepare(`SELECT id, organizationId, role, status FROM member WHERE userId = ? ORDER BY id`).all(ids()[userKey]),
      teams: db.prepare(`SELECT teamId FROM teamMember WHERE userId = ? ORDER BY teamId`).all(ids()[userKey]),
    };
  } finally {
    db.close();
  }
}

test.describe('AC-043 platform role visibility', () => {
  test('superuser without a selection lands on System Admin and loads no tenant business data', async ({ page }) => {
    const requests = apiRequests(page);
    await signIn(page, 'super');
    await page.goto('/');
    await expect(page).toHaveURL(/tab=admin-system-dashboard/);
    await expect(page.getByRole('tablist', { name: 'System Admin' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ADMIN NAVIGATION' })).toBeVisible();
    await page.getByRole('tab', { name: /^Organizations/ }).click();
    await expect(page.locator('main')).toContainText('Alpha Org');
    await expect(page.locator('main')).toContainText('Beta Org');
    await page.getByRole('navigation', { name: 'ADMIN NAVIGATION' }).getByRole('button', { name: 'Google & storage', exact: true }).click();
    await expect(page).toHaveURL(/tab=admin-system-google/);
    await expect(page.getByRole('heading', { name: 'Google & storage', exact: true })).toBeVisible();
    expect(requests.filter((r) => /\/api\/(init-data|partners|contracts)\b|\/api\/organizations\/[^/]+\/(capabilities|settings)/.test(r))).toEqual([]);
    expect(identityRows('super').members).toEqual([]);
  });

  test('platform user without membership sees only the access state and personal actions', async ({ page }) => {
    const requests = apiRequests(page);
    const token = await signIn(page, 'nomember');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up your organization', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'System Admin', exact: true })).toHaveCount(0);
    await page.goto('/app?tab=admin-system-dashboard');
    await expect(page.getByRole('tablist', { name: 'System Admin' })).toHaveCount(0);
    expect(requests.filter((r) => /\/api\/(init-data|auth-console|platform)\b|\/api\/organizations\//.test(r))).toEqual([]);
    expect((await api(token, '/api/platform/configuration')).status).toBe(403);
    expect((await api(token, '/api/init-data', { org: A })).status).toBe(404);
  });

  test('ordinary tenant admin never sees or reaches platform surfaces', async ({ page }) => {
    const requests = apiRequests(page);
    const token = await signIn(page, 'adminA');
    await page.goto('/app?tab=admin-system-settings');
    await expect(denied(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'System Admin', exact: true })).toHaveCount(0);
    expect(requests.filter((r) => /\/api\/(auth-console|platform)\//.test(r))).toEqual([]);
    for (const path of ['/api/platform/configuration', '/api/platform/audit', '/api/auth-console/users', '/api/auth-console/sqlite/status']) {
      expect((await api(token, path)).status, path).toBe(403);
    }
  });
});

test.describe('AC-044 tenant role menus, guards and direct API checks', () => {
  const matrix = {
    adminA: { importData: true, settings: true, documents: true, settingsApi: 200, membersApi: 200 },
    managerA: { importData: false, settings: true, documents: true, settingsApi: 403, membersApi: 200 },
    editorA: { importData: false, settings: false, documents: true, settingsApi: 403, membersApi: 403 },
    viewerA: { importData: false, settings: false, documents: false, settingsApi: 403, membersApi: 403 },
  } as const;
  for (const [who, expected] of Object.entries(matrix)) {
    test(`${who}: menus, pre-mount guards and API agree`, async ({ page }) => {
      const requests = apiRequests(page);
      const token = await signIn(page, who);
      await page.goto('/');
      await expect(sidebar(page).getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();
      await expect(sidebar(page).getByRole('button', { name: 'Import Data', exact: true })).toHaveCount(expected.importData ? 1 : 0);
      await expect(sidebar(page).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(expected.settings ? 1 : 0);
      await expect(sidebar(page).getByRole('button', { name: 'My Documents', exact: true })).toHaveCount(expected.documents ? 1 : 0);
      await expect(sidebar(page).getByRole('button', { name: 'System Admin', exact: true })).toHaveCount(0);
      if (!expected.importData) {
        await page.goto('/app?tab=bulk-import');
        await expect(denied(page)).toBeVisible();
      }
      if (!expected.documents) {
        await page.goto('/app?tab=create-contract');
        await expect(denied(page)).toBeVisible();
      }
      if (!expected.settings) {
        await page.goto('/app?tab=settings-access');
        await expect(denied(page)).toBeVisible();
        expect(requests.filter((r) => /\/api\/organizations\/[^/]+\/(settings|members|integrations|audit|invitations)/.test(r))).toEqual([]);
      }
      expect((await api(token, `/api/organizations/${A}/settings`)).status).toBe(expected.settingsApi);
      expect((await api(token, `/api/organizations/${A}/members`)).status).toBe(expected.membersApi);
      // Policy runs before validation: only the admin gets far enough to be told the (empty) name is invalid.
      expect((await api(token, `/api/organizations/${A}/departments`, { method: 'POST', body: { name: '' } })).status)
        .toBe(who === 'adminA' ? 400 : 403);
    });
  }

  test('disabled modules hide their menus, dashboard widgets and deep links for every role', async ({ browser }) => {
    const admin = newSession('adminA');
    const current = await api(admin, `/api/organizations/${A}/settings`);
    const modules = current.data.policy.modules;
    const patch = async (next: Record<string, boolean>, expectedVersion: number) =>
      api(admin, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion, policy: { modules: { ...modules, ...next } } } });
    const off = await patch({ spending: false, evaluation: false, commercialDocuments: false }, current.data.version);
    expect(off.status).toBe(200);
    try {
      for (const who of ['adminA', 'managerA', 'editorA', 'viewerA']) {
        const context = await browser.newContext();
        const fresh = await context.newPage();
        await signIn(fresh, who);
        await fresh.goto('/');
        await expect(fresh.locator('.dashboard-metric')).toHaveCount(3);
        await expect(fresh.getByRole('heading', { name: 'Spending Trend' })).toHaveCount(0);
        await sidebar(fresh).getByRole('button', { name: 'Open Submenu' }).first().click();
        await expect(sidebar(fresh).getByRole('button', { name: /^(Partner Spending|Partner Evaluation)$/ })).toHaveCount(0);
        for (const tab of ['partner-spending', 'partner-evaluation', 'ios']) {
          await fresh.goto(`/app?tab=${tab}`);
          await expect(denied(fresh)).toBeVisible();
        }
        await context.close();
      }
    } finally {
      expect((await patch({}, off.data.version)).status).toBe(200);
    }
  });
});

test.describe('AC-045 dashboard content follows organization and department scope', () => {
  const cases: Array<[string, string, string, string[], string[]]> = [
    // identity, partners card, contracts card, visible partners, hidden partners
    ['adminA', '3 / 3', '3 / 3', ['Alpha Legal Partner', 'Alpha Finance Partner', 'Alpha Unassigned Partner'], ['Beta Legal Partner']],
    ['managerA', '1 / 1', '1 / 1', ['Alpha Legal Partner'], ['Alpha Finance Partner', 'Alpha Unassigned Partner', 'Beta Legal Partner']],
    ['financeViewerA', '1 / 1', '1 / 1', ['Alpha Finance Partner'], ['Alpha Legal Partner', 'Alpha Unassigned Partner', 'Beta Legal Partner']],
    ['adminB', '1 / 1', '1 / 1', ['Beta Legal Partner'], ['Alpha Legal Partner', 'Alpha Finance Partner']],
  ];
  for (const [who, partners, contracts, visible, hidden] of cases) {
    test(`${who}: cards, drill-down and lists show only permitted records`, async ({ page }) => {
      await signIn(page, who);
      await page.goto('/');
      await expectCounts(page, partners, contracts);
      await metric(page, 'Active Partners').click();
      await expect(page).toHaveURL(/tab=partners/);
      for (const name of visible) await expect(page.locator('main').getByText(name, { exact: true }).first()).toBeVisible();
      for (const name of hidden) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    });
  }

  test('a member without departments sees the no-department state and no records', async ({ page }) => {
    await signIn(page, 'noDept');
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'You are not assigned to a department' })).toBeVisible();
    await expectCounts(page, '0 / 0', '0 / 0');
    for (const name of ['Alpha Legal Partner', 'Alpha Finance Partner', 'Alpha Unassigned Partner']) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test('AC-004 switching from admin in A to viewer in B replaces capabilities and data; identity unchanged', async ({ page }) => {
  const before = identityRows('multi');
  const token = await signIn(page, 'multi');
  const requests = apiRequests(page);
  await page.goto('/');
  // Two organizations, no saved or default selection: the chooser, never the "first" organization.
  await expect(page.getByRole('heading', { name: 'Choose an organization', level: 1 })).toBeVisible();
  expect(requests.filter((r) => r.endsWith('/api/init-data'))).toEqual([]);
  await page.getByRole('button', { name: 'Alpha Org', exact: true }).click();

  await expectCounts(page, '3 / 3', '3 / 3');
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab')).toHaveText(['Organization', 'Members & Access', 'Integrations']);

  await switcher(page).click();
  await page.getByRole('listbox').getByRole('option', { name: /Beta Org/ }).click();
  await expect(page).toHaveURL(/tab=dashboard/);
  await expect(workspace(page)).toContainText('Beta Org');
  await expectCounts(page, '1 / 1', '1 / 1');
  await expect(sidebar(page).getByRole('button', { name: /^(Settings|Import Data|My Documents)$/ })).toHaveCount(0);
  await expect(page.getByText('Alpha Legal Partner')).toHaveCount(0);
  await page.goto('/app?tab=settings-organization');
  await expect(denied(page)).toBeVisible();

  // DB: the identity, memberships and assignments are untouched; only this session's default moved.
  expect(identityRows('multi')).toEqual(before);
  const db = testDb();
  try {
    const session = db.prepare(`SELECT activeOrganizationId FROM session WHERE token = ?`).get(token) as { activeOrganizationId: string };
    expect(session.activeOrganizationId).toBe(B);
  } finally {
    db.close();
  }
});

test('AC-030 superuser manages A without a membership; changes are audited as the platform actor', async ({ page }) => {
  await signIn(page, 'super');
  await page.goto('/');
  await page.getByRole('tab', { name: /^Organizations/ }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('main div').filter({ hasText: 'Alpha Org' }).filter({ hasNotText: 'Beta Org' })
    .getByRole('button', { name: 'Manage organization', exact: true }).first().click();
  const organizationPage = await popupPromise;
  await expect(organizationPage).toHaveURL(/tab=settings-organization/);
  await expect(organizationPage.getByText('Platform administrator managing Alpha Org')).toHaveCount(0);
  await expect(organizationPage.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab')).toHaveText(['Organization', 'Members & Access', 'Integrations']);
  await expect(organizationPage.getByRole('button', { name: 'System Admin', exact: true })).toHaveCount(0);
  await expect(sidebar(organizationPage).getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(sidebar(organizationPage).getByRole('button', { name: 'Import Data', exact: true })).toBeVisible();

  await organizationPage.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  await expect(organizationPage).toHaveURL(/tab=settings-access/);
  await expect(organizationPage.getByText('Platform administrator managing Alpha Org')).toHaveCount(0);
  await organizationPage.getByRole('tab', { name: 'Integrations', exact: true }).click();
  await expect(organizationPage).toHaveURL(/tab=settings-integrations/);
  await expect(organizationPage.getByText('Platform administrator managing Alpha Org')).toHaveCount(0);
  await organizationPage.getByRole('tab', { name: 'Organization', exact: true }).click();

  await expect(organizationPage.getByLabel('Tagline', { exact: true })).toHaveCount(0);
  const legalEntity = `Managed by the platform ${Date.now()}`;
  await organizationPage.getByLabel('Legal entity', { exact: true }).fill(legalEntity);
  await organizationPage.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(organizationPage.getByText('Saved.', { exact: true })).toBeVisible();

  const db = testDb();
  try {
    expect((db.prepare(`SELECT COUNT(*) AS n FROM member WHERE userId = ?`).get(ids().super) as { n: number }).n).toBe(0);
    const event = db.prepare(`SELECT actor_id, tenant_id, metadata FROM audit_log WHERE tenant_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 1`).get(A, ids().super) as { actor_id: string; tenant_id: string; metadata: string };
    expect(event.actor_id).toBe(ids().super);
    expect(JSON.parse(event.metadata)).toMatchObject({ accessMode: 'platform', actorPlatformRole: 'superuser', outcome: 'success' });
    const profile = JSON.parse((db.prepare(`SELECT payload FROM organization_settings WHERE organizationId = ?`).get(A) as { payload: string }).payload).profile;
    expect(profile.legalEntity).toBe(legalEntity);
  } finally {
    db.close();
  }

  await organizationPage.getByRole('button', { name: 'Back to System Admin', exact: true }).click();
  await expect(organizationPage).toHaveURL(/tab=admin-system-organizations/);
  await expect(page).toHaveURL(/tab=admin-system-organizations/);
  await organizationPage.close();
});

test('AC-019 a membership suspended after capabilities load is dropped on the next request; other access and the session remain', async ({ page }) => {
  const token = await signIn(page, 'multi', B);
  await page.goto('/app?tab=notifikasi');
  await expect(workspace(page)).toContainText('Beta Org');
  const membershipId = (() => {
    const db = testDb();
    try {
      return (db.prepare(`SELECT id FROM member WHERE userId = ? AND organizationId = ?`).get(ids().multi, B) as { id: string }).id;
    } finally {
      db.close();
    }
  })();
  const adminB = newSession('adminB');
  expect((await api(adminB, `/api/organizations/${B}/members/${membershipId}`, { method: 'PATCH', body: { status: 'suspended' } })).status).toBe(200);
  try {
    // The tab still shows B until its next protected request, which the server denies.
    await page.getByRole('button', { name: 'Refresh Logs', exact: true }).click();
    await expect(workspace(page)).toContainText('Alpha Org');
    await expect(page.getByText('Beta Legal Partner')).toHaveCount(0);
    await expect(sidebar(page).getByRole('button', { name: 'Settings', exact: true })).toBeVisible(); // admin in A still works
    const me = await api(token, '/api/me');
    expect(me.status).toBe(200); // the global session is not revoked
    expect(me.data.memberships.find((m: { organizationId: string }) => m.organizationId === B).status).toBe('suspended');
    expect((await api(token, '/api/init-data', { org: B })).status).toBe(404);
    expect((await api(token, '/api/init-data', { org: A })).status).toBe(200);
  } finally {
    await api(adminB, `/api/organizations/${B}/members/${membershipId}`, { method: 'PATCH', body: { status: 'active' } });
  }
});
