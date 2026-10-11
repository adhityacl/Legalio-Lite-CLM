/**
 * Unified tenant Settings — mocked-browser acceptance checks (tenant-boundaries
 * PRD §6, §16: AC-001/002/003/025/027/039/042). Every API is intercepted; the
 * preview server never opens a database. Server-side enforcement of the same
 * rules is proven separately by `npm run test:tenant-boundaries`.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTenantApi, fixtureOrganization, fulfillTenantApi, workspaceInit, type TenantApiOptions } from './fixtures/tenantApi';

const A = fixtureOrganization('org-a', 'Alpha Org');
const B = fixtureOrganization('org-b', 'Beta Org');
/** Organization-administration endpoints a non-admin must never call (AC-002/003). */
const PRIVILEGED = /^\/api\/organizations\/[^/]+\/(settings|integrations|audit|members|invitations|departments)|^\/api\/platform\//;

/** `routes` registers test-specific handlers after the fixture API, so they take precedence. */
async function open(page: Page, options: Partial<TenantApiOptions> & { tab?: string; routes?: () => Promise<unknown>; data?: Record<string, Record<string, unknown[]>> } = {}) {
  const api = createTenantApi({ organizations: [A], ...options });
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) requests.push(`${request.method()} ${url.pathname}`);
  });
  await page.addInitScript(() => localStorage.setItem('auth_session_token', 'settings-fixture'));
  await page.route('**/api/**', async route => {
    if (await fulfillTenantApi(route, api)) return;
    const url = new URL(route.request().url());
    const organizationId = route.request().headers()['x-organization-id'] || '';
    const fixtures: Record<string, unknown> = {
      '/api/init-data': workspaceInit(organizationId, options.data?.[organizationId] ?? {}),
      '/api/documents': { documents: [], total: 0 },
      '/api/activity-logs': [],
    };
    await route.fulfill({ json: fixtures[url.pathname] ?? {} });
  });
  await options.routes?.();
  await page.goto(options.tab ? `/app?tab=${options.tab}` : '/');
  return { api, requests };
}

const sidebar = (page: Page) => page.locator('[data-slot="sidebar-panel"]');
// Organization switcher: moduix Menu with radio items in the sidebar header.
const orgSwitcher = (page: Page) => sidebar(page).locator('button[aria-haspopup="menu"]').first();
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab');

