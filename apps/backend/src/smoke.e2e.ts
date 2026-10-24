/**
 * Browser smoke test on a throwaway PostgreSQL database: sign in, list contracts, open one (also through a deep link),
 * create and edit a contract through the real form, find it with the workspace search, and run an axe-core accessibility
 * check on three key pages. Any axe violation fails the run.
 *
 *   npm run test:e2e:smoke   (needs PLAYWRIGHT_BROWSERS_PATH with Chromium, TEST_DATABASE_URL like the other e2e suites)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect, type Page } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';

const repository = path.resolve(import.meta.dirname, '../../..');
const directory = mkdtempSync(path.join(os.tmpdir(), 'legalio-smoke-'));
const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const backendPort = await freePort();
const frontendPort = await freePort();
const backendURL = `http://127.0.0.1:${backendPort}`;
const frontendURL = `http://127.0.0.1:${frontendPort}`;
Object.assign(process.env, {
  APP_TEST_MODE: '1', APP_DATA_DIR: directory, BETTER_AUTH_URL: frontendURL, TRUSTED_ORIGINS: `${backendURL},${frontendURL}`, BETTER_AUTH_ENABLE_INFRA: 'false',
  API_ONLY: 'true', SEED_DEMO_ADMIN: 'false', PORT: String(backendPort), DISABLE_HMR: 'true', BETTER_AUTH_SECRET: 'test-only-secret-for-isolated-smoke-e2e-123456789',
  GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_APPLICATION_CREDENTIALS: '', RATE_LIMIT_DISABLED: 'true',
  // The built-in deterministic test model (APP_TEST_MODE only) stands in for Gemini: AI extraction runs without a key or network.
  AI_FAKE_PROVIDER: 'true',
});
const { createTestDatabase } = await import('./testDatabase');
const database = await createTestDatabase();
process.env.DATABASE_URL = database.url;
const { sql } = await import('./db');
const { seedOrganizationsFromDataset } = await import('./organizationProvisioning');
const { synchronizeCoreData } = await import('./coreDataStore');
const { insertRepositoryRows } = await import('./repositories/seed');
await (await import('./schema')).ensureSchema();

// Fixture: the demo workspace and one organization administrator.
const dataset = buildDemoDataset();
await seedOrganizationsFromDataset(sql, dataset);
await sql.tx(async () => {
  await synchronizeCoreData(sql, dataset);
  await insertRepositoryRows(sql, dataset);
});
const now = new Date().toISOString();
const password = 'Smoke-local-password-1234';
const hash = await hashPassword(password);
// A platform administrator must exist, otherwise the app shows its first-run setup instead of the sign-in form.
for (const [id, name, email, role] of [['smoke-root', 'Smoke Root', 'root@example.com', 'superuser'], ['smoke-admin', 'Smoke Admin', 'admin@example.com', 'user']]) {
  await sql.run('INSERT INTO "user"(id,name,email,"emailVerified",role,banned,"createdAt","updatedAt") VALUES(?,?,?,true,?,false,?,?)', id, name, email, role, now, now);
  await sql.run(`INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(?,?,'credential',?,?,?,?)`, `account-${id}`, id, id, hash, now, now);
}
const org = dataset.tenants[0].id;
await sql.run(`INSERT INTO member(id,"organizationId","userId",role,status,"createdAt") VALUES(?,?,?,?,'active',?)`, 'smoke-admin-member', org, 'smoke-admin', 'admin', now);

let server: ChildProcess | undefined;
let frontend: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const logs: string[] = [];
const steps: string[] = [];
const run = (args: string[], cwd = repository) => {
  const child = spawn('node', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));
  return child;
};
const waitFor = async (url: string, child: ChildProcess) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}`);
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
};
const stop = async (child?: ChildProcess) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

/* ---------------------------------- accessibility ---------------------------------- */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
interface AxeViolation { id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[]; html?: string }> }
const accessibilityReport: string[] = [];
const shot = async (page: Page, name: string) => { await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: false }).catch(() => undefined); };
/** `scope` limits the scan to one region (a CSS selector) for pages that carry findings of their own outside the area under test. */
async function checkAccessibility(page: Page, name: string, scope?: string) {
  await page.evaluate(axeSource);
  // The page function runs in the browser; the backend project has no DOM typings, so it is passed as source text.
  const violations = await page.evaluate(`(async () => {
    const result = await window.axe.run(${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html.slice(0, 200) })) }));
  })()`) as AxeViolation[];
  // Every impact level fails the run: the pages checked here have no known findings left.
  const blocking = violations;
  for (const v of violations) accessibilityReport.push(`${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'}; first: ${JSON.stringify(v.nodes[0]?.target)} ${v.nodes[0]?.html ?? ''})`);
  assert.equal(blocking.length, 0, `${name}: accessibility violations:\n${blocking.map((v) => `  [${v.impact}] ${v.id}: ${v.help} -> ${JSON.stringify(v.nodes.slice(0, 3).map((n) => [n.target, (n.html ?? '').slice(0, 160)]))}`).join('\n')}`);
  steps.push(`axe-core on ${name}: no violations`);
}

