import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { api, ids, signIn, testDb } from './isolated/state';

test.beforeEach(async ({ page }) => {
  if (process.env.ONBOARDING_COVERAGE_DIR) await page.coverage.startJSCoverage({ resetOnNavigation: false });
});
test.afterEach(async ({ page }, testInfo) => {
  if (process.env.ONBOARDING_COVERAGE_DIR) writeFileSync(join(process.env.ONBOARDING_COVERAGE_DIR, `browser-${testInfo.testId}.json`), JSON.stringify(await page.coverage.stopJSCoverage()));
});

// Restore the fixture identity so other suites continue testing a user without membership.
async function cleanMembership(token: string) {
  const db = testDb();
  const ownOrgs = db.prepare("SELECT organizationId FROM member WHERE userId = ? AND role = 'admin'").all(ids().nomember) as { organizationId: string }[];
  db.prepare('DELETE FROM teamMember WHERE userId = ?').run(ids().nomember);
  db.prepare('DELETE FROM member WHERE userId = ?').run(ids().nomember);
  db.close();
  for (const { organizationId } of ownOrgs) await api(token, `/api/auth-console/organizations/${organizationId}`, { method: 'DELETE' });
}

test('new user creates an organization in two steps, keeps values on Back, and opens the workspace', async ({ page }, testInfo) => {
  const superToken = await signIn(page, 'super');
  const fixtureDb = testDb();
  fixtureDb.prepare('UPDATE user SET emailVerified = 0 WHERE id = ?').run(ids().nomember);
  fixtureDb.close();
  const token = await signIn(page, 'nomember');
  await page.setViewportSize({ width: 375, height: 812 });
  try {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join organization', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('onboarding-mobile.png') });
    await testInfo.attach('onboarding-mobile', { path: testInfo.outputPath('onboarding-mobile.png'), contentType: 'image/png' });
    await expect(page.getByRole('button', { name: 'Send verification email', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByLabel('Organization name', { exact: true })).toBeVisible();
    await page.getByLabel('Organization name', { exact: true }).fill('Browser Workspace');
    await page.getByLabel('Legal entity', { exact: true }).fill('PT Browser');
    await page.getByLabel('Brand name', { exact: true }).fill('Browser');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Region and formatting', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Browser');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await expect(page.getByLabel('Country', { exact: true })).toBeVisible();
    await page.getByLabel('Country', { exact: true }).selectOption('SG');
    await page.getByLabel('Industry', { exact: true }).selectOption('general');
    await page.getByLabel('Language', { exact: true }).selectOption('EN');
    await page.screenshot({ path: testInfo.outputPath('onboarding-region-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await expect(page.locator('aside')).toContainText('Browser Workspace');
    if (process.env.ONBOARDING_COVERAGE_DIR) {
      writeFileSync(join(process.env.ONBOARDING_COVERAGE_DIR, 'browser-create-before-reload.json'), JSON.stringify(await page.coverage.stopJSCoverage()));
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
    }
    await page.reload();
    await expect(page.locator('aside')).toContainText('Browser Workspace');
    const me = await api(token, '/api/me');
    expect(me.status).toBe(200);
  } finally { await cleanMembership(superToken); }
});

test('join uses an invite code, reports an invalid code, and accepts a matching invitation', async ({ page }) => {
  const admin = await signIn(page, 'adminA');
  const superToken = await signIn(page, 'super');
  await signIn(page, 'nomember');
  const invitation = await api(admin, '/api/organizations/org-a/invitations', { method: 'POST', body: { email: 'nomember@example.test', tenantRole: 'viewer', departmentIds: ['team-a-legal'] } });
  expect(invitation.status).toBe(201);
  try {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Join organization', exact: true }).click();
    await page.getByLabel('Invite code', { exact: true }).fill('invalid-code');
    await page.getByRole('button', { name: 'Join organization', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Invite code', { exact: true }).fill(invitation.data.invitation.id);
    await page.getByRole('button', { name: 'Join organization', exact: true }).click();
    await expect(page.locator('aside')).toContainText('Alpha Org');
  } finally { await cleanMembership(superToken); }
});

test('admin generates a 24-hour code and an approved user joins without email verification', async ({ page }) => {
  await signIn(page, 'adminA', 'org-a');
  await page.goto('/app?tab=settings-access');
  await page.getByRole('button', { name: 'Generate invite code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate invite code', exact: true });
  await expect(dialog.getByLabel('Email', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Legal', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Generate invite code', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Invite code created', exact: true });
  const code = await result.getByLabel('Invite code', { exact: true }).inputValue();
  expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
  await expect(result).toContainText('24 hours');
  await expect(result.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  await signIn(page, 'unverified');
  try {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Join organization', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send verification email', exact: true })).toHaveCount(0);
    await page.getByLabel('Invite code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Join organization', exact: true }).click();
    await expect(page.locator('aside')).toContainText('Alpha Org');
  } finally {
    const db = testDb();
    db.prepare('DELETE FROM teamMember WHERE userId = ?').run(ids().unverified);
    db.prepare('DELETE FROM member WHERE userId = ?').run(ids().unverified);
    db.close();
  }
});

test('superuser approves a pending account from the account table without verifying email', async ({ page }) => {
  const db = testDb();
  db.prepare("UPDATE user SET banned = 1, banReason = 'PENDING_APPROVAL' WHERE id = ?").run(ids().unverified);
  db.close();
  await signIn(page, 'super');
  await page.goto('/app?tab=admin-system-users');
  const row = page.getByRole('row').filter({ hasText: 'unverified@example.test' });
  await expect(row).toContainText('Pending approval');
  await row.getByRole('button', { name: 'Approve account of User unverified', exact: true }).click();
  await expect(row).toContainText('Active');
  const checked = testDb();
  try {
    const user = checked.prepare('SELECT banned, emailVerified FROM user WHERE id = ?').get(ids().unverified) as any;
    expect(user).toEqual({ banned: 0, emailVerified: 0 });
  } finally { checked.close(); }
});
