import { test, expect, type Page } from '@playwright/test';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { createTenantApi, fulfillTenantApi } from './fixtures/tenantApi';
import type { Contract, InsertionOrder, Partner, Tenant, TenantSettings } from '@legalio/types';
import { contractLifecycle } from '@legalio/shared/contractLifecycle';

async function installCalendarFixtures(page: Page, options: { viewer?: boolean; blocked?: boolean; failing?: boolean; commercial?: boolean; expired?: boolean; language?: 'ID' | 'EN' | 'ZH' } = {}) {
  const data = buildDemoDataset();
  const tenant = data.tenants[0] as Tenant & { settings: TenantSettings };
  const legal: Partner = { ...data.partners[0] as Partner, pic_internal: 'Legal', internal_pic: 'Legal' };
  const finance = { ...legal, partner_id: 'calendar-finance', nama_partner: 'Finance Restricted', pic_internal: 'Finance', internal_pic: 'Finance' };
  const contracts: Contract[] = Array.from({ length: 8 }, (_, index) => ({ ...data.contracts[0] as Contract, organizationId: tenant.id,
    contract_id: `calendar-${index}`, nomor_kontrak: `CAL-${index}`, judul_kontrak: `Calendar Agreement ${String(index + 1).padStart(2, '0')}`,
    partner_id: legal.partner_id, partner_nama: legal.nama_partner, tanggal_mulai: '2026-06-12', tanggal_berakhir: '2026-12-31',
    auto_renewal: false, notice_period_hari: 0, notice_type_required: 'None' as const, status: 'Active' as const, status_approval: 'Signed' as const }));
  const scopedContracts = [...contracts,
    { ...contracts[0], contract_id: 'restricted-dept', judul_kontrak: 'Restricted department document', partner_id: finance.partner_id, partner_nama: finance.nama_partner },
    { ...contracts[0], contract_id: 'restricted-draft', judul_kontrak: 'Restricted draft document', status: 'Expired' as const, status_approval: 'Draft' as const },
    { ...contracts[0], contract_id: 'restricted-tenant', judul_kontrak: 'Restricted tenant document', organizationId: 'other-tenant' }];
  if (options.expired) { scopedContracts[0].tanggal_berakhir = '2026-09-30'; scopedContracts[0].status = 'Expired'; }
  const ios: InsertionOrder[] = [{ ...data.ios[0] as InsertionOrder, organizationId: tenant.id, io_id: 'calendar-io', judul_io: 'Calendar commercial document', nomor_io: 'CAL-IO',
    partner_id: legal.partner_id, partner_nama: legal.nama_partner, tanggal_mulai: '2026-03-01', tanggal_berakhir: '2026-09-30', notice_period_hari: 0, notice_type_required: 'None' as const }];
  const settings = { ...tenant.settings, modules: { ...tenant.settings.modules, newsTicker: true, commercialDocuments: options.commercial ?? true } };
  const language = options.language || 'EN';
  await page.addInitScript(language => {
    localStorage.setItem('auth_session_token', 'calendar-fixture');
    // Preferences are namespaced by identity (PRD §6.7).
    localStorage.setItem('user:fixture-user:language', language);
    localStorage.setItem('user:fixture-user:theme', 'light');
  }, language);
  const api = createTenantApi({
    organizations: [{ ...tenant, settings }],
    roles: { [tenant.id]: options.viewer ? 'viewer' : 'admin' },
    departments: [{ id: 'dept-legal', name: 'Legal' }, { id: 'dept-finance', name: 'Finance' }],
    departmentIds: ['dept-legal'],
    email: 'calendar@example.test', name: 'Calendar User',
  });
  // Department scope is applied by the server (PRD §4.4): a Legal viewer never receives the Finance partner's records.
  const served = options.viewer ? scopedContracts.filter(item => item.partner_id !== finance.partner_id) : scopedContracts;
  await page.clock.setFixedTime(new Date('2026-10-04T12:00:00Z'));
  let releaseLoad = () => {};
  const gate = options.blocked ? new Promise<void>(resolve => { releaseLoad = resolve; }) : Promise.resolve();
  let failing = options.failing || false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/contracts\/calendar-\d+$/.test(path) && route.request().method() === 'PUT') {
      const record = scopedContracts.find(item => item.contract_id === path.split('/').at(-1))!;
      const { termination_document_file, ...input } = route.request().postDataJSON();
      Object.assign(record, input);
      if (termination_document_file) record.termination_document = { fileName: termination_document_file.fileName, url: '/uploads/fixture-notice.pdf' };
      record.status = contractLifecycle(record, settings, new Date('2026-10-04T12:00:00Z')).status;
      await route.fulfill({ json: { success: true, contract: record } }); return;
    }
    if (path === '/api/init-data') {
      await gate;
      if (failing) { await route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }); return; }
    }
    if (await fulfillTenantApi(route, api)) return;
    const fixtures: Record<string, unknown> = {
      // Foreign-tenant and draft rows stay in the payload to exercise the client's own visibility rules.
      '/api/init-data': {
        organizationId: tenant.id, contracts: served, ios, partners: options.viewer ? [legal] : [legal, finance],
        notifications: [], evaluations: [], spendings: [], services: { aiAvailable: false, googleUploadsAvailable: false }, timestamp: 1,
      },
      '/api/dashboard/news-ticker': { items: ['Calendar fixture ready'] },
    };
    await route.fulfill({ json: fixtures[path] ?? {} });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: language === 'EN' ? 'Document Structure' : language === 'ID' ? 'Struktur Dokumen' : '文档结构', exact: true })).toBeVisible();
  await page.getByRole('button', { name: language === 'EN' ? 'Document Structure' : language === 'ID' ? 'Struktur Dokumen' : '文档结构', exact: true }).click();
  await page.getByRole('tab', { name: language === 'EN' ? 'Calendar View' : language === 'ID' ? 'Tampilan Kalender' : '日历视图', exact: true }).click();
  return { releaseLoad, recover: () => { failing = false; } };
}

