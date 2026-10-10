/**
 * Sidebar administration entries match server authority (live, isolated server).
 *
 * Tenant-boundaries PRD §4.5 / §6.1: one tenant **Settings** entry (admin and
 * manager only; manager sees Members & Access), **System Admin** for the
 * platform superuser only, and no Organization Admin parent for anyone.
 * Sessions come from tests/e2e/seed.ts, which only writes to the isolated
 * temporary database.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedRoleSessions, cleanupRoleSessions, type SeededRole } from './seed';

let seeded: SeededRole[];

test.beforeAll(() => {
  seeded = seedRoleSessions();
});

test.afterAll(() => {
  cleanupRoleSessions();
});

async function loginAs(page: Page, role: SeededRole['role']) {
  const entry = seeded.find((s) => s.role === role);
  if (!entry) throw new Error(`No seeded session for role "${role}"`);
  // AuthContext reads `auth_session_token` and sends it as a Bearer header.
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth_session_token', token);
  }, entry.token);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

const SYSTEM_ADMIN = 'System Admin';
const SETTINGS = 'Settings';
const ORG_ADMIN = /Organization Admin|Admin Organisasi/;

// Desktop admin-section landmark (Sidebar.tsx `nav.admin_title`).
function adminNavSection(page: Page) {
  return page.getByRole('navigation', { name: /^(ADMIN NAVIGATION|NAVIGASI ADMIN)$/ });
}

test.describe('Sidebar administration entries match server authority', () => {
  test('Superuser sees System Admin and lands on the platform dashboard', async ({ page }) => {
    await loginAs(page, 'superuser');
    await expect(page).toHaveURL(/tab=admin-system-dashboard/);
    await expect(adminNavSection(page)).toBeVisible();
    await expect(page.getByRole('button', { name: ORG_ADMIN })).toHaveCount(0);
  });

  for (const role of ['admin', 'manager'] as const) {
    test(`${role} sees one Settings entry and no System Admin`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page).toHaveURL(/tab=dashboard/);
      await expect(adminNavSection(page).getByRole('button', { name: SETTINGS, exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: SYSTEM_ADMIN, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: ORG_ADMIN })).toHaveCount(0);
    });
  }

  for (const role of ['editor', 'viewer'] as const) {
    test(`${role} sees neither Settings nor System Admin`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page).toHaveURL(/tab=dashboard/);
      await expect(page.getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: SYSTEM_ADMIN, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: SETTINGS, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: ORG_ADMIN })).toHaveCount(0);
    });
  }
});

test.describe('Viewer write actions (UI side)', () => {
  test('Viewer deep link to the document workspace is denied with no create control', async ({ page }) => {
    await loginAs(page, 'viewer');
    await page.goto('/app?tab=create-contract');
    await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Document|simpan|buat kontrak|tambah/i })).toHaveCount(0);
  });
});
