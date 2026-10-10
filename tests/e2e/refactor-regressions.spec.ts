import { test, expect } from '@playwright/test';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { createTenantApi, fulfillTenantApi, openActivityHistory, workspaceInit } from './fixtures/tenantApi';
import type { DocumentDetail } from '@legalio/types/documents';

const SECOND_TENANT_ID = 'org-fixture-second';

// All APIs are intercepted. Neither these tests nor the preview server access auth.db.
test.beforeEach(async ({ page }) => {
  const data = buildDemoDataset();
  const tenants = [data.tenants[0], { ...data.tenants[0], id: SECOND_TENANT_ID, name: 'Second Workspace', isDefault: false }];
  // Admin in both organizations; the first is the session default, so the tab opens there without a chooser.
  const api = createTenantApi({
    organizations: tenants.map(tenant => ({ ...tenant, settings: { ...tenant.settings, modules: { ...tenant.settings.modules, newsTicker: true, aiAssistant: true } } })),
    sessionDefault: tenants[0].id,
  });
  const documents = new Map<string, DocumentDetail>(tenants.map((tenant, index) => [tenant.id, {
    id: `doc-${index}`, organization_id: tenant.id, name: `Draft Workspace ${index + 1}`,
    content: `<p>Saved content ${index + 1}</p>`, type: 'contract', status: 'pending_review',
    file_size: 40, current_version: 1, draft_count: 1,
    created_by: 'audit@example.com', created_by_name: 'UI Audit', modified_by: null, modified_by_name: null,
    created_at: new Date().toISOString(), modified_at: new Date().toISOString(),
  }]));
  await page.addInitScript(() => {
    localStorage.setItem('auth_session_token', 'refactor-fixture');
    localStorage.setItem('user:fixture-user:language', 'EN');
  });
  await page.route('**/api/**', async route => {
    if (await fulfillTenantApi(route, api)) return;
    const request = route.request();
    const url = new URL(request.url());
    // Legacy tenant routes carry the tab's explicit selector; there is no global active tenant (PRD §5.2).
    const tenantId = request.headers()['x-organization-id'];
    let response: unknown = {};
    if (!tenantId && (url.pathname.startsWith('/api/documents') || url.pathname === '/api/init-data')) {
      response = { error: 'ORGANIZATION_REQUIRED', message: 'Select an organization.', requestId: 'fixture' };
      await route.fulfill({ status: 409, json: response });
      return;
    }
    if (url.pathname === '/api/documents') {
      if (request.method() === 'POST') {
        const input = request.postDataJSON();
        const doc = { ...documents.get(tenantId)!, ...input, id: `new-${tenantId}`, status: 'draft' as const };
        documents.set(tenantId, doc);
        response = doc;
      } else {
        const doc = documents.get(tenantId)!;
        const matches = !url.searchParams.get('status') || url.searchParams.get('status') === doc.status;
        response = { documents: matches ? [doc] : [], total: matches ? 1 : 0, page: 1, limit: 25, creators: [{ id: doc.created_by, name: doc.created_by_name }] };
      }
    } else if (/^\/api\/documents\/[^/]+$/.test(url.pathname)) {
      response = documents.get(tenantId);
    } else if (/^\/api\/documents\/[^/]+\/drafts$/.test(url.pathname) && request.method() === 'POST') {
      const input = request.postDataJSON();
      const doc = { ...documents.get(tenantId)!, content: input.content, name: input.name, current_version: 2 };
      documents.set(tenantId, doc);
      response = { document: doc, version: 2, created: true };
    } else if (url.pathname.endsWith('/drafts') || url.pathname.endsWith('/comments') || ['/api/templates', '/api/metadata-fields', '/api/activity-logs'].includes(url.pathname)) {
      response = [];
    } else {
      const fixtures: Record<string, unknown> = {
        '/api/init-data': workspaceInit(tenantId!, data),
        '/api/dashboard/news-ticker': { items: ['Refactor fixture ready'] },
      };
      response = fixtures[url.pathname] ?? {};
    }
    await route.fulfill({ json: response });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Latest Regulatory Updates' }).getByRole('listitem').filter({ hasText: 'Refactor fixture ready' })).toBeVisible();
});

test('New Document opens, edits a table, saves and reopens without selection registry errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New Document', exact: true }).click();
  await page.getByRole('button', { name: 'Blank document', exact: true }).click();
  const editor = page.locator('.tiptap.ProseMirror:visible');
  await expect(editor).toBeVisible();
  await editor.fill('New document regression content.');
  await page.getByTitle('Insert Pricing Table', { exact: true }).click();
  await expect(editor.locator('table')).toBeVisible();
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/documents');
  await page.keyboard.press('Control+s');
  const response = await saved;
  const document = await response.json();
  expect(response.request().postDataJSON().content).toContain('<table');
  await page.getByRole('button', { name: 'Back to document list', exact: true }).click();
  await page.getByRole('button', { name: document.name, exact: true }).click();
  await expect(editor).toContainText('New document regression content.');
  await expect(editor.locator('table')).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByText('Duplicate use of selection JSON ID cell', { exact: true })).toHaveCount(0);
});