test('year/month navigation, overflow and keyboard event click open existing read-only document details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCalendarFixtures(page);
  const calendar = page.getByRole('region', { name: 'Document calendar', exact: true });
  await expect(calendar.getByTestId('calendar-year-grid').locator('section')).toHaveCount(12);
  await expect(calendar.locator('[data-current-month]')).toHaveAttribute('aria-label', 'October 2026');
  await calendar.getByRole('button', { name: 'Next year', exact: true }).click();
  await expect(calendar.locator('[data-current-month]')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(calendar.locator('[data-current-month]')).toHaveCount(1);
  await calendar.getByRole('button', { name: /more events in June 2026/ }).click();
  await expect(calendar.getByTestId('calendar-month-grid')).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Month view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await calendar.getByRole('button', { name: /more events on .*June 12, 2026/ }).click();
  const events = page.getByRole('dialog').filter({ hasText: 'Friday, June 12, 2026' });
  await expect(events.getByRole('button', { name: /Calendar Agreement/ })).toHaveCount(8);
  await page.keyboard.press('Escape');
  await calendar.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(calendar.locator('[data-date="2026-07-01"]')).toBeVisible();
  await calendar.getByRole('button', { name: 'Previous month', exact: true }).click();
  const firstEvent = calendar.getByRole('button', { name: /Contract Start Date.*Calendar Agreement 01/ }).first();
  await firstEvent.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('CAL-0');
  await expect(detail).toContainText('Calendar Agreement 01');
  await expect(detail.getByRole('button', { name: /Save/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('legend filters event types; commercial event opens its own details', async ({ page }) => {
  await installCalendarFixtures(page);
  const calendar = page.getByRole('region', { name: 'Document calendar', exact: true });
  await expect(calendar.getByRole('button', { name: 'Filter events', exact: true })).toHaveCount(0);
  await expect(calendar.getByText('New', { exact: true })).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: /Contract Start Date.*Calendar Agreement 01/ })).toBeVisible();
  await calendar.getByRole('button', { name: 'Contract Start Date', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'Contract Start Date', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(calendar.getByRole('button', { name: /Contract Start Date.*Calendar Agreement 01/ })).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Contract Start Date', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'Contract Start Date', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await calendar.getByRole('button', { name: /Contract Start Date.*Calendar commercial document/ }).click();
  await expect(page.getByRole('dialog')).toContainText('CAL-IO');
});

test('viewer cannot see another department, non-final documents, another tenant or a disabled module', async ({ page }) => {
  await installCalendarFixtures(page, { viewer: true, commercial: false });
  const calendar = page.getByRole('region', { name: 'Document calendar', exact: true });
  await expect(calendar.getByRole('region', { name: 'March 2026', exact: true })).toContainText('No events');
  await expect(calendar.getByRole('button', { name: /Calendar commercial document/ })).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Open June 2026', exact: true }).click();
  await calendar.getByRole('button', { name: /more events on .*June 12, 2026/ }).click();
  const dayEvents = page.getByRole('dialog');
  await expect(dayEvents.getByRole('button', { name: /Calendar Agreement/ })).toHaveCount(8);
  await expect(dayEvents.getByRole('button', { name: /Restricted/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await calendar.getByRole('button', { name: /Contract Start Date.*Calendar Agreement 01/ }).first().click();
  await expect(page.getByRole('dialog')).toContainText('CAL-0');
  await expect(page.getByRole('dialog').getByRole('button', { name: /Save/ })).toHaveCount(0);
});

test('calendar uses existing query loading state and retry recovers a failed workspace query', async ({ page }) => {
  const fixture = await installCalendarFixtures(page, { blocked: true, failing: true });
  const calendar = page.getByRole('region', { name: 'Document calendar', exact: true });
  await expect(calendar.getByRole('status')).toContainText('Loading document events');
  await expect(calendar.locator('[aria-busy="true"]')).toBeVisible();
  fixture.releaseLoad();
  await expect(calendar.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  fixture.recover();
  await calendar.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(calendar.getByRole('alert')).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: /Contract Start Date.*Calendar Agreement 01/ })).toBeVisible();
});

test('responsive annual grid, themes, mobile month view and accessible tab keyboard navigation', async ({ page }) => {
  await installCalendarFixtures(page);
  const calendar = page.getByRole('region', { name: 'Document calendar', exact: true });
  await page.getByRole('tab', { name: 'Calendar View', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Tree View', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Calendar View', exact: true })).toBeFocused();
  const grid = calendar.getByTestId('calendar-year-grid');
  for (const [width, columns] of [[1440, 4], [900, 2], [390, 1], [320, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
    expect(await calendar.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  }
  await calendar.getByRole('button', { name: 'Month view', exact: true }).click();
  await expect(calendar.locator('time[aria-current="date"]')).toHaveText('4');
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await expect(calendar.getByTestId('calendar-month-grid')).toBeVisible();
  }
  expect(await calendar.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await calendar.evaluate(element => element.clientWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await page.screenshot({ path: '/tmp/document-calendar-light.png' });
});

test('Indonesian UI translates calendar labels and month names', async ({ page }) => {
  await installCalendarFixtures(page, { language: 'ID' });
  const calendar = page.getByRole('region', { name: 'Kalender dokumen', exact: true });
  await expect(calendar.getByRole('button', { name: 'Hari ini', exact: true })).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Buka Oktober 2026', exact: true })).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Tanggal Mulai Kontrak', exact: true })).toBeVisible();
});

async function openFixtureContractEditor(page: Page) {
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/, exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'CAL-0' }).first();
  await row.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('terminated form saves notice/date/reason, reopens saved evidence and adds the calendar milestone', async ({ page }) => {
  await installCalendarFixtures(page);
  await openFixtureContractEditor(page);
  const form = page.getByRole('dialog');
  await form.locator('#contract-field-14').selectOption('Terminated');
  await expect(form.getByRole('region', { name: 'Termination Details' })).toBeVisible();
  await form.locator('#contract-ending-date').fill('01/10/2026');
  await form.locator('#contract-ending-date').blur();
  await form.getByLabel('Reason Note', { exact: true }).fill('Mutual agreement');
  await form.getByLabel('Termination Document', { exact: true }).setInputFiles({ name: 'notice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnotice') });
  const save = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/contracts/calendar-0'));
  await form.getByRole('button', { name: 'Save Contract Data', exact: true }).click();
  const body = (await save).postDataJSON();
  expect(body.lifecycle_mode).toBe('terminated');
  expect(body.termination_date).toBe('2026-10-01');
  expect(body.tanggal_berakhir).toBe('2026-12-31');
  expect(body.termination_reason).toBe('Mutual agreement');
  expect(body.termination_document_file.fileName).toBe('notice.pdf');
  await expect(form).toHaveCount(0);
  await openFixtureContractEditor(page);
  await expect(form.getByLabel('Reason Note', { exact: true })).toHaveValue('Mutual agreement');
  await expect(form.getByRole('button', { name: 'Saved document: notice.pdf', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Document Structure', exact: true }).click();
  await page.getByRole('tab', { name: 'Calendar View', exact: true }).click();
  await expect(page.getByRole('button', { name: /Termination Date.*October 1, 2026.*Calendar Agreement 01/ })).toBeVisible();
});

test('expired normal contract shows a locked automatic end date and persists its notice without a termination date', async ({ page }) => {
  await installCalendarFixtures(page, { expired: true });
  await openFixtureContractEditor(page);
  const form = page.getByRole('dialog');
  await expect(form.locator('#contract-field-14')).toHaveValue('Active');
  const section = form.getByRole('region', { name: 'Expired Contract Details', exact: true });
  await expect(section.getByLabel('End Date', { exact: true })).toBeDisabled();
  await expect(section.getByLabel('End Date', { exact: true })).toHaveValue('30/09/2026');
  await section.getByLabel('Reason Note', { exact: true }).fill('No renewal planned');
  const save = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/contracts/calendar-0'));
  await form.getByRole('button', { name: 'Save Contract Data', exact: true }).click();
  const body = (await save).postDataJSON();
  expect(body.lifecycle_mode).toBe('normal');
  expect(body.status).toBe('Expired');
  expect(body.termination_date).toBeNull();
  expect(body.termination_reason).toBe('No renewal planned');
});

test('future termination keeps its lifecycle choice; failed save preserves the form and its input', async ({ page }) => {
  await installCalendarFixtures(page);
  await openFixtureContractEditor(page);
  const form = page.getByRole('dialog');
  await form.locator('#contract-field-14').selectOption('Terminated');
  await form.locator('#contract-ending-date').fill('30/11/2026');
  await form.locator('#contract-ending-date').blur();
  await expect(form.getByText('Termination scheduled. The contract remains active until the termination date.', { exact: true })).toBeVisible();
  await form.getByLabel('Reason Note', { exact: true }).fill('Scheduled closure');
  await page.route('**/api/contracts/calendar-0', route => route.fulfill({ status: 400, json: { code: 'termination.file_invalid', error: 'Invalid document' } }));
  await form.getByRole('button', { name: 'Save Contract Data', exact: true }).click();
  await expect(form.getByText('Choose a PDF, DOC or DOCX document, up to 10 MB.', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Reason Note', { exact: true })).toHaveValue('Scheduled closure');
  await expect(form.locator('#contract-field-14')).toHaveValue('Terminated');
});
