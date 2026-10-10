import { test, expect } from '@playwright/test';
import { api, signIn } from './isolated/state';

test('System Admin text edits, CSV imports and reset reach a different user without reloading', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const viewer = await viewerContext.newPage();
  const token = await signIn(admin, 'super');
  await signIn(viewer, 'viewerA', 'org-a');
  const reset = () => api(token, '/api/platform/configuration', { method: 'PATCH', body: { section: 'uiTexts', values: { reset: true } } });
  await reset();
  try {
    await viewer.goto('/app?tab=dashboard');
    await expect(viewer.getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();
    await admin.goto('/app?tab=admin-system-ui-texts');
    await expect(admin.getByText(/Text changes are saved on the server/)).toBeVisible();
    await admin.getByRole('button', { name: 'Open UI Text Editor', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByPlaceholder(/Search/).fill('nav.dashboard');
    const row = dialog.getByRole('row').filter({ hasText: 'nav.dashboard' });
    await row.getByRole('button', { name: 'Edit in English', exact: true }).click();
    await row.getByRole('textbox').fill('Shared home');
    await admin.route('**/api/platform/configuration', route => route.fulfill({ status: 500, json: { error: 'test-save-failure' } }));
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('Could not save shared texts');
    await expect(row.getByRole('textbox')).toHaveValue('Shared home');
    await expect(viewer.getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible();
    await admin.unroute('**/api/platform/configuration');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('status').filter({ hasText: /was updated/ })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Shared home', exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await viewer.evaluate(() => Object.keys(localStorage).filter(key => key.endsWith(':customTranslations')))).toEqual([]);
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'ui-texts.csv', mimeType: 'text/csv',
      buffer: Buffer.from('Key,Module,Bahasa_Indonesia,English,Chinese_简体中文\nnav.dashboard,nav,,Shared CSV home,\n'),
    });
    await expect(viewer.getByRole('button', { name: 'Shared CSV home', exact: true })).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Restore Defaults', exact: true }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Main Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await reset();
    await adminContext.close();
    await viewerContext.close();
  }
});
