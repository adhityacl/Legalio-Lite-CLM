import { test, expect, type Page } from '@playwright/test';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { createTenantApi, fulfillTenantApi, workspaceInit } from './fixtures/tenantApi';

const invoice = { name: 'invoice.png', mimeType: 'image/png', buffer: Buffer.from('same invoice attachment') };
const allocationRows = (amount = 100) => [{ month: '2026-10', amount }];

async function setup(page: Page, modern = false) {
  const data = buildDemoDataset();
  const tenant = data.tenants[0];
  const partner = data.partners.find(row => row.organizationId === tenant.id)!;
  const spending = { ...data.spendings.find(row => row.organizationId === tenant.id)!, vendor_id: partner.partner_id, vendor_name: partner.nama_partner,
    invoice_number: 'EDIT-INV', invoice_date: '2026-09-29', invoice_month: ['102026', '112026'],
    invoice_title: 'Stored title', invoice_description: 'Stored description', currency: 'USD', total_amount: 100,
    bank_name: 'Known bank', bank_account_number: '001234', bank_account_holder_name: 'Known holder',
    invoice_file_url: '/uploads/existing-invoice.pdf', invoice_file_name: 'existing-invoice.pdf', billing_file_url: '/uploads/existing-billing.pdf', billing_file_name: 'existing-billing.pdf',
    ...(modern ? { month_allocations: allocationRows() } : {}),
  };
  data.spendings = [spending];
  const settings = { ...tenant.settings, modules: { ...tenant.settings.modules, newsTicker: true } };
  await page.addInitScript(() => { localStorage.setItem('auth_session_token', 'spending-fixture'); localStorage.setItem('user:fixture-user:language', 'EN'); });
  const api = createTenantApi({ organizations: [{ ...tenant, settings }] });
  await page.route('**/api/**', async route => {
    if (await fulfillTenantApi(route, api)) return;
    const path = new URL(route.request().url()).pathname;
    const fixtures: Record<string, unknown> = {
      '/api/init-data': workspaceInit(tenant.id, data),
      '/api/documents': { documents: [], total: 0 }, '/api/activity-logs': [],
      '/api/dashboard/news-ticker': { items: ['Spending fixture ready'] },
      '/api/exchange-rates': { USD: 1, IDR: 0.0001 }, '/api/exchange-rate-historical': { rate: 0.0001 },
    };
    if (/^\/api\/partner-spendings/.test(path) && ['POST', 'PUT'].includes(route.request().method())) {
      const payload = route.request().postDataJSON();
      data.spendings = [{ ...spending, ...payload }];
      await route.fulfill({ json: { success: true, spending: data.spendings[0] } });
    } else await route.fulfill({ json: fixtures[path] ?? {} });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Latest Regulatory Updates' }).getByRole('listitem').filter({ hasText: 'Spending fixture ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Partners', exact: true }).click();
  await page.getByRole('button', { name: 'Partner Spending', exact: true }).click();
  return { partner, spending };
}

async function openAdd(page: Page) {
  await page.getByRole('button', { name: /Input Spending|Add Spending|Input Data Spending/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openEdit(page: Page) {
  const row = page.getByRole('row').filter({ hasText: 'EDIT-INV' });
  await row.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Edit/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Add saves title, description, vendor ID, rounded months and the same invoice parsed by AI', async ({ page }) => {
  const { partner } = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const dialog = await openAdd(page);
  await expect(dialog.locator('input[type=file]')).toHaveCount(2);
  await expect(dialog.getByText('Primary Invoice Month', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Partner Name').selectOption(partner.partner_id);
  await expect(dialog.getByLabel('Bank Name', { exact: true })).toHaveValue('Known bank');
  await dialog.getByLabel('Bank Name', { exact: true }).fill('Manual bank');
  await dialog.getByLabel('Partner Name').selectOption('');
  await dialog.getByLabel('Partner Name').selectOption(partner.partner_id);
  await expect(dialog.getByLabel('Bank Name', { exact: true })).toHaveValue('Manual bank');
  await page.route('**/api/spendings/parse', route => route.fulfill({ json: { success: true, data: { invoice_number: 'AI-INV', invoice_date: '2026-09-29', invoice_title: 'Q4 retainer', invoice_description: 'AI line items', currency: 'USD', total_amount: 100, spending_months: ['2026-10', '2026-11', '2026-12'] } } }));
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles(invoice);
  const parseRequest = page.waitForRequest(request => request.url().endsWith('/api/spendings/parse'));
  await dialog.getByRole('button', { name: 'Parse File' }).click();
  expect((await parseRequest).postDataBuffer()!.toString()).toContain('same invoice attachment');
  await expect(dialog.getByLabel('Invoice Title')).toHaveValue('Q4 retainer');
  await expect(dialog.getByLabel('Spending Month 1', { exact: true })).toHaveValue('2026-10');
  await expect(dialog.getByRole('button', { name: 'Save Spending', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Split Equally' }).click();
  await expect(dialog.getByLabel('Allocated Amount 3', { exact: false })).toHaveValue('33.34');
  await dialog.locator('fieldset').evaluate(element => element.parentElement!.scrollTop = 0);
  await page.screenshot({ path: '/tmp/spending-form-desktop.png', fullPage: true });
  await dialog.getByLabel('Upload Invoice', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/spending-uploader-desktop.png', fullPage: true });
  const requestPromise = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/partner-spendings'));
  await dialog.getByRole('button', { name: 'Save Spending', exact: true }).click();
  const payload = (await requestPromise).postDataJSON();
  expect(payload).toMatchObject({ vendor_id: partner.partner_id, invoice_title: 'Q4 retainer', invoice_description: 'AI line items', invoice_date: '2026-09-29', currency: 'USD', total_amount: 100, total_amount_usd: 100 });
  expect(payload.invoice_month).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
  expect(payload.month_allocations.map((row: any) => row.amount)).toEqual([33.33, 33.33, 33.34]);
  expect(payload.invoice_file.fileData).toBe(`data:image/png;base64,${invoice.buffer.toString('base64')}`);
  await expect(dialog).toBeHidden();
});

test('upload triggers open the native file chooser, label the input and accept the same file again', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const dialog = await openAdd(page);
  const invoiceDrop = dialog.getByRole('button', { name: 'Invoice drop zone', exact: true });
  await expect(invoiceDrop).toBeVisible();
  await expect(invoiceDrop.getByRole('button')).toHaveCount(1); // only the zag-managed trigger is nested
  const chooser = page.waitForEvent('filechooser');
  await invoiceDrop.getByRole('button', { name: 'Choose file', exact: true }).click();
  await (await chooser).setFiles(invoice);
  await expect(dialog.getByText('invoice.png', { exact: true })).toBeVisible();
  const billingChooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Billing drop zone', exact: true }).getByRole('button', { name: 'Choose file', exact: true }).click();
  await (await billingChooser).setFiles({ name: 'billing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('billing') });
  await expect(dialog.getByText('billing.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Upload Invoice', { exact: true })).toHaveAttribute('type', 'file');
  // Re-picking the identical file (zag would report FILE_EXISTS) still replaces the selection.
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles({ ...invoice, name: 'other.png' });
  await expect(dialog.getByText('other.png', { exact: true })).toBeVisible();
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles(invoice);
  await expect(dialog.getByText('invoice.png', { exact: true })).toBeVisible();
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles(invoice);
  await expect(dialog.getByText('invoice.png', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Parse File' })).toBeVisible();
});

test('saved unequal June and July allocations appear in the dashboard with year filtering', async ({ page }) => {
  await setup(page, true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const dialog = await openEdit(page);
  await dialog.getByLabel('Spending Month 1', { exact: true }).fill('2026-06');
  await dialog.getByLabel('Allocated Amount 1', { exact: false }).fill('25');
  await dialog.getByRole('button', { name: 'Add Month', exact: true }).click();
  await dialog.getByLabel('Spending Month 2', { exact: true }).fill('2026-07');
  await dialog.getByLabel('Allocated Amount 2', { exact: false }).fill('75');
  await dialog.getByRole('button', { name: 'Save Spending', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Main Dashboard', exact: true }).click();

  const chart = page.getByRole('region', { name: 'Spending Trend', exact: true });
  const year = page.getByRole('combobox', { name: 'Year', exact: true });
  await year.selectOption('2026');
  await expect(chart).toBeVisible();
  const checkMonth = async (index: number, month: string, amount: number) => {
    await chart.locator('.recharts-bar-rectangle').nth(index).hover();
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(month);
    await expect(tooltip).toContainText(new RegExp(`USD\\s*${amount}`));
  };
  await checkMonth(0, 'Jun', 25);
  await checkMonth(1, 'Jul', 75);

  await page.getByRole('button', { name: 'Partner Spending', exact: true }).click();
  const edit = await openEdit(page);
  await edit.getByLabel('Spending Month 2', { exact: true }).fill('2025-07');
  await edit.getByRole('button', { name: 'Save Spending', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.getByRole('button', { name: 'Main Dashboard', exact: true }).click();
  await year.selectOption('2025');
  await checkMonth(0, 'Jul', 75);
  await year.selectOption('2026');
  await checkMonth(0, 'Jun', 25);
  await year.selectOption('ALL');
  await checkMonth(0, 'Jun', 25);
  await checkMonth(1, 'Jul', 75);
});

test('allocation blocks duplicate, missing, negative, under and over allocation; conversion updates', async ({ page }) => {
  const { partner } = await setup(page);
  const dialog = await openAdd(page);
  await dialog.getByLabel('Partner Name').selectOption(partner.partner_id);
  await dialog.getByLabel('Invoice Number').fill('VALIDATE');
  await dialog.getByLabel('Currency', { exact: true }).selectOption('USD');
  await dialog.getByLabel('Total Amount').fill('100');
  const save = dialog.getByRole('button', { name: 'Save Spending', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add Month', exact: true }).click();
  await dialog.getByLabel('Spending Month 1', { exact: true }).fill('2026-10');
  const amount = dialog.getByLabel('Allocated Amount 1', { exact: false });
  for (const [value, message] of [['-1', 'non-negative'], ['90', 'Remaining to allocate'], ['110', 'Over allocated by']]) {
    await amount.fill(value);
    await expect(dialog.locator('#spending-allocation-status')).toContainText(message);
    await expect(save).toBeDisabled();
  }
  await amount.fill('100');
  await expect(save).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add Month', exact: true }).click();
  await dialog.getByLabel('Spending Month 2', { exact: true }).fill('2026-10');
  await expect(dialog.locator('#spending-allocation-status')).toContainText('unique');
  await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'Delete spending month 2' }).click();
  await dialog.getByLabel('Currency', { exact: true }).selectOption('IDR');
  await expect(dialog.getByText('USD 0.01', { exact: true })).toBeVisible();
  await dialog.getByLabel('Total Amount').fill('200');
  await expect(dialog.getByText('USD 0.02', { exact: true })).toBeVisible();
});

for (const modern of [false, true]) test(`Edit hydrates ${modern ? 'new allocations' : 'legacy months'} and preserves both attachments`, async ({ page }) => {
  await setup(page, modern);
  const dialog = await openEdit(page);
  await expect(dialog.getByLabel('Invoice Title')).toHaveValue('Stored title');
  await expect(dialog.getByLabel('Invoice Description')).toHaveValue('Stored description');
  await expect(dialog.getByLabel('Bank Name', { exact: true })).toHaveValue('Known bank');
  await expect(dialog.getByRole('link', { name: 'existing-invoice.pdf' })).toHaveAttribute('href', '/uploads/existing-invoice.pdf');
  await expect(dialog.getByRole('link', { name: 'existing-billing.pdf' })).toHaveAttribute('href', '/uploads/existing-billing.pdf');
  const save = dialog.getByRole('button', { name: 'Save Spending', exact: true });
  if (!modern) {
    await expect(dialog.getByLabel('Allocated Amount 1', { exact: false })).toHaveValue('');
    await expect(save).toBeDisabled();
    await dialog.getByRole('button', { name: 'Split Equally' }).click();
  }
  await expect(save).toBeEnabled();
  await dialog.getByLabel('Invoice Title').fill('Updated title');
  const requestPromise = page.waitForRequest(request => request.method() === 'PUT' && /\/api\/partner-spendings\//.test(request.url()));
  await save.click();
  const payload = (await requestPromise).postDataJSON();
  expect(payload.invoice_title).toBe('Updated title');
  expect(payload.invoice_description).toBe('Stored description');
  expect(payload).not.toHaveProperty('invoice_file');
  expect(payload).not.toHaveProperty('billing_file');
  expect(payload.month_allocations).toEqual(modern ? allocationRows() : [{ month: '2026-10', amount: 50 }, { month: '2026-11', amount: 50 }]);
  await expect(dialog).toBeHidden();
  await openEdit(page);
  await expect(page.getByLabel('Invoice Title')).toHaveValue('Updated title');
  await expect(page.getByRole('link', { name: 'existing-invoice.pdf' })).toBeVisible();
});

test('AI date without service period leaves months empty, file limit and parse errors retain attachment', async ({ page }) => {
  await setup(page);
  const dialog = await openAdd(page);
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles({ ...invoice, buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(dialog.getByRole('alert')).toContainText('20 MB');
  await expect(dialog.getByRole('button', { name: 'Parse File' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add Month', exact: true }).click();
  await dialog.getByLabel('Spending Month 1', { exact: true }).fill('2026-10');
  await dialog.getByLabel('Upload Invoice', { exact: true }).setInputFiles(invoice);
  await page.route('**/api/spendings/parse', route => route.fulfill({ status: 503, json: { error: 'Parser unavailable' } }));
  await dialog.getByRole('button', { name: 'Parse File' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Parser unavailable');
  await expect(dialog.getByText('invoice.png', { exact: true })).toBeVisible();
  await page.route('**/api/spendings/parse', route => route.fulfill({ json: { success: true, data: { invoice_date: '2026-09-29', invoice_month: '2026-09' } } }));
  await dialog.getByRole('button', { name: 'Parse File' }).click();
  await expect(dialog.getByText('Invoice data filled by AI. Review before saving.')).toBeVisible();
  await expect(dialog.locator('input[type=month]')).toHaveCount(0);
  await expect(dialog.getByText('invoice.png', { exact: true })).toBeVisible();
});

test('mobile/dark form has no overflow and keyboard focus returns to the trigger', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const dialog = await openAdd(page);
  await dialog.getByRole('button', { name: 'Add Month', exact: true }).click();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const inputs = dialog.locator('input, select, textarea');
  for (const input of await inputs.all()) {
    const fits = await input.evaluate(element => { const r = element.getBoundingClientRect(); const d = element.closest('[role=dialog]')!.getBoundingClientRect(); return r.left >= d.left && r.right <= d.right; });
    expect(fits).toBe(true);
  }
  await page.screenshot({ path: '/tmp/spending-form-mobile-dark.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Input Spending|Add Spending|Input Data Spending/i })).toBeFocused();
});


test('save failure retains form and attachments for retry', async ({ page }) => {
  await setup(page, true);
  const dialog = await openEdit(page);
  await dialog.getByLabel('Upload Billing', { exact: true }).setInputFiles({ name: 'billing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('replacement billing') });
  await page.route('**/api/partner-spendings/*', route => route.fulfill({ status: 503, json: { error: 'Save temporarily unavailable' } }));
  await dialog.getByRole('button', { name: 'Save Spending', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Save temporarily unavailable');
  await expect(dialog.getByLabel('Invoice Title')).toHaveValue('Stored title');
  await expect(dialog.getByText('billing.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save Spending', exact: true })).toBeEnabled();
});