test('AC-001 admin sees one Settings entry and exactly two tabs, with no platform controls', async ({ page }) => {
  const { requests } = await open(page, { roles: { 'org-a': 'admin' } });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = width < 768 ? page.getByRole('dialog') : sidebar(page);
    if (width < 768) await page.getByRole('button', { name: 'Open Navigation Menu', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
    await expect(nav.getByRole('button', { name: /Organization Admin|System Admin/ })).toHaveCount(0);
    // Only the Partners group expands (the redesigned sidebar names the toggle after its group).
    await expect(nav.locator('button[aria-expanded]:not([aria-haspopup])')).toHaveCount(1);
    await expect(nav.locator('button[aria-expanded]:not([aria-haspopup])')).toHaveAccessibleName('Partners');
    await nav.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings / Alpha Org' })).toBeVisible();
    await expect(page.getByText('Role in this organization: Admin')).toBeVisible();
    await expect(tabs(page)).toHaveText(['Organization', 'Members & Access']);
    await expect(page.getByRole('tab', { name: 'Organization', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Gemini|SMTP|SQLite|service account/i)).toHaveCount(0);
    await page.goto('/app?tab=dashboard');
  }
  expect(requests.filter(r => r.includes('/api/platform/') || r.includes('/api/auth-console/'))).toEqual([]);
});

test('AC-002 manager sees only Members & Access and never fetches organization, integration or audit data', async ({ page }) => {
  const { requests } = await open(page, { roles: { 'org-a': 'manager' } });
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/tab=settings-access/);
  await expect(tabs(page)).toHaveText(['Members & Access']);
  await expect(page.getByText('Role in this organization: Manager')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'audit@example.test' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  const departments = page.getByRole('dialog', { name: 'Departments' });
  await expect(departments).toContainText('Legal');
  await expect(departments).not.toContainText('Finance');
  await expect(departments.getByRole('button', { name: /Add|Delete|Rename/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Deep links to admin-only tabs are denied before mount.
  for (const tab of ['settings-organization', 'activity-logs']) {
    await page.goto(`/app?tab=${tab}`);
    await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  }
  expect(requests.filter(r => /\/(settings|integrations\/google|audit)\b/.test(r) || r.includes('/api/platform/'))).toEqual([]);
});

for (const role of ['editor', 'viewer'] as const) {
  test(`AC-003 ${role} has no Settings entry; deep links show access denied without privileged requests`, async ({ page }) => {
    const { requests } = await open(page, { roles: { 'org-a': role } });
    await expect(sidebar(page).getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^(Settings|System Admin|Import Data)$/ })).toHaveCount(0);
    for (const tab of ['settings-organization', 'settings-access', 'settings-integrations', 'settings', 'admin-organization-users', 'admin-system-settings']) {
      await page.goto(`/app?tab=${tab}`);
      await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Settings sections' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Go to an allowed page', exact: true }).click();
      await expect(page).toHaveURL(/tab=dashboard/);
    }
    expect(requests.filter(r => PRIVILEGED.test(r.split(' ')[1]))).toEqual([]);
  });
}

test('AC-025 capability failure shows Retry with no inferred privileges; empty capabilities stay empty', async ({ page }) => {
  let failing = true;
  const { requests } = await open(page, {
    roles: { 'org-a': 'admin' }, tab: 'settings-organization',
    routes: () => page.route('**/api/organizations/*/capabilities', async route => {
      if (failing) await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE', message: 'Try again', requestId: 'fixture' } });
      else await route.fallback();
    }),
  });
  await expect(page.getByRole('heading', { name: 'Your access could not be checked' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toHaveCount(0);
  await expect(sidebar(page).getByRole('button', { name: /^(Settings|Import Data|My Documents)$/ })).toHaveCount(0);
  expect(requests.filter(r => PRIVILEGED.test(r.split(' ')[1]) || r.endsWith('/api/init-data'))).toEqual([]);
  failing = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(tabs(page)).toHaveText(['Organization', 'Members & Access']);

  // An empty permission list is not an error and grants nothing.
  await page.route('**/api/organizations/*/capabilities', route => route.fulfill({ json: {
    organizationId: 'org-a', accessMode: 'membership', membershipId: 'm-org-a', tenantRole: 'viewer', departmentIds: [], permissions: [], assignableTenantRoles: [],
  } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
});

test('AC-027 unsaved Organization changes ask Stay or Discard before leaving a tab or organization', async ({ page }) => {
  const { requests } = await open(page, { organizations: [A, B], roles: { 'org-a': 'admin', 'org-b': 'viewer' }, sessionDefault: 'org-a', tab: 'settings-organization' });
  const name = page.getByLabel('Organization name');
  await name.fill('Alpha Org renamed');
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Unsaved changes');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Organization', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(name).toHaveValue('Alpha Org renamed');

  // Switching organization asks too; Stay keeps the selection and the draft.
  await orgSwitcher(page).click();
  await page.getByRole('menu').getByRole('menuitemradio', { name: /Beta Org/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings / Alpha Org' })).toBeVisible();
  await expect(name).toHaveValue('Alpha Org renamed');

  await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Members & Access', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Organization', exact: true }).click();
  await expect(page.getByLabel('Organization name')).toHaveValue('Alpha Org');
  expect(requests.filter(r => r.startsWith('PATCH '))).toEqual([]);
});

test('AC-039 legacy aliases map to canonical tabs with replaceState; Back/Forward never show a duplicate screen', async ({ page }) => {
  await open(page, { roles: { 'org-a': 'admin' }, tab: 'dashboard' });
  const cases: Array<[string, string, string | null]> = [
    ['settings', 'settings-organization', null],
    ['settings-region', 'settings-organization', null],
    ['settings-notifications', 'settings-organization', null],
    ['settings-google', 'settings-organization', null],
    ['settings-integrations', 'settings-organization', null],
    ['admin-organization-users', 'settings-access', null],
    ['admin-organization-teams', 'settings-access', 'Departments'],
    ['admin-organization-invitations', 'settings-access', null],
    ['activity-logs', 'settings-access', 'History'],
    ['admin-users', 'settings-access', null],
  ];
  for (const [alias, target, dialog] of cases) {
    await page.goto(`/app?tab=${alias}&keep=1#frag`);
    await expect(page).toHaveURL(new RegExp(`/app\\?tab=${target}&keep=1#frag$`));
    if (dialog) {
      await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-controls', new RegExp(target));
    if (alias === 'admin-organization-invitations') await expect(page.getByText('No pending invitations.')).toBeVisible();
  }
  for (const rejected of ['settings-ai', 'settings-security', 'settings-language', 'settings-unknown', 'admin-organization-x', 'admin-system-users']) {
    await page.goto(`/app?tab=${rejected}`);
    await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  }

  // History: the alias entry was replaced, so Back returns to the previous real page.
  await page.goto('/app?tab=dashboard');
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Organization', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/tab=dashboard/);
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Organization', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('AC-039 manager aliases resolve to Members & Access or a denial, never a transient admin tab', async ({ page }) => {
  const { requests } = await open(page, { roles: { 'org-a': 'manager' }, tab: 'settings-region' });
  await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  await page.goto('/app?tab=admin-organization-dashboard');
  await expect(page).toHaveURL(/tab=settings-access/);
  await expect(tabs(page)).toHaveText(['Members & Access']);
  expect(requests.filter(r => /\/(settings|integrations\/google|audit)\b/.test(r))).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`AC-042 keyboard users move between Settings tabs with arrows and dialogs restore focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { roles: { 'org-a': 'admin' }, tab: 'settings-organization' });
    const organization = page.getByRole('tab', { name: 'Organization', exact: true });
    await expect(organization).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', (await organization.getAttribute('id'))!);
    expect(await organization.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));
    await organization.focus();
    expect(await organization.evaluate(el => getComputedStyle(el).boxShadow !== 'none' || getComputedStyle(el).outlineStyle !== 'none')).toBe(true);
    await page.keyboard.press('ArrowRight');
    const access = page.getByRole('tab', { name: 'Members & Access', exact: true });
    await expect(access).toBeFocused();
    await expect(access).toHaveAttribute('aria-selected', 'true');
    await expect(access).toHaveAttribute('tabindex', '0');
    await expect(organization).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(access).toBeFocused();
    await page.keyboard.press('Home');
    await expect(organization).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(access).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
    for (const name of ['Invite member', 'Departments', 'History']) {
      const trigger = page.getByRole('button', { name, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAccessibleName(/.+/);
      await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}

test('AC-042 loading and save errors are announced accessibly', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await open(page, {
    roles: { 'org-a': 'admin' }, tab: 'settings-organization',
    routes: () => page.route('**/api/organizations/*/settings', async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 409, json: { error: 'VERSION_CONFLICT', message: 'Stale version', requestId: 'fixture' } });
        return;
      }
      await held;
      await route.fallback();
    }),
  });
  await expect(page.getByRole('tabpanel').locator('[aria-busy="true"]')).toBeVisible();
  release();
  await page.getByLabel('Organization name').fill('Alpha Org renamed');
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Someone else changed these settings');
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});

test('AC-026 a slow response for the previous organization never overwrites the newly selected one', async ({ page }) => {
  let releaseA = () => {};
  const heldA = new Promise<void>(resolve => { releaseA = resolve; });
  let aServed = false;
  await open(page, {
    organizations: [A, B], roles: { 'org-a': 'admin', 'org-b': 'admin' }, sessionDefault: 'org-a', tab: 'partners',
    data: {
      'org-a': { partners: [{ partner_id: 'pa', nama_partner: 'Alpha Only Partner', organizationId: 'org-a' }] },
      'org-b': { partners: [{ partner_id: 'pb', nama_partner: 'Beta Only Partner', organizationId: 'org-b' }] },
    },
    routes: () => page.route('**/api/init-data', async route => {
      if (route.request().headers()['x-organization-id'] === 'org-a') {
        await heldA;
        aServed = true;
      }
      await route.fallback().catch(() => {}); // the app may already have aborted it
    }),
  });
  await expect(orgSwitcher(page)).toContainText('Alpha Org');
  await orgSwitcher(page).click();
  await page.getByRole('menu').getByRole('menuitemradio', { name: /Beta Org/ }).click();
  await expect(page.locator('main').getByText('Beta Only Partner').first()).toBeVisible();
  releaseA();
  await expect.poll(() => aServed).toBe(true);
  await page.waitForTimeout(500);
  await expect(page.getByText('Alpha Only Partner')).toHaveCount(0);
  await expect(page.locator('main').getByText('Beta Only Partner').first()).toBeVisible();
});

test('AC-034 language and theme preferences belong to the identity, not the browser', async ({ page }) => {
  const { api } = await open(page, { roles: { 'org-a': 'admin' } });
  await page.getByRole('button', { name: 'Switch Language', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitemradio', { name: 'Bahasa Indonesia' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await page.getByRole('button', { name: /Mode Gelap|Dark Mode/i }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => ({
    language: localStorage.getItem('user:fixture-user:language'), theme: localStorage.getItem('user:fixture-user:theme'),
    legacyLanguage: localStorage.getItem('app_language'), legacyTheme: localStorage.getItem('app_theme'),
  }))).toEqual({ language: 'ID', theme: 'dark', legacyLanguage: null, legacyTheme: null });

  // Another identity in the same browser keeps the product defaults and bundled texts.
  api.state.userId = 'fixture-other-user';
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();

  api.state.userId = undefined;
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.locator('html')).toHaveClass(/dark/);
});
