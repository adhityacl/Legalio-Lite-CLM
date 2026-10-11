import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { api, ids, signIn, testDb } from './isolated/state';
import { IsolatedServer } from '../tenant-boundaries/harness';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  if (process.env.SYS_COVERAGE_DIR) await page.coverage.startJSCoverage({ resetOnNavigation: false });
});
test.afterEach(async ({ page }, testInfo) => {
  if (process.env.SYS_COVERAGE_DIR) {
    mkdirSync(process.env.SYS_COVERAGE_DIR, { recursive: true });
    writeFileSync(join(process.env.SYS_COVERAGE_DIR, `${testInfo.testId}.json`), JSON.stringify(await page.coverage.stopJSCoverage()));
  }
});

async function login(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('console-password-9');
  await page.getByRole('button', { name: /^Sign in$/i }).click();
}

test('fresh browser logs in at /sys with no workspace frontend and preserves the requested tab', async ({ page }) => {
  await page.goto('/sys?tab=admin-system-users');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Switch Language', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Register/ })).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('super@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await login(page, 'super@example.test');
  await expect(page.getByRole('navigation', { name: 'ADMIN NAVIGATION' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'super@example.test' })).toBeVisible();
  await expect(page).toHaveURL(/\/sys\?tab=admin-system-users$/);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'super@example.test' })).toBeVisible();
  await page.getByRole('button', { name: 'User Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sign in$/i })).toBeVisible();
  const workspace = await page.request.get('/app?tab=contracts');
  expect(workspace.status()).toBe(404); // backend is running API_ONLY=true, no Vite/preview
});

test('ordinary account is denied by both the console and its APIs', async ({ page }) => {
  await page.goto('/sys');
  await login(page, 'nomember@example.test');
  await expect(page.getByRole('heading', { name: 'System Console access denied' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'ADMIN NAVIGATION' })).toHaveCount(0);
  const token = await page.evaluate(() => localStorage.getItem('auth_session_token'));
  expect((await api(token!, '/api/auth-console/users')).status).toBe(403);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Sign in$/i })).toBeVisible();
});

test('superuser without membership navigates all tabs, supports history, mobile, theme and language', async ({ page }, testInfo) => {
  await signIn(page, 'super');
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/sys?tab=unknown');
  await expect(page).toHaveURL(/tab=admin-system-dashboard$/);
  const nav = page.getByRole('navigation', { name: 'ADMIN NAVIGATION' });
  await expect(nav).toBeVisible();
  // Reuse the approved grouped sidebar entries and the existing content tabs.
  for (const name of ['Dashboard', 'Google & storage', 'AI Model & Parser', 'SMTP relay', 'UI texts', 'Backup & Restore', 'Database & reset']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#sys-content')).not.toBeEmpty();
    await expect(page.locator('#sys-content')).not.toContainText('Select an organization');
    await expect(page.locator('#sys-content [role="status"]').filter({ hasText: 'Loading…' })).toHaveCount(0);
  }
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('tab', { name: /^Users/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'super@example.test' })).toBeVisible();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  await page.goBack();
  await expect(page).toHaveURL(/tab=admin-system-users$/);
  await page.goForward();
  await expect(page).toHaveURL(/tab=admin-system-sessions$/);
  await page.goto('/sys?tab=admin-system-accounts');
  await expect(page.locator('#sys-content')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Switch to Dark Mode', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Switch Language', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Bahasa Indonesia/ }).click();
  await expect(page.getByRole('navigation', { name: 'NAVIGASI ADMIN' })).toContainText('Admin Sistem');
  await page.getByRole('button', { name: 'Ganti Bahasa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /English/ }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  const menu = page.getByRole('button', { name: 'Open Navigation Menu', exact: true });
  await menu.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await drawer.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sys-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(requests.filter((url) => /\/api\/tenants|\/api\/me\/active-organization|\/api\/organizations\/[^/]+\/(policy|capabilities)|\/api\/contracts|\/api\/partners/.test(url))).toEqual([]);
  expect(requests.filter((url) => /\/src\/|\/assets\/(?!.*\/sys\/)/.test(url) && !url.includes('/sys/assets/'))).toEqual([]);
});

