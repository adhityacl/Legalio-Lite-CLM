import { test, expect } from '@playwright/test';
import { controlSize } from './fixtures/controlSize';
import { createTenantApi, fixtureOrganization, fulfillTenantApi, workspaceInit } from './fixtures/tenantApi';

test('workspace fields and outline actions share geometry in both themes and viewport sizes', async ({ page }, testInfo) => {
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const section of [/^Partners$/, /^Contracts(?: \d+)?$/, /^Settings$/]) {
      await page.getByRole('button', { name: section }).first().click();
      await page.setViewportSize({ width, height: 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark); document.documentElement.dataset.moduixColorScheme = dark ? 'dark' : 'light'; }, dark);
        const fields = page.locator('main [data-slot="input-root"]:visible');
        await expect(fields.first()).toBeVisible();
        const md = await controlSize(page, 'md');
        const issues = await fields.evaluateAll((elements, md) => elements.flatMap(element => {
          // An input inside a moduix InputGroup is borderless; the group draws the visible field frame.
          const frame = element.closest('[data-slot="input-group-root"]') ?? element;
          const style = getComputedStyle(frame), rect = frame.getBoundingClientRect();
          return rect.height === md && style.borderRadius === '8px' && style.borderTopWidth === '1px' ? [] : [`${element.tagName}: ${rect.height}px / ${style.borderRadius} / ${style.borderTopWidth}`];
        }), md);
        expect(issues).toEqual([]);
        for (const action of await page.locator('main [data-slot="button-root"][data-variant="outline"][data-size="md"]:visible').all()) {
          expect((await action.boundingBox())!.height).toBe(md);
          await expect(action).toHaveCSS('border-radius', '8px');
          await expect(action).toHaveCSS('border-top-width', '1px');
          // Poll: moduix buttons transition border-color, so read it once the theme switch has settled.
          await expect.poll(() => action.evaluate(element => {
            // moduix fields and outline actions share the border-border token.
            const probe = document.createElement('span'); probe.style.color = 'var(--color-border)'; document.body.appendChild(probe);
            const matches = getComputedStyle(element).borderTopColor === getComputedStyle(probe).color; probe.remove(); return matches;
          })).toBe(true);
        }
        await fields.first().focus();
        // moduix draws a visible ring-coloured outline on the field frame (the InputGroup when the input sits in one).
        await expect.poll(() => fields.first().evaluate(element => {
          const style = getComputedStyle(element.closest('[data-slot="input-group-root"]') ?? element);
          const probe = document.createElement('span'); probe.style.color = 'var(--color-ring)'; document.body.appendChild(probe);
          const ring = getComputedStyle(probe).color; probe.remove();
          return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1 && style.outlineColor === ring;
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`geometry-${section.source.replace(/[^a-z]/gi, '')}-${width}.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
});

let api: ReturnType<typeof createTenantApi>;

// These checks never use real sessions or mutate workspace data.
test.beforeEach(async ({ page }) => {
  api = createTenantApi({ organizations: [fixtureOrganization('audit', 'Audit Workspace')] });
  await page.addInitScript(() => localStorage.setItem('auth_session_token', 'ui-fixture'));
  await page.route('**/api/**', async (route) => {
    if (await fulfillTenantApi(route, api)) return;
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/init-data': workspaceInit('audit', { partners: [{ partner_id: 'p1', nama_partner: 'Demo Partner', jenis_partner: 'Vendor' }] }),
      '/api/documents': { documents: [], total: 0 },
      '/api/dashboard/news-ticker': { items: ['UI news one', 'UI news two'] },
      '/api/auth-console/users': { success: true, users: [] },
      '/api/auth-console/organizations': { success: true, organizations: [{ id: 'audit', name: 'Audit Workspace', slug: 'audit' }] },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Latest Regulatory Updates' }).getByRole('listitem').filter({ hasText: 'UI news one' })).toBeVisible();
});

test('invite dialog names its fields, traps focus and restores the trigger on desktop and mobile', async ({ page }) => {
  // Tenant user creation is an invitation from Settings › Members & Access (PRD §6.4, §8.1).
  await page.getByRole('button', { name: /^(Settings|Pengaturan)$/ }).click();
  await page.getByRole('tab', { name: /^(Members & Access|Anggota & Akses)$/ }).click();
  const trigger = page.getByRole('button', { name: /^(Invite member|Undang anggota)$/ });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(/.+/);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    for (const field of await dialog.locator('input:visible, select:visible, textarea:visible').all()) {
      await expect(field).toHaveAccessibleName(/.+/);
    }
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await expect(page.locator('h1')).toHaveCount(1);
});

// UI text editor coverage lives in system-console.live.spec.ts: it is hosted by /sys.

test('mobile controls fit, drawer traps focus and restores its trigger', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const controls = page.locator('header button:visible, header select:visible');
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.getByTitle(/Open.*AI|Buka Asisten AI/i).click();
    const chat = page.getByTestId('ai-chat-panel');
    await expect(chat).toBeVisible();
    const box = await chat.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.getByTitle(/Close AI|Tutup AI/i).last().click();
  }
  await expect(page.getByRole('region', { name: /Latest Regulatory Updates|Info Regulasi Terkini/i })).toContainText('UI news two');
  const trigger = page.locator('header button').first();
  await trigger.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('contract form supports labels, keyboard focus, Escape and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = page.locator('main .dashboard-metric').getByRole('link', { name: /^Active Contracts$/i });
  await card.focus();
  await page.keyboard.press('Enter');
  const add = page.getByRole('button', { name: /^(Add Contract|Tambah Kontrak)$/ });
  await add.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const contractNumber = dialog.locator('input[required][type="text"]').first();
  expect(await contractNumber.evaluate((el: HTMLInputElement) => el.labels?.length)).toBeGreaterThan(0);
  const first = dialog.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await expect(contractNumber).toHaveCSS('font-size', '16px');
  const categoryInput = dialog.locator('input[list]');
  const categoryRow = categoryInput.locator('..');
  expect(await categoryRow.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await dialog.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});