try {
  server = run(['apps/backend/dist/server.cjs']);
  await waitFor(`${backendURL}/api/health`, server);
  frontend = run(['../../node_modules/vite/bin/vite.js', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(frontendPort)], path.join(repository, 'apps/frontend'));
  await waitFor(frontendURL, frontend);
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const initDataRequests: string[] = [];
  const listRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/init-data') initDataRequests.push(request.url());
    if (url.pathname === '/api/contracts' && url.searchParams.has('q')) listRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });

  // 1. Sign-in page, accessibility, sign in.
  await page.goto(`${frontendURL}/app`);
  await expect(page.locator('#signin-email')).toBeVisible();
  await checkAccessibility(page, 'sign-in page');
  await page.locator('#signin-email').fill('admin@example.com');
  await page.locator('#signin-password').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page.locator('#signin-email')).toHaveCount(0, { timeout: 30_000 });
  steps.push('sign in as organization administrator');

  // 2. Contract list: rows from the server, paged-list API answers with a total.
  await page.goto(`${frontendURL}/app?tab=contracts`);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const listed = await rows.count();
  assert.ok(listed > 0, 'the contract list shows rows');
  await expect(page.getByRole('heading', { name: /contract/i }).first()).toBeVisible();
  await checkAccessibility(page, 'contract list');
  steps.push(`contract list shows ${listed} row(s)`);

  // 3. Open one: through its deep link (?tab=contracts&id=...), which the app removes from the URL once the record is open.
  const token = ((await (await fetch(`${backendURL}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: frontendURL }, body: JSON.stringify({ email: 'admin@example.com', password }) })).json()) as { token: string }).token;
  const api = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(backendURL + route, { ...init, headers: { 'content-type': 'application/json', origin: frontendURL, authorization: `Bearer ${token}`, 'x-organization-id': org, ...(init.headers as Record<string, string>) } });
    const body = await response.json();
    return { status: response.status, body, headers: response.headers };
  };
  const existing = (await api('/api/contracts')).body as Array<{ contract_id: string; contract_number: string; contract_title: string; version: number }>;
  const target = existing[0];
  await page.goto(`${frontendURL}/app?tab=contracts&id=${encodeURIComponent(target.contract_id)}`);
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible({ timeout: 30_000 });
  await expect(detail).toContainText(target.contract_number);
  await expect.poll(() => new URL(page.url()).searchParams.get('id'), { message: 'the id leaves the URL once the record is open' }).toBeNull();
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'contracts');
  steps.push(`deep link ?tab=contracts&id=${target.contract_id} opens the record and then clears id`);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  // The navigation panel's resize separator lives inside the navigation landmark and still works from the keyboard.
  const separator = page.getByRole('separator').first();
  await expect(separator).toBeVisible();
  const box = await separator.boundingBox();
  assert.ok(box && box.height > 300, 'the separator spans the height of the panel');
  const sizeBefore = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(sizeBefore);
  steps.push(`the sidebar resize separator is keyboard-operable (${sizeBefore} -> ${await separator.getAttribute('aria-valuenow')})`);

  // 3b. Server-side lists: paging, sorting and debounced search live in the URL, and none of the list pages loads the whole workspace.
  const totalOf = async (route: string) => Number((await api(route + (route.includes('?') ? '&' : '?') + 'limit=1')).headers.get('x-total-count'));
  // The demo workspace has one page of contracts; add a few more so there are several.
  const pdfData = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 smoke').toString('base64');
  for (let n = 1; n <= 8; n += 1) {
    const made = await api('/api/contracts', { method: 'POST', body: JSON.stringify({
      partner_id: (existing[0] as unknown as { partner_id: string }).partner_id, contract_number: `PAGED-${String(n).padStart(2, '0')}`, contract_title: `Paged contract ${n}`,
      start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 100 + n, internal_pic: 'Legal', fileName: `paged-${n}.pdf`, fileData: pdfData,
    }) });
    assert.equal(made.status, 200, JSON.stringify(made.body).slice(0, 200));
  }
  const contractTotal = await totalOf('/api/contracts');
  assert.ok(contractTotal > 5, `the demo workspace has more than one page of contracts (${contractTotal})`);
  const pageSize = 5;
  const pages = Math.ceil(contractTotal / pageSize);
  await page.goto(`${frontendURL}/app?tab=contracts`);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`Page 1 of ${pages}`))).toBeVisible();
  const firstOnPageOne = await rows.first().innerText();
  await page.getByRole('button', { name: /next page/i }).click();
  await expect(page.getByText(new RegExp(`Page 2 of ${pages}`))).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('l.page')).toBe('2');
  await expect.poll(async () => (await rows.first().innerText()) !== firstOnPageOne, { message: 'page 2 shows other rows' }).toBe(true);
  await page.reload();
  await expect(page.getByText(new RegExp(`Page 2 of ${pages}`))).toBeVisible({ timeout: 30_000 });
  steps.push(`contracts paged on the server (${contractTotal} records, ${pages} pages); page 2 survives a reload through ?l.page=2`);

  const sortHeader = page.getByRole('columnheader', { name: /agreement no|nomor/i }).getByRole('button').first();
  await sortHeader.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('l.sort')).toBe('no');
  await expect(page.getByText(new RegExp(`Page 1 of ${pages}`))).toBeVisible({ timeout: 15_000 });
  const sortedFirst = (await api('/api/contracts?sort=contract_number&dir=asc&limit=5')).body as Array<{ contract_number: string }>;
  await expect(rows.first()).toContainText(sortedFirst[0].contract_number, { timeout: 15_000 });
  steps.push('sorting by agreement number is done by the server and written to the URL (?l.sort=no)');

  const wanted = existing[0].contract_number;
  const search = page.locator('main').getByRole('textbox', { name: /search|cari/i }).first();
  listRequests.length = 0;
  await search.pressSequentially(wanted, { delay: 15 });
  await expect.poll(() => new URL(page.url()).searchParams.get('l.q')).toBe(wanted);
  const matching = await totalOf('/api/contracts?q=' + encodeURIComponent(wanted));
  await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBe(Math.min(matching, pageSize));
  await expect(rows.first()).toContainText(wanted);
  assert.ok(listRequests.length <= 3, `typing ${wanted.length} characters sent ${listRequests.length} searches (debounced)`);
  steps.push(`search for "${wanted}" is debounced (${listRequests.length} request(s) for ${wanted.length} keystrokes) and returns ${matching} match(es)`);

  for (const [tab, route, label] of [['partners', '/api/partners', 'partners'], ['ios', '/api/ios', 'orders'], ['partner-spending', '/api/partner-spendings', 'spendings']] as const) {
    const total = await totalOf(route);
    await page.goto(`${frontendURL}/app?tab=${tab}`);
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const expectedPages = Math.max(1, Math.ceil(total / pageSize));
    await expect(page.getByText(new RegExp(`Page 1 of ${expectedPages}`))).toBeVisible({ timeout: 15_000 });
    if (expectedPages > 1) {
      await page.getByRole('button', { name: /next page/i }).click();
      await expect(page.getByText(new RegExp(`Page 2 of ${expectedPages}`))).toBeVisible({ timeout: 15_000 });
    }
    assert.equal(new URL(page.url()).searchParams.get('l.q'), null, 'the search of the previous page does not follow to another page');
    steps.push(`${label}: ${total} record(s) in ${expectedPages} page(s) from the server`);
  }

  // Dashboard figures come from the SQL aggregates; the command palette searches on the server.
  await page.goto(`${frontendURL}/app?tab=dashboard`);
  await expect(page.getByRole('region', { name: /expiring documents/i })).toBeVisible({ timeout: 30_000 });
  const aggregate = (await api('/api/aggregates/dashboard')).body as { contracts: { total: number } };
  await expect(page.getByText(String(aggregate.contracts.total)).first()).toBeVisible();
  assert.deepEqual(initDataRequests, [], `list pages, dashboard and search did not call /api/init-data: ${initDataRequests.join(', ')}`);
  steps.push('contracts, partners, orders, spending, dashboard and navigation load without /api/init-data');

  // 4. Create a contract through the form.
  const number = `SMOKE/${Date.now()}`;
  await page.goto(`${frontendURL}/app?tab=contracts`);
  await page.getByRole('button', { name: /add|new|create|tambah/i }).filter({ hasNotText: /import|export|ekspor/i }).first().click();
  await expect(page.locator('#contract-field-5')).toBeVisible({ timeout: 30_000 });
  await page.locator('#contract-field-5').fill(number);
  await page.locator('#contract-field-6').fill('Smoke contract');
  const partnerOption = await page.locator('#contract-field-2 option').first().getAttribute('value');
  await page.locator('#contract-field-2').selectOption(partnerOption!);
  await page.locator('#contract-field-8').fill('2026-01-01');
  await page.locator('#contract-field-9').fill('2030-12-31');
  await checkAccessibility(page, 'contract form');
  const save = page.getByRole('button', { name: /save contract/i });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('#contract-field-5')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => ((await api('/api/contracts?q=' + encodeURIComponent(number) + '&limit=5')).body as unknown[]).length, { timeout: 15_000 }).toBe(1);
  const created = ((await api('/api/contracts?q=' + encodeURIComponent(number) + '&limit=5')).body as Array<{ contract_id: string; version: number; contract_title: string }>)[0];
  assert.equal(created.contract_title, 'Smoke contract');
  assert.equal(created.version, 1);
  steps.push(`created contract ${number} through the form (stored as ${created.contract_id}, version 1)`);

  // 5. Edit it through the form; a second, stale writer is told so.
  await page.goto(`${frontendURL}/app?tab=contracts&id=${created.contract_id}`);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('row', { name: new RegExp(number.replace(/[/]/g, '\\/')) }).getByRole('button', { name: /edit|ubah|more|action|aksi/i }).first().click().catch(async () => {
    await page.getByRole('row', { name: new RegExp(number.replace(/[/]/g, '\\/')) }).getByRole('button').last().click();
  });
  await page.getByRole('menuitem', { name: /edit|ubah/i }).click();
  await expect(page.locator('#contract-field-6')).toBeVisible({ timeout: 30_000 });
  await page.locator('#contract-field-6').fill('Smoke contract (edited)');
  await page.getByRole('button', { name: /save contract/i }).click();
  await expect(page.locator('#contract-field-6')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await api(`/api/contracts?q=${encodeURIComponent(number)}&limit=1`)).body[0]?.contract_title, { timeout: 15_000 }).toBe('Smoke contract (edited)');
  const edited = (await api(`/api/contracts?q=${encodeURIComponent(number)}&limit=1`)).body[0];
  assert.equal(edited.version, 2);
  const stale = await api(`/api/contracts/${created.contract_id}`, { method: 'PUT', body: JSON.stringify({ contract_title: 'stale', version: 1 }) });
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { code?: string }).code, 'VERSION_CONFLICT');
  steps.push('edited the contract through the form (version 2); a write based on version 1 is refused with 409 VERSION_CONFLICT');

  // 6. Workspace search finds it and opens the record (the id is written to the URL).
  await page.goto(`${frontendURL}/app?tab=dashboard`);
  await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /search|cari/i }).first().click();
  const searchBox = page.getByPlaceholder(/search menu, vendor|search/i).first();
  await expect(searchBox).toBeVisible();
  await searchBox.fill(number);
  const option = page.getByRole('option', { name: new RegExp(number.replace(/[/]/g, '\\/')) }).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(page.getByRole('dialog')).toContainText(number, { timeout: 30_000 });
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'contracts');
  steps.push('workspace search finds the new contract and opens it');

  // 6b. Obligations: create one through the form, see it in the list, the dashboard widget and the contract record; accept an AI suggestion.
  await page.goto(`${frontendURL}/app?tab=obligations`);
  await expect(page.getByRole('heading', { name: /obligations & key dates/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /add obligation/i }).first()).toBeVisible();
  await checkAccessibility(page, 'obligations page (empty list)');
  await page.getByRole('button', { name: /add obligation/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const obligationTitle = `Smoke obligation ${Date.now()}`;
  await dialog.getByLabel(/^title$/i).fill(obligationTitle);
  await dialog.getByLabel(/^type$/i).selectOption('payment');
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  // The date field takes dd/mm/yyyy.
  await dialog.getByLabel(/due date/i).fill(soon.split('-').reverse().join('/'));
  await dialog.getByLabel(/due date/i).press('Tab');
  await dialog.getByLabel(/^contract/i).selectOption({ index: 1 });
  await shot(page, 'obligation-form');
  await checkAccessibility(page, 'obligation form');
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  const obligationRow = page.getByRole('row', { name: new RegExp(obligationTitle) });
  await expect(obligationRow).toBeVisible({ timeout: 30_000 });
  const storedObligation = ((await api(`/api/obligations?q=${encodeURIComponent(obligationTitle)}`)).body as Array<{ id: string; version: number; type: string; due_date: string; contract_id: string; source: string }>)[0];
  assert.deepEqual([storedObligation.type, storedObligation.due_date, storedObligation.version, storedObligation.source], ['payment', soon, 1, 'manual']);
  assert.ok(storedObligation.contract_id, 'linked to the chosen contract');
  await shot(page, 'obligations-list');
  await checkAccessibility(page, 'obligations page (list)');
  steps.push(`created obligation "${obligationTitle}" through the form (${storedObligation.id}, due ${soon})`);

  await obligationRow.getByRole('button', { name: /action/i }).click();
  await page.getByRole('menuitem', { name: /mark done/i }).click();
  await expect.poll(async () => ((await api(`/api/obligations/${storedObligation.id}`)).body as { status: string }).status, { timeout: 15_000 }).toBe('done');
  steps.push('marked the obligation done from the row menu');
  await api(`/api/obligations/${storedObligation.id}`, { method: 'PUT', body: JSON.stringify({ status: 'open', version: 2 }) });

  await page.goto(`${frontendURL}/app?tab=dashboard`);
  const widget = page.getByTestId('obligations-widget');
  await expect(widget).toBeVisible({ timeout: 30_000 });
  const summary = (await api('/api/obligations/summary')).body as { overdue: number; dueThisWeek: number; open: number };
  assert.ok(summary.dueThisWeek >= 1 && summary.open >= 1);
  await shot(page, 'dashboard-widget');
  await expect(widget.getByTestId('obligations-widget-value').nth(1)).toHaveText(String(summary.dueThisWeek));
  steps.push(`dashboard widget shows the SQL aggregate (${summary.dueThisWeek} due this week, ${summary.open} open)`);

  await page.goto(`${frontendURL}/app?tab=obligations`);
  await page.getByRole('tab', { name: /calendar/i }).click();
  await expect(page.getByRole('region', { name: /document calendar/i })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'obligations-calendar');
  await checkAccessibility(page, 'obligations calendar view');

  await page.goto(`${frontendURL}/app?tab=contracts&id=${encodeURIComponent(storedObligation.contract_id)}`);
  const recordDialog = page.getByRole('dialog');
  await expect(recordDialog).toBeVisible({ timeout: 30_000 });
  await recordDialog.getByRole('tab', { name: /obligations/i }).click();
  await expect(recordDialog.getByTestId('contract-obligations')).toContainText(obligationTitle, { timeout: 30_000 });
  await shot(page, 'contract-obligations-tab');
  await checkAccessibility(page, 'contract record, obligations tab');
  steps.push('the contract record has an Obligations tab listing the obligation');
  await page.keyboard.press('Escape');

  // AI extraction (the built-in test model) queues suggestions; accepting one in the review queue creates the obligation with provenance.
  const extraction = await api(`/api/contracts/${storedObligation.contract_id}/extract`, { method: 'POST', body: JSON.stringify({ text: 'MASTER AGREEMENT.\nThe Supplier shall pay the setup fee on 2031-02-03.\n\f\nThis agreement is governed by the laws of Singapore.' }) });
  assert.equal(extraction.status, 200, JSON.stringify(extraction.body).slice(0, 300));
  assert.equal((extraction.body as { created: number }).created, 2);
  const beforeAccept = ((await api('/api/obligations?source=ai_extracted')).body as unknown[]).length;
  assert.equal(beforeAccept, 0, 'nothing exists before a person accepts');
  await page.goto(`${frontendURL}/app?tab=obligations`);
  const reviewTab = page.getByRole('tab', { name: /ai review/i });
  await expect(reviewTab).toContainText('2', { timeout: 30_000 });
  await reviewTab.click();
  const card = page.getByTestId('suggestion-card').filter({ hasText: /setup fee/i });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/shall pay the setup fee/i);
  await expect(card).toContainText(/page 1/i);
  await expect(card).toContainText(/confidence 82%/i);
  await shot(page, 'review-queue');
  await checkAccessibility(page, 'AI review queue');
  await card.getByLabel(/^title$/i).fill('Pay the setup fee (reviewed)');
  await card.getByRole('button', { name: /accept and create obligation/i }).click();
  await expect.poll(async () => ((await api('/api/obligations?source=ai_extracted')).body as unknown[]).length, { timeout: 15_000 }).toBe(1);
  const aiObligation = ((await api('/api/obligations?source=ai_extracted')).body as Array<{ title: string; due_date: string; source_quote: string; source_page: number; confirmed_by: string; source_confidence: number }>)[0];
  assert.equal(aiObligation.title, 'Pay the setup fee (reviewed)');
  assert.equal(aiObligation.due_date, '2031-02-03');
  assert.match(aiObligation.source_quote, /shall pay the setup fee/);
  assert.deepEqual([aiObligation.source_page, aiObligation.source_confidence, aiObligation.confirmed_by], [1, 0.82, 'smoke-admin']);
  const termCard = page.getByRole('article', { name: /governing law/i });
  await termCard.getByRole('button', { name: /reject/i }).click();
  await expect.poll(async () => ((await api('/api/suggestions/summary')).body as { total: number }).total, { timeout: 15_000 }).toBe(0);
  steps.push('AI suggestions are queued without creating records; accepting one (with an edit) created an obligation with source quote, page, confidence and reviewer; rejecting the other created nothing');

  // Clause library: empty state, opt-in starter import, the clause form, then the playbook check on the contract record and in the editor.
  await page.goto(`${frontendURL}/app?tab=clauses`);
  await expect(page.getByRole('heading', { name: /clause library & playbook/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('clauses-empty')).toBeVisible({ timeout: 30_000 });
  await shot(page, 'clauses-empty');
  await checkAccessibility(page, 'clause library (empty)');
  await page.getByTestId('clauses-empty').getByRole('button', { name: /import starter clauses/i }).click();
  const starterDialog = page.getByRole('dialog');
  await expect(starterDialog.getByText('Payment terms', { exact: true }).last()).toBeVisible({ timeout: 30_000 });
  await shot(page, 'clauses-starter-import');
  await checkAccessibility(page, 'starter clause import dialog');
  await starterDialog.getByTestId('starter-import').click();
  await expect(page.getByTestId('clause-row').filter({ hasText: 'Payment terms' })).toBeVisible({ timeout: 30_000 });
  const clauseTotal = ((await api('/api/clauses?limit=500')).body as unknown[]).length;
  assert.ok(clauseTotal >= 6, `starter clauses imported (${clauseTotal})`);
  await shot(page, 'clauses-list');
  await checkAccessibility(page, 'clause library (list)');
  await page.getByTestId('clause-row').filter({ hasText: 'Payment terms' }).getByRole('button', { name: 'Payment terms', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(/^approved wording$/i)).toHaveValue(/thirty \(30\) days/, { timeout: 15_000 });
  await shot(page, 'clause-form');
  await checkAccessibility(page, 'clause form');
  await page.keyboard.press('Escape');
  steps.push(`the clause library starts empty, the starter import is an explicit action (${clauseTotal} clauses), and the clause form shows wording, fallbacks and rules`);

  const slowPayment = 'The Customer shall pay each invoice within ninety (90) days of receipt.';
  await page.goto(`${frontendURL}/app?tab=contracts&id=${encodeURIComponent(storedObligation.contract_id)}`);
  const playbookRecord = page.getByRole('dialog');
  await expect(playbookRecord).toBeVisible({ timeout: 30_000 });
  await playbookRecord.getByRole('tab', { name: /playbook/i }).click();
  await playbookRecord.getByLabel(/^contract text/i).fill(`SERVICES AGREEMENT.\n\n${slowPayment}\n\nThis agreement is governed by the laws of Singapore.`);
  await playbookRecord.getByTestId('playbook-run').click();
  const recordFinding = playbookRecord.getByTestId('playbook-finding').filter({ hasText: /payment terms/i }).filter({ hasText: /says 90/i });
  await expect(recordFinding).toBeVisible({ timeout: 30_000 });
  await expect(recordFinding).toContainText('ninety (90) days');
  await expect(recordFinding).toContainText(/forty-five \(45\) days/);
  await shot(page, 'playbook-contract-record');
  await checkAccessibility(page, 'contract record, playbook tab');
  await page.keyboard.press('Escape');
  steps.push('playbook check on the contract record: the 90-day payment term is reported with its sentence and the fallback wording');

  const editorDocument = (await api('/api/documents', { method: 'POST', body: JSON.stringify({ name: 'Smoke playbook draft', type: 'contract', content: `<h1>Services agreement</h1><p>${slowPayment}</p><p>Closing words.</p>` }) })).body as { id: string };
  await page.goto(`${frontendURL}/app?tab=create-contract&document=${encodeURIComponent(editorDocument.id)}`);
  await page.getByRole('tab', { name: 'Playbook', exact: true }).click({ timeout: 60_000 });
  await page.getByTestId('playbook-run').click();
  const editorFinding = page.getByTestId('playbook-finding').filter({ hasText: /says 90/i });
  await expect(editorFinding).toBeVisible({ timeout: 30_000 });
  await shot(page, 'playbook-editor');
  await checkAccessibility(page, 'contract editor, playbook panel', '[data-testid="playbook-panel"]');
  await editorFinding.getByTestId('playbook-insert').click();
  await expect(page.locator('.ProseMirror').first()).toContainText(/forty-five \(45\) days/, { timeout: 15_000 });
  assert.ok(!/ninety \(90\)/.test(await page.locator('.ProseMirror').first().innerText()), 'the quoted sentence was replaced, not duplicated');
  await expect(page.locator('.ProseMirror').first()).toContainText('Closing words.');
  steps.push('playbook in the contract editor: "Replace the sentence" swapped the violating sentence for the library fallback');

  // AI chat: the answer is based on records found by search and cites them; the chips deep-link into the application.
  const chatReply = await api('/api/chat', { method: 'POST', body: JSON.stringify({ query: 'Smoke contract edited', history: [] }) });
  assert.equal(chatReply.status, 200, JSON.stringify(chatReply.body).slice(0, 300));
  const chatSources = (chatReply.body as { sources: Array<{ ref: string; type: string; id: string; tab: string; param: string; cited: boolean; origin: string }> }).sources;
  assert.ok(chatSources.some((src) => src.type === 'contract' && src.id === created.contract_id && src.tab === 'contracts' && src.param === 'id'), 'the contract is a source');
  await page.goto(`${frontendURL}/app?tab=dashboard`);
  await page.getByRole('button', { name: /open legalio ai assistant/i }).click();
  const chatPanel = page.getByTestId('ai-chat-panel');
  await chatPanel.getByRole('textbox').fill('Smoke contract edited');
  await chatPanel.getByRole('textbox').press('Enter');
  const chip = chatPanel.getByTestId('chat-source').first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toHaveAttribute('href', /^\?tab=[a-z-]+&(id|document)=/);
  await expect(chatPanel.getByTestId('chat-source').filter({ has: page.locator(`xpath=self::*[@data-source-id="${created.contract_id}"]`) })).toHaveCount(1);
  await shot(page, 'chat-sources');
  await checkAccessibility(page, 'AI chat panel with citations', '[data-testid="ai-chat-panel"]');
  await chatPanel.locator(`[data-source-id="${created.contract_id}"]`).click();
  await expect(page.getByRole('dialog').first()).toContainText(/smoke contract/i, { timeout: 30_000 });
  steps.push('AI chat answered from retrieved records: the answer cites them and the chip opens the contract record through its deep link');
  await page.keyboard.press('Escape');

  // 7. A third key page: the dashboard.
  await page.goto(`${frontendURL}/app?tab=dashboard`);
  await expect(page.getByRole('region', { name: /expiring documents/i })).toBeVisible({ timeout: 30_000 });
  await checkAccessibility(page, 'dashboard');

  // 8. A page that crashes shows its own error and does not take the application down.
  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(serverErrors, [], `HTTP 5xx during the run: ${serverErrors.join(' | ')}`);
  steps.push('no uncaught browser errors and no HTTP 5xx');

  const report = { passed: steps.length, steps, accessibility: accessibilityReport, directory };
  writeFileSync(path.join(directory, 'smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('Smoke failure:', error);
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => undefined);
    console.error(`Screenshot: ${path.join(directory, 'failure.png')} (url ${failedPage.url()})`);
  }
  console.error(logs.join('').split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await stop(frontend);
  await stop(server);
  await database.drop().catch(() => undefined);
}