test('manual approval works inside /sys without email verification', async ({ page }) => {
  const db = testDb();
  db.prepare("UPDATE user SET banned = 1, banReason = 'PENDING_APPROVAL', emailVerified = 0 WHERE id = ?").run(ids().unverified);
  db.close();
  try {
    await signIn(page, 'super');
    await page.goto('/sys?tab=admin-system-users');
    const row = page.getByRole('row').filter({ hasText: 'unverified@example.test' });
    await expect(row).toContainText('Pending approval');
    await row.getByRole('button', { name: 'Approve account of User unverified', exact: true }).click();
    await expect(row).toContainText('Active');
    const checked = testDb();
    try { expect(checked.prepare('SELECT banned, emailVerified FROM user WHERE id = ?').get(ids().unverified)).toEqual({ banned: 0, emailVerified: 0 }); }
    finally { checked.close(); }
  } finally { const db = testDb(); db.prepare('UPDATE user SET banned = 0 WHERE id = ?').run(ids().unverified); db.close(); }
});

test('legacy links redirect and organization management opens the selected workspace in a new tab', async ({ page }) => {
  await signIn(page, 'super');
  await page.goto('/app?tab=admin-system-organizations');
  await expect(page).toHaveURL(/\/sys\?tab=admin-system-organizations$/);
  await expect(page.getByRole('button', { name: 'Manage organization', exact: true }).first()).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Manage organization', exact: true }).first().click();
  const workspace = await popupPromise;
  await expect(workspace).toHaveURL(/\/app\?tab=settings-organization$/);
  await expect(page).toHaveURL(/\/sys\?tab=admin-system-organizations$/);
  expect(await workspace.evaluate(() => window.opener)).toBeNull();
  expect(await workspace.evaluate((id) => sessionStorage.getItem(`activeOrganizationId:${id}`), ids().super)).toBe(ids().orgA);
  expect(await page.evaluate((id) => sessionStorage.getItem(`activeOrganizationId:${id}`), ids().super)).toBeNull();
  await workspace.close();
});

test('first superuser can be created through /sys on a fresh installation', async ({ page }) => {
  const fresh = await IsolatedServer.start({ systemConsoleDir: resolve('apps/backend/dist/console') });
  try {
    await page.goto(fresh.base + '/sys?tab=admin-system-users');
    await expect(page.getByRole('button', { name: 'Create admin account', exact: true })).toBeVisible();
    await page.getByLabel('Full Name', { exact: true }).fill('First Superuser');
    await page.getByLabel('Email', { exact: true }).fill('first@example.test');
    await page.getByLabel('Password', { exact: true }).fill('console-password-9');
    await page.getByRole('button', { name: 'Create admin account', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'ADMIN NAVIGATION' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'first@example.test' })).toBeVisible();
  } finally { await fresh.stop(); }
});