test('chat, modals and editor load only when opened; saved document still opens and saves', async ({ page }) => {
  const loaded = () => page.evaluate(() => performance.getEntriesByType('resource').map(item => item.name));
  expect((await loaded()).some(name => /AIChatWidget-|ContractModal-|IOModal-|PartnerModal-|ContractDocumentEditor-/.test(name))).toBe(false);
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible();
  expect((await loaded()).some(name => /ContractDocumentEditor-/.test(name))).toBe(false);
  await page.getByRole('button', { name: 'Draft Workspace 1', exact: true }).click();
  const editor = page.locator('.tiptap.ProseMirror:visible');
  await expect(editor).toContainText('Saved content 1');
  expect((await loaded()).some(name => /ContractDocumentEditor-/.test(name))).toBe(true);
  await editor.fill('Edited content survives returning to the list.');
  const save = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/doc-0/drafts'));
  await page.keyboard.press('Control+s');
  expect((await save).postDataJSON().content).toContain('Edited content');
  await page.getByRole('button', { name: 'Back to document list', exact: true }).click();
  await page.getByRole('button', { name: 'Draft Workspace 1', exact: true }).click();
  await expect(editor).toContainText('Edited content');
  await page.getByTitle(/Open.*AI/i).click();
  await expect(page.locator('[class*="origin-bottom-right"]')).toBeVisible();
  expect((await loaded()).some(name => /AIChatWidget-/.test(name))).toBe(true);
});

for (const section of ['Contracts', 'Order Forms', 'Partners', 'Partner Spending', 'Partner Evaluation', 'Session Activity Logs', 'My Documents']) {
  test(`View preferences in ${section} support Tab, Escape and focus restoration`, async ({ page }) => {
    if (section.startsWith('Partner ')) await page.getByRole('button', { name: 'Partners', exact: true }).click();
    const name = section === 'Contracts' ? /^Contracts(?: \d+)?$/ : section === 'Order Forms' ? /^(Order Forms|Service Orders)(?: \d+)?$/ : section;
    // Session activity now lives in the Settings History drawer (PRD §6.4).
    const scope = section === 'Session Activity Logs' ? await openActivityHistory(page) : page;
    if (section !== 'Session Activity Logs') await page.getByRole('button', { name, exact: true }).click();
    const trigger = scope.getByRole('button', { name: 'View', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const preferences = page.locator('[data-slot="popover-content"]');
    await expect(preferences).toBeVisible();
    const checkbox = preferences.getByRole('checkbox').first();
    await expect(checkbox).toBeFocused();
    const checked = await checkbox.isChecked();
    await page.keyboard.press('Space');
    expect(await checkbox.isChecked()).toBe(!checked);
    await page.keyboard.press('Tab');
    expect(await preferences.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(preferences).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await trigger.click();
    await expect(preferences).toBeHidden();
  });
}

test('calendar trigger is in the Tab sequence and restores focus on Escape', async ({ page }) => {
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  await page.getByRole('button', { name: 'Add Contract', exact: true }).click();
  const calendar = page.getByRole('button', { name: 'Open Calendar', exact: true }).first();
  const input = calendar.locator('..').locator('input');
  await input.focus();
  await page.keyboard.press('Tab');
  await expect(calendar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="popover-content"]')).toBeHidden();
  await expect(calendar).toBeFocused();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('workspace switch refreshes review documents and document explorer; outgoing draft keeps its workspace', async ({ page }) => {
  const pending = page.getByRole('region', { name: 'Documents Pending Review', exact: true });
  await expect(pending).toContainText('Draft Workspace 1');
  const switchWorkspace = async () => {
    await page.locator('aside button[aria-haspopup="listbox"]').click();
    await page.getByRole('listbox').getByRole('option').last().click();
  };
  await switchWorkspace();
  await expect(pending).toContainText('Draft Workspace 2');
  await expect(pending).not.toContainText('Draft Workspace 1');
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Draft Workspace 2', exact: true }).click();
  const editor = page.locator('.tiptap.ProseMirror:visible');
  await expect(editor).toContainText('Saved content 2');
  await editor.fill('Unsaved workspace two change');
  const save = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/doc-1/drafts'));
  await page.locator('aside button[aria-haspopup="listbox"]').click();
  await page.getByRole('listbox').getByRole('option').first().click();
  const request = await save;
  expect(request.headers()['x-organization-id']).toBe(SECOND_TENANT_ID);
  await expect(page.getByRole('button', { name: 'Draft Workspace 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft Workspace 2', exact: true })).toHaveCount(0);
});

test('failed deletion restores the cached row even when the refresh also fails', async ({ page }) => {
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  await expect(page.getByRole('button', { name: 'Add Contract', exact: true })).toBeVisible();
  const rows = page.locator('tbody tr');
  const count = await rows.count();
  const firstName = await rows.first().locator('td').nth(1).textContent();
  await page.route('**/api/contracts/*', route => route.fulfill({ status: 503, json: { error: 'Fixture write failed' } }));
  await page.route('**/api/init-data', route => route.abort());
  await rows.first().getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(count);
  await expect(rows.first().locator('td').nth(1)).toHaveText(firstName!);
  await expect(page.getByText('Fixture write failed')).toBeVisible();
});
