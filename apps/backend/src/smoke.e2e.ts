/**
 * Browser smoke test on a throwaway PostgreSQL database: sign in, list contracts, open one (also through a deep link),
 * create and edit a contract through the real form, find it with the workspace search, and run an axe-core accessibility
 * check on three key pages. Serious and critical axe violations fail the run; the rest are printed as a report.
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
interface AxeViolation { id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[] }> }
const accessibilityReport: string[] = [];
async function checkAccessibility(page: Page, name: string) {
  await page.evaluate(axeSource);
  // The page function runs in the browser; the backend project has no DOM typings, so it is passed as source text.
  const violations = await page.evaluate(`(async () => {
    const result = await window.axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  })()`) as AxeViolation[];
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = violations.filter((v) => !blocking.includes(v));
  for (const v of violations) accessibilityReport.push(`${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'}; first: ${JSON.stringify(v.nodes[0]?.target)})`);
  assert.equal(blocking.length, 0, `${name}: serious/critical accessibility violations:\n${blocking.map((v) => `  [${v.impact}] ${v.id}: ${v.help} -> ${JSON.stringify(v.nodes.slice(0, 3).map((n) => n.target))}`).join('\n')}`);
  steps.push(`axe-core on ${name}: no serious/critical violations (${minor.length} moderate/minor reported)`);
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