test('console reuses the approved frontend header and grouped sidebar', async ({ page }, testInfo) => {
  await signIn(page, 'super');
  await page.goto('/sys?tab=admin-system-organizations');
  await expect(page.locator('header')).toBeVisible();
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('button', { name: 'System Admin', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Google & storage', exact: true })).toBeVisible();
  await expect(page.locator('header [data-slot="button-root"]:visible')).toHaveCount(4);
  await expect(page.locator('header select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Organization', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sys-approved-shell.png'), fullPage: true });
});


test('denied organization access closes the new tab and keeps the console open', async ({ page }) => {
  await signIn(page, 'super');
  await page.route('**/api/organizations/*/capabilities', (route) => route.fulfill({ status: 403, json: { error: 'FORBIDDEN' } }));
  await page.goto('/sys?tab=admin-system-organizations');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Manage organization', exact: true }).first().click();
  const workspace = await popupPromise;
  await expect.poll(() => workspace.isClosed()).toBe(true);
  await expect(page).toHaveURL(/\/sys\?tab=admin-system-organizations$/);
  await expect(page.getByText('Organization access denied.', { exact: true })).toBeVisible();
});


test('organization forms omit tagline and editing preserves existing profile data', async ({ page }) => {
  const token = await signIn(page, 'super');
  const orgId = ids().orgA;
  const initial = await api(token, `/api/organizations/${orgId}/settings`);
  expect((await api(token, `/api/organizations/${orgId}/settings`, { method: 'PATCH', body: { expectedVersion: initial.data.version, profile: { tagline: 'Legacy organization tagline' } } })).status).toBe(200);
  try {
    await page.goto('/sys?tab=admin-system-organizations');
    await expect(page.getByRole('heading', { name: 'Alpha Org', exact: true })).toBeVisible();
    await expect(page.getByText('Legacy organization tagline', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Organization', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel(/Tagline|Partnership Type/i)).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const edit = page.getByRole('dialog', { name: 'Edit Organization Profile & Settings' });
    await expect(edit.getByLabel(/Tagline|Partnership Type/i)).toHaveCount(0);
    const savedRequest = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith(`/api/auth-console/organizations/${orgId}`));
    await edit.getByRole('button', { name: 'Save Changes', exact: true }).click();
    expect((await savedRequest).postDataJSON().profile).not.toHaveProperty('tagline');
    await expect(edit).toHaveCount(0);
    const reloaded = await api(token, `/api/organizations/${orgId}/settings`);
    expect(reloaded.data.profile.tagline).toBe('Legacy organization tagline');
  } finally {
    const current = await api(token, `/api/organizations/${orgId}/settings`);
    await api(token, `/api/organizations/${orgId}/settings`, { method: 'PATCH', body: { expectedVersion: current.data.version, profile: { tagline: initial.data.profile.tagline } } });
  }
});

test('backup management creates and downloads a full backup, confirms restore and returns to login', async ({ page }, testInfo) => {
  const fresh = await IsolatedServer.start({ systemConsoleDir: resolve('apps/backend/dist/console') });
  try {
    await page.goto(fresh.base + '/sys?tab=admin-system-backups');
    await page.getByLabel('Full Name', { exact: true }).fill('Backup Admin');
    await page.getByLabel('Email', { exact: true }).fill('backup@example.test');
    await page.getByLabel('Password', { exact: true }).fill('console-password-9');
    await page.getByRole('button', { name: 'Create admin account', exact: true }).click();
    await expect(page.getByRole('navigation')).toContainText('Backup & Restore');
    const uploads = join(fresh.dir, 'data', 'uploads');
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, 'document.txt'), 'before backup');
    await page.getByRole('button', { name: 'Back up now', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Backup created successfully.');
    const row = page.getByRole('row').filter({ hasText: 'Manual' });
    await expect(row).toContainText('Success');
    const downloaded = page.waitForEvent('download');
    await row.getByRole('link', { name: 'Download', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/legalio-backup-.*\.tar\.gz$/);
    await row.getByRole('button', { name: 'Restore', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('backup-management-mobile.png'), fullPage: true });
    writeFileSync(join(uploads, 'document.txt'), 'after backup');
    await row.getByRole('button', { name: 'Restore', exact: true }).click();
    await dialog.getByLabel('Type RESTORE to confirm', { exact: true }).fill('RESTORE');
    const restored = page.waitForResponse((response) => response.url().endsWith('/restore') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    expect((await restored).status()).toBe(202);
    await expect(page.getByRole('status')).toContainText('safety backup created');
    await fresh.kill(); fresh.db.close(); await fresh.launch();
    fresh.db = new Database(join(fresh.dir, 'auth.db'));
    expect(readFileSync(join(uploads, 'document.txt'), 'utf8')).toBe('before backup');
    await page.goto(fresh.base + '/sys?tab=admin-system-backups');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await login(page, 'backup@example.test');
    await expect(page.getByRole('row').filter({ hasText: 'Before restore' })).toBeVisible();
  } finally { await fresh.stop(); }
});

test('design system tokens reach backup controls and portalled dialogs in both themes', async ({ page }, testInfo) => {
  await signIn(page, 'super');
  await page.goto('/sys?tab=admin-system-backups');
  const trigger = page.getByRole('button', { name: 'Restore from file', exact: true });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate(el => getComputedStyle(el).borderRadius)).toBe('8px');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const dark of [false, true]) {
    await page.evaluate((dark) => { document.documentElement.classList.toggle('dark', dark); document.documentElement.dataset.moduixColorScheme = dark ? 'dark' : 'light'; }, dark);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Backup file')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await dialog.getByLabel('Backup file').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('Backup file').setInputFiles({ name: 'example.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from('example') });
    await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
    const colors = await dialog.evaluate(el => ({ actual: getComputedStyle(el).backgroundColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--ds-surface').trim() }));
    expect(colors.expected).toBeTruthy();
    const surface = await page.locator('[data-slot="card-root"]').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(colors.actual).toBe(surface);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: testInfo.outputPath('backup-mobile-dark.png'), fullPage: true });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('system UI text editor traps focus and restores its trigger', async ({ page }) => {
  await signIn(page, 'super');
  await page.goto('/sys?tab=admin-system-ui-texts');
  const trigger = page.getByRole('button', { name: 'Open UI Text Editor', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName(/.+/);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
