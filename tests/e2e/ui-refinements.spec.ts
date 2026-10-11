import { test, expect } from '@playwright/test';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { buildDueDiligenceChecklist, localize } from '@legalio/shared/policy';
import { translations } from '../../apps/frontend/src/context/LanguageContext';
import { accentPalettes, contrastRatio, organizationThemeTokens } from '../../apps/frontend/src/lib/organizationColors';
import type { Locator } from '@playwright/test';
import { controlSize, type ControlSize } from './fixtures/controlSize';
import { becomeSuperuser, createTenantApi, fulfillTenantApi, openActivityHistory, policyView, workspaceInit } from './fixtures/tenantApi';

let api: ReturnType<typeof createTenantApi>;

for (const [palette, color] of [['Iris', '#5B5BD6'], ['Grass', '#46A758']]) {
  test(`palette audit: ${palette} actions, icons and disabled states stay readable across settings and admin`, async ({ page }) => {
    test.setTimeout(90_000);
    const hex = (css: string) => '#' + css.match(/[\d.]+/g)!.slice(0, 3).map(channel => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('');
    const inspect = async (scope: Locator = page.locator('main')) => {
      const actions = scope.locator('[data-slot="button-root"][data-variant="default"]:visible');
      await expect(actions.first()).toBeVisible();
      for (const action of await actions.all()) {
        await expect.poll(() => action.evaluate(element => {
          const styles = getComputedStyle(element);
          const root = getComputedStyle(document.documentElement);
          const disabled = (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
          const probe = document.createElement('span');
          document.body.appendChild(probe);
          const resolved = (token: string) => { probe.style.color = root.getPropertyValue(token); return getComputedStyle(probe).color; };
          const background = resolved(disabled ? '--primary-disabled' : '--moduix-primary');
          const foreground = resolved(disabled ? '--primary-disabled-foreground' : '--moduix-primary-foreground');
          probe.remove();
          return styles.backgroundColor === background && styles.color === foreground;
        })).toBe(true);
        const colors = await action.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color, opacity: getComputedStyle(element).opacity, icons: Array.from(element.querySelectorAll('svg')).map(icon => getComputedStyle(icon).color) }));
        expect(contrastRatio(hex(colors.background), hex(colors.foreground))).toBeGreaterThanOrEqual(4.5);
        expect(colors.opacity).toBe('1');
        expect(colors.icons.every(icon => icon === colors.foreground)).toBe(true);
      }
    };
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Choose color palette', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose color palette' });
    await picker.getByRole('button', { name: palette, exact: true }).click();
    await picker.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-organization-palette', palette.toLowerCase());
    expect(api.state.organizations[0].primaryColor).toBe(color);
    for (const dark of [false, true]) {
      if (dark) await page.getByRole('button', { name: /Switch to Dark Mode/i }).click();
      await inspect();
      await page.getByRole('button', { name: /Region and formatting.*Country/ }).click();
      await page.getByRole('button', { name: /^Notifications and modules/ }).click();
      await inspect();
      await page.screenshot({ path: `/tmp/palette-audit-${palette.toLowerCase()}-${dark ? 'dark' : 'light'}-settings.png` });
      await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
      await inspect();
      const active = page.getByRole('button', { name: 'Active', exact: true });
      await active.hover();
      await expect.poll(() => active.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--primary-hover)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }));
      expect(await active.evaluate(element => getComputedStyle(element).color)).toBe('rgb(255, 255, 255)');
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'History', exact: true }).click();
      const history = page.getByRole('dialog', { name: 'History' });
      await history.getByRole('tab', { name: 'Operational activity', exact: true }).click();
      await inspect(history);
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
      await inspect();
      await page.getByRole('tab', { name: 'Organization', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Partners', exact: true }).first().click();
    await inspect();
    await page.getByRole('button', { name: /^(Order Forms|Service Orders)(?: \d+)?$/ }).first().click();
    await inspect();
    await page.getByRole('button', { name: 'Partner Evaluation', exact: true }).first().click();
    await page.getByRole('button', { name: 'Add Evaluation', exact: true }).click();
    const evaluation = page.getByRole('dialog');
    const radio = evaluation.locator('input[type="radio"]').first();
    await expect(radio).toBeAttached();
    expect(await radio.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--primary)';
      document.body.appendChild(probe);
      const matches = getComputedStyle(element).accentColor === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    })).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(Explorer|Explore|Document Structure)$/ }).first().click();
    await inspect();
    await becomeSuperuser(page, api);
    await page.getByRole('button', { name: 'System Admin', exact: true }).first().click();
    for (const name of ['Users', 'Organizations', 'API Keys']) {
      await page.getByRole('tab', { name: new RegExp(`^${name}(?: \\d+)?$`) }).click();
      await inspect();
    }
    await page.screenshot({ path: `/tmp/palette-audit-${palette.toLowerCase()}-admin.png` });
  });
}

for (const width of [1440, 390]) {
  test(`organization Radix palette saves the workspace theme at ${width}px in light and dark modes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 768) await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const root = page.locator('html');
    const original = await root.getAttribute('data-organization-palette');
    await page.getByRole('button', { name: 'Choose color palette', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Choose color palette' });
    await expect(dialog.getByRole('group', { name: 'Choose color palette' }).getByRole('button')).toHaveCount(31);
    await dialog.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(root).toHaveAttribute('data-organization-palette', original!);
    await page.getByRole('button', { name: 'Choose color palette', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Choose color palette' });
    await dialog.getByRole('button', { name: 'Blue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(root).toHaveAttribute('data-organization-palette', original!);
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    await expect(root).toHaveAttribute('data-organization-palette', 'blue');
    const blue = accentPalettes.find(palette => palette.name === 'blue')!;
    expect(api.state.organizations[0].primaryColor).toBe(blue.light[8].toUpperCase());
    const inspect = async (dark: boolean) => {
      expect(await root.evaluate(element => getComputedStyle(element).getPropertyValue('--primary').trim())).toBe(organizationThemeTokens(blue.light[8], dark)['--primary']);
      const selected = page.getByRole('tab', { name: 'Organization', exact: true });
      const expected = organizationThemeTokens(blue.light[8], dark)['--line-brand-green-text'];
      await expect.poll(() => selected.evaluate((element, expected) => {
        const probe = document.createElement('span');
        probe.style.color = expected;
        document.body.appendChild(probe);
        const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
        probe.remove();
        return matches;
      }, expected)).toBe(true);
      const action = page.getByRole('button', { name: 'Save Profile', exact: true });
      expect(await action.evaluate(element => {
        const styles = getComputedStyle(element);
        const probe = document.createElement('span');
        probe.style.color = (element as HTMLButtonElement).disabled ? 'var(--primary-disabled-foreground)' : 'var(--moduix-primary-foreground)';
        document.body.appendChild(probe);
        const matches = styles.color === getComputedStyle(probe).color;
        probe.remove();
        return matches;
      })).toBe(true);
    };
    await inspect(false);
    await page.getByRole('button', { name: /Switch to Dark Mode/i }).click();
    await inspect(true);
    await page.reload();
    await expect(root).toHaveAttribute('data-organization-palette', 'blue');
    await inspect(true);
    await page.getByRole('button', { name: 'Choose color palette', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Choose color palette' });
    await expect(dialog.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/organization-colors-${width}.png` });
    await page.keyboard.press('Escape');
    await becomeSuperuser(page, api);
    await page.getByRole('button', { name: 'Back to System Admin', exact: true }).click();
    await expect(root).not.toHaveAttribute('data-organization-palette', /.+/);
    expect(await root.evaluate(element => (element as HTMLElement).style.getPropertyValue('--primary'))).toBe('');
  });
}

test('organization logo upload uses a dialog and platform editing preserves shared profile fields', async ({ page }) => {
  const expectRoundLogo = async (image: Locator) => {
    await expect.poll(() => image.evaluate(element => {
      const frame = element.parentElement!;
      const bounds = frame.getBoundingClientRect();
      const frameStyles = getComputedStyle(frame);
      const imageStyles = getComputedStyle(element);
      const imageBounds = element.getBoundingClientRect();
      return {
        square: Math.abs(bounds.width - bounds.height) < 1,
        round: parseFloat(frameStyles.borderTopLeftRadius) >= bounds.width / 2,
        fit: imageStyles.objectFit,
        padding: [frameStyles, imageStyles].every(styles => ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].every(side => parseFloat(styles[side as keyof CSSStyleDeclaration] as string) === 0)),
        fills: Math.abs(imageBounds.width - (bounds.width - parseFloat(frameStyles.borderLeftWidth) - parseFloat(frameStyles.borderRightWidth))) < 1 && Math.abs(imageBounds.height - (bounds.height - parseFloat(frameStyles.borderTopWidth) - parseFloat(frameStyles.borderBottomWidth))) < 1,
      };
    })).toEqual({ square: true, round: true, fit: 'cover', padding: true, fills: true });
  };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4U8AAAAASUVORK5CYII=';
  const logo = `data:image/png;base64,${png}`;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Upload Image File', exact: true }).click();
  let upload = page.getByRole('dialog', { name: 'Organization / Workspace Logo' });
  await upload.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(upload.locator('img')).toHaveAttribute('src', logo);
  await expectRoundLogo(upload.locator('img'));
  await upload.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('main img[src^="data:"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload Image File', exact: true }).click();
  upload = page.getByRole('dialog', { name: 'Organization / Workspace Logo' });
  await upload.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(upload.locator('img')).toHaveAttribute('src', logo);
  await upload.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect.poll(() => api.state.organizations[0].logoUrl).toBe(logo);
  await page.reload();
  await expect(page.locator('main img[src^="data:"]')).toHaveAttribute('src', logo);
  await expectRoundLogo(page.locator('main img[src^="data:"]'));
  await expectRoundLogo(page.locator('aside img[src^="data:"]').first());
  const organization = api.state.organizations[0];
  await page.route('**/api/auth-console/organizations', route => route.fulfill({ json: { organizations: [{ id: organization.id, name: organization.name, slug: organization.domainSlug || organization.id, logo: organization.logoUrl, version: api.state.settingsVersion[organization.id], metadata: { tagline: 'Shared tagline' }, createdAt: new Date().toISOString() }] } }));
  let submitted: any;
  await page.route('**/api/auth-console/organizations/*', async route => { submitted = route.request().postDataJSON(); await route.fulfill({ json: { success: true } }); });
  await becomeSuperuser(page, api);
  await page.getByRole('button', { name: 'System Admin', exact: true }).first().click();
  await page.getByRole('tab', { name: /^Organizations/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const edit = page.getByRole('dialog', { name: 'Edit Organization Profile & Settings' });
  await expect(edit.getByText('Primary Currency', { exact: true })).toHaveCount(0);
  await expect(edit.locator('img')).toHaveAttribute('src', logo);
  await expectRoundLogo(edit.locator('img'));
  await expect(edit.getByLabel(/Tagline/i)).toHaveCount(0);
  await edit.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(submitted.profile).toEqual({ logoUrl: logo });
  expect(submitted).not.toHaveProperty('policy');
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

test('shared table design covers operational and admin pages while preserving excluded tabs', async ({ page }) => {
  test.setTimeout(90_000);
  await becomeSuperuser(page, api);
  const inspect = async (scope: Locator = page.locator('main')) => {
    const tables = scope.locator('table[data-slot="table-root"]:visible');
    await expect(tables.first()).toBeVisible();
    for (const table of await tables.all()) {
      const presentation = await table.evaluate(element => {
        const cell = element.querySelector('thead th')!;
        const row = element.querySelector('thead tr')!;
        let surface = element.closest('[data-slot="table-scroll-area"]')!;
        return { font: getComputedStyle(cell).fontSize, weight: getComputedStyle(cell).fontWeight, transform: getComputedStyle(cell).textTransform, height: cell.getBoundingClientRect().height, header: getComputedStyle(row).backgroundColor, radius: getComputedStyle(surface).borderRadius, scope: element.closest('[data-table-design]')?.getAttribute('data-table-design') };
      });
      expect(presentation).toMatchObject({ font: '14px', weight: '600', transform: 'none', radius: '20px', scope: 'standard' });
      expect(presentation.height).toBeGreaterThanOrEqual(58);
      expect(['rgb(247, 249, 251)', 'rgb(24, 34, 53)']).toContain(presentation.header);
    }
  };
  const open = async (name: string | RegExp) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name, exact: true }).first().click();
  };
  for (const label of ['Partners', 'Partner Evaluation', /^Contracts(?: \d+)?$/, /^(Order Forms|Service Orders)(?: \d+)?$/, /^Notifications(?: \d+)?$/]) {
    await open(label);
    await inspect();
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      await inspect();
      await page.setViewportSize({ width: 390, height: 1000 });
      expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  }
  await open('Partners');
  await page.screenshot({ path: '/tmp/shared-table-partners.png' });
  const checkbox = page.locator('main table[data-slot="table-root"] tbody input[type="checkbox"]').first();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect.poll(() => checkbox.evaluate(element => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--table-selected)';
    document.body.appendChild(probe);
    const selected = getComputedStyle(element.closest('tr')!).backgroundColor === getComputedStyle(probe).color;
    probe.remove();
    return selected;
  })).toBe(true);
  await open('Partner Spending');
  await inspect();
  await open('Settings');
  await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  await inspect();
  await page.screenshot({ path: '/tmp/shared-table-members.png' });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog');
  await inspect(history);
  await page.keyboard.press('Escape');
  await open('System Admin');
  for (const name of ['Users', 'Sessions', 'API Keys']) {
    await page.getByRole('tab', { name: new RegExp(`^${name}(?: \\d+)?$`) }).click();
    await inspect();
  }
  for (const label of ['Main Dashboard', /^(Explorer|Explore|Document Structure)$/]) {
    await open(label);
    await expect(page.locator('main table[data-slot="table-root"]')).toHaveCount(0);
    const pagination = page.locator('main [data-slot="pagination-root"]');
    if (await pagination.count()) expect(await pagination.first().locator('span').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('12px');
  }
});

test('Account Profile saves details and photo with separate Profile and Security tabs', async ({ page }) => {
  let profile = { name: 'John Doe', image: null as string | null, bio: '' };
  let passwordChanges = 0;
  await page.route('**/api/me', async route => {
    const response = api.handle(route.request()) as any;
    await route.fulfill({ json: { ...response, identity: { ...response.identity, ...profile } } });
  });
  await page.route('**/api/auth/update-user', async route => {
    profile = route.request().postDataJSON();
    await route.fulfill({ json: { status: true } });
  });
  await page.route('**/api/auth/change-password', async route => {
    passwordChanges++;
    expect(route.request().postDataJSON()).toMatchObject({ currentPassword: 'current-password', newPassword: 'updated-password' });
    await route.fulfill({ json: { token: null, user: {} } });
  });
  await page.reload();
  const openProfile = async () => {
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Account Profile', exact: true }).click();
  };
  await openProfile();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab')).toHaveCount(2);
  await expect(dialog.getByRole('tab', { name: 'Notifications', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('First Name', { exact: true })).toHaveValue('John');
  await expect(dialog.getByLabel('Last Name', { exact: true })).toHaveValue('Doe');
  await expect(dialog.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  await dialog.getByLabel('First Name', { exact: true }).fill('Jane');
  await dialog.getByLabel('Last Name', { exact: true }).fill('Smith');
  await dialog.getByLabel('Bio', { exact: true }).fill('Legal operations manager');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(800 * 1024 + 1) });
  await expect(dialog.getByRole('alert')).toContainText('800 KB');
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: photo });
  await expect(dialog.getByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', /^data:image\/png;base64,/);
  await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(dialog.getByText('Profile updated.', { exact: true })).toBeVisible();
  expect(profile).toMatchObject({ name: 'Jane Smith', bio: 'Legal operations manager', image: `data:image/png;base64,${photo.toString('base64')}` });
  await expect(page.locator('header button[aria-haspopup="menu"] img')).toHaveAttribute('src', profile.image!);
  await dialog.getByRole('tab', { name: 'Security', exact: true }).click();
  await dialog.getByLabel('Current password', { exact: true }).fill('current-password');
  await dialog.getByLabel('New password', { exact: true }).fill('updated-password');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('wrong-password');
  await expect(dialog.getByText('Passwords do not match.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Update Password', exact: true })).toBeDisabled();
  expect(passwordChanges).toBe(0);
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('updated-password');
  await dialog.getByRole('button', { name: 'Update Password', exact: true }).click();
  await expect(dialog.getByText('Password changed.', { exact: true })).toBeVisible();
  expect(passwordChanges).toBe(1);
  await dialog.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(dialog.getByLabel('Bio', { exact: true })).toHaveValue('Legal operations manager');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/account-profile-${width}.png` });
    await dialog.getByRole('tab', { name: 'Security', exact: true }).click();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/account-security-${width}.png` });
    await dialog.getByRole('tab', { name: 'Profile', exact: true }).click();
  }
  await page.keyboard.press('Escape');
  await page.reload();
  await openProfile();
  await expect(dialog.getByLabel('First Name', { exact: true })).toHaveValue('Jane');
  await expect(dialog.getByLabel('Last Name', { exact: true })).toHaveValue('Smith');
  await expect(dialog.getByLabel('Bio', { exact: true })).toHaveValue('Legal operations manager');
});

async function expectReadableAction(button: Locator, size: ControlSize | number) {
  await expect(button).toBeVisible();
  const height = typeof size === 'number' ? size : await controlSize(button.page(), size);
  const layout = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textFits = true;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || node.parentElement?.closest('.sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        textFits &&= rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
          && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
      }
    }
    return { height: bounds.height, width: bounds.width, textFits };
  });
  expect(layout.height).toBe(height);
  expect(layout.width).toBeGreaterThan(height);
  expect(layout.textFits).toBe(true);
}

test.beforeEach(async ({ page }) => {
  const data = buildDemoDataset();
  data.contracts[0].status = 'Expiring';
  data.contracts[0].sisa_hari = 65;
  data.contracts[0].created_at = daysAgo(10);
  data.ios[0].status = 'Expiring';
  data.ios[0].sisa_hari = 20;
  data.ios[0].created_at = daysAgo(5);
  const tenant = data.tenants[0];
  const settings = { ...tenant.settings, modules: { ...tenant.settings.modules, newsTicker: true } };
  await page.addInitScript(() => {
    localStorage.setItem('auth_session_token', 'ui-demo');
    localStorage.setItem('user:fixture-user:language', 'EN');
  });
  api = createTenantApi({ organizations: [{ ...tenant, settings }] });
  await page.route('**/api/**', async route => {
    if (await fulfillTenantApi(route, api)) return;
    const fixtures: Record<string, unknown> = {
      '/api/init-data': workspaceInit(tenant.id, data),
      '/api/documents': { documents: [], total: 0 },
      '/api/dashboard/news-ticker': { items: ['Test news'] },
    };
    await route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} });
  });
  await page.goto('/');
  await expect(page.getByText('Test news').first()).toBeVisible();
});

test('requiring action table combines contracts and order forms', async ({ page }) => {
  const section = page.getByRole('region', { name: 'Expiring Documents', exact: true }).first();
  const headers = section.locator('thead th');
  await expect(headers.nth(1)).toHaveText('Document Name');
  await expect(headers.nth(2)).toHaveText('Type');
  await expect(section.locator('tbody tr')).toHaveCount(2);
  await expect(section.locator('tbody')).toContainText('Master Services Agreement PT Mitra Nusantara 01');
  await expect(section.locator('tbody')).toContainText('2026 Service Order PT Mitra Nusantara 01');
  const latestHeaders = page.getByRole('region', { name: 'Latest Documents', exact: true }).first().locator('thead th');
  const expiringColumns = await headers.evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().x)));
  const latestColumns = await latestHeaders.evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().x)));
  expect(latestColumns).toEqual(expiringColumns);
});

test('DD names follow the selected language across settings, structure, audit and upload', async ({ page }) => {
  const data = buildDemoDataset();
  const tenant = data.tenants[0];
  const settings = { ...tenant.settings, modules: { ...tenant.settings.modules, newsTicker: true } };
  const checklist = buildDueDiligenceChecklist(settings);
  const partner = data.partners[0];
  partner.daftar_dokumen_dd = checklist.map(item => ({
    key: item.key, nama: localize(item.label, 'ID'), wajib: item.required, status: 'Missing', files: [],
  }));
  // Exercise a pre-key document alongside the current keyed documents.
  delete partner.daftar_dokumen_dd[0].key;
  await page.route('**/api/init-data', route => route.fulfill({ json: workspaceInit(tenant.id, { ...data, partners: [partner] }) }));
  await page.route('**/api/organizations/*/policy', route => route.fulfill({ json: policyView({ ...tenant, settings }, { dueDiligenceChecklist: checklist }) }));
  await page.goto('/');
  await expect(page.getByText('Test news').first()).toBeVisible();

  for (const language of ['EN', 'ID', 'ZH'] as const) {
    const text = (key: string) => translations[language][key];
    await page.locator('header button').filter({ hasText: /^(EN|ID|ZH)$/ }).click();
    await page.getByRole('dialog').locator(`button[lang="${language === 'ZH' ? 'zh-CN' : language.toLowerCase()}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'ZH' ? 'zh-CN' : language.toLowerCase());
    const names = checklist.map(item => localize(item.label, language));

    // One Settings entry; the checklist lives in the Organization tab's contract-rules section.
    await page.getByRole('button', { name: text('nav.settings'), exact: true }).click();
    await expect(page.getByRole('tab', { name: text('tb.tab_organization'), exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: text('tb.section_contracts') }).click();
    for (const name of names) await expect(page.getByRole('list').getByText(name, { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: text('nav.hierarchy'), exact: true }).click();
    const expand = page.getByRole('button', { name: `${text('nav.buka_submenu')}: ${partner.nama_partner}`, exact: true });
    await expand.click();
    for (const name of names) await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: text('nav.partners'), exact: true }).click();
    await page.locator(`button[title="${text('partners.klik_untuk_audit_checklist_due_diligence')}"]`).first().click();
    const audit = page.getByRole('dialog', { name: partner.nama_partner, exact: true });
    for (const name of names) await expect(audit.getByText(name, { exact: true })).toBeVisible();
    await audit.getByRole('button', { name: text('partners.upload_file'), exact: true }).first().click();
    const upload = page.getByRole('dialog', { name: text('partners.upload_dd_modal_title'), exact: true });
    await expect(upload.getByText(names[0], { exact: true })).toBeVisible();
    if (language === 'ZH') {
      await page.route(`**/api/partners/${partner.partner_id}/upload-dd`, route => route.fulfill({ json: { partner } }));
      await upload.locator('input[type="file"]').setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nDD fixture') });
      const request = page.waitForRequest(request => request.url().endsWith('/upload-dd') && request.method() === 'POST');
      await upload.getByRole('button', { name: text('partners.upload_to_drive_btn'), exact: true }).click();
      expect((await request).postDataJSON().docName).toBe(partner.daftar_dokumen_dd[0].nama);
      await expect(upload).toBeHidden();
    } else {
      await upload.getByRole('button', { name: text('eval.btn_cancel'), exact: true }).click();
    }
    await audit.getByRole('button', { name: text('common.close'), exact: true }).click();
  }
});

test('latest records combine contracts and order forms in creation order', async ({ page }) => {
  const data = buildDemoDataset();
  data.contracts[0].created_at = daysAgo(10);
  data.ios[0].created_at = daysAgo(5);
  const tenantId = data.tenants[0].id;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const records = [
    ...data.contracts.filter(record => !record.organizationId || record.organizationId === tenantId).map(record => ({ title: record.judul_kontrak, createdAt: record.created_at })),
    ...data.ios.filter(record => !record.organizationId || record.organizationId === tenantId).map(record => ({ title: record.judul_io, createdAt: record.created_at })),
  ].filter(record => Date.parse(record.createdAt) >= cutoff.getTime()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const section = page.getByRole('region', { name: 'Latest Documents', exact: true }).first();
  await expect(section.locator('tbody tr')).toHaveCount(records.length);
  await expect(section.locator('tbody tr').first()).toContainText(records[0].title);
  const checkboxes = section.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(records.length + 1);
  for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeDisabled();
  await section.getByRole('button', { name: `Open ${records[0].title}` }).click();
  await expect(section).toBeHidden();
});

test('create document toolbar exposes the four standard filters', async ({ page }) => {
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search Document', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Document Status', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Document Type', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Created By', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveCount(0);
  for (const column of ['Name', 'Type', 'Status', 'Modified', 'Created by', 'Action']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('columnheader', { name: 'Created', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Size', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Created', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Created', exact: true }).check();
  await expect(page.getByRole('columnheader', { name: 'Created', exact: true })).toBeVisible();
});

test('header controls align, desktop checkboxes stay 14px and dropdowns share Contracts styling', async ({ page }) => {
  // Selects use transition-colors; without this the dark-mode comparison can
  // sample a color mid-transition and compare unequal intermediate values.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const controls = page.locator('header [data-slot="button-root"][data-size="icon-md"]:visible');
  const md = await controlSize(page, 'md');
  for (const control of await controls.all()) {
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBe(md);
    expect(bounds!.height).toBe(md);
  }
  for (const icon of await page.locator('header [data-slot="button-root"][data-size="icon-md"] > svg:visible').all()) {
    expect((await icon.boundingBox())!.height).toBe(16);
  }
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  for (const checkbox of await page.locator('input[type="checkbox"]:visible').all()) {
    expect((await checkbox.boundingBox())!.width).toBe(14);
    expect((await checkbox.boundingBox())!.height).toBe(14);
  }
  const dropdownStyle = (select: ReturnType<typeof page.getByRole>) => select.evaluate(element => {
    const css = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, radius: css.borderRadius, border: css.borderColor, background: css.backgroundColor, color: css.color, fontSize: css.fontSize, fontWeight: css.fontWeight, arrow: css.backgroundImage, arrowSize: css.backgroundSize, padding: css.padding };
  });
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
    const reference = await dropdownStyle(page.getByRole('combobox').first());
    expect(reference.height).toBe(md);
    for (const select of await page.locator('select:visible').all()) expect(await dropdownStyle(select)).toEqual(reference);
    await page.getByRole('button', { name: 'My Documents', exact: true }).click();
    for (const select of await page.locator('select:visible').all()) expect(await dropdownStyle(select)).toEqual(reference);
    await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
    await page.getByRole('button', { name: 'Add Contract', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    for (const select of await page.getByRole('dialog').locator('select:visible').all()) expect(await dropdownStyle(select)).toEqual(reference);
    await page.getByRole('dialog').getByRole('button', { name: /close/i }).first().focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    for (const submenu of await page.getByRole('button', { name: /^(Open|Close) Submenu$/ }).all()) {
      await submenu.hover();
      await expect(submenu).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
  }
  await page.screenshot({ path: test.info().outputPath('controls-desktop-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const control of await controls.all()) expect((await control.boundingBox())!.height).toBe(md);
  for (const select of await page.locator('select:visible').all()) expect((await select.boundingBox())!.height).toBe(md);
  await page.screenshot({ path: test.info().outputPath('controls-mobile-dark.png'), fullPage: true });
});

test('single-line inputs and selects share one height and font size across core forms', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fieldSelector = [
    'input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
    'select:visible:not([multiple])',
    'button[role="combobox"]:visible',
  ].join(', ');

  const checkDialog = async () => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const fields = dialog.locator(fieldSelector);
    expect(await fields.count()).toBeGreaterThan(1);
    const fontSizes = new Set<string>();
    const md = await controlSize(page, 'md');
    for (const field of await fields.all()) {
      expect((await field.boundingBox())!.height).toBe(md);
      fontSizes.add(await field.evaluate(element => getComputedStyle(element).fontSize));
    }
    expect([...fontSizes]).toEqual(['14px']);
    await dialog.getByRole('button', { name: /close/i }).first().click();
    await expect(dialog).toBeHidden();
  };

  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  await page.getByRole('button', { name: 'Add Contract', exact: true }).click();
  await checkDialog();

  await page.getByRole('button', { name: 'Partners', exact: true }).click();
  await page.getByRole('button', { name: 'Add Partner', exact: true }).click();
  await checkDialog();

  await page.getByRole('button', { name: 'Partner Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Add Spending', exact: true }).click();
  await checkDialog();
});

test('New Document matches primary action styling on desktop and mobile in both themes', async ({ page }) => {
  const style = (button: ReturnType<typeof page.getByRole>) => button.evaluate(element => {
    const css = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, radius: css.borderRadius, fontSize: css.fontSize, fontWeight: css.fontWeight, background: css.backgroundColor, color: css.color };
  });
  const navigate = async (name: string | RegExp) => {
    const link = page.getByRole('button', { name, exact: true }).first();
    if (!await link.isVisible()) await page.getByRole('button', { name: 'Open Navigation Menu', exact: true }).click();
    await link.click();
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      await navigate(/^Contracts(?: \d+)?$/);
      const reference = await style(page.getByRole('button', { name: 'Add Contract', exact: true }));
      await navigate('My Documents');
      const newDocument = page.getByRole('button', { name: 'New Document', exact: true });
      await expect(newDocument).toBeVisible();
      expect(await style(newDocument)).toEqual(reference);
      expect((await newDocument.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
  }
});

test('large, medium and small actions keep icon-and-text labels inside their buttons', async ({ page }) => {
  test.setTimeout(90_000);
  for (const width of [1440, 390]) {
    const navigate = async (name: string | RegExp) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name, exact: true }).first().click();
      await page.setViewportSize({ width, height: 1000 });
    };
    await navigate('Main Dashboard');
    const currencies = page.getByRole('radiogroup', { name: 'Reporting currency', exact: true });
    await expectReadableAction(currencies.locator('[data-part="item"]', { hasText: 'USD' }), 'md');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /^Contract and due diligence rules/ }).click();
    await page.setViewportSize({ width, height: 1000 });
    await expectReadableAction(page.getByRole('button', { name: 'Save Profile', exact: true }), 'md');
    await expectReadableAction(page.getByRole('button', { name: 'Add checklist item', exact: true }), 'md');

    await navigate('Partners');
    await expectReadableAction(page.getByRole('button', { name: 'Add Partner', exact: true }), 'md');
    await page.getByRole('button', { name: 'Add Partner', exact: true }).click();
    await expectReadableAction(page.getByRole('dialog').getByRole('button', { name: 'Add identifier', exact: true }), 'md');
    await page.keyboard.press('Escape');

    await navigate('Partner Spending');
    await page.getByRole('button', { name: 'Add Spending', exact: true }).click();
    await expectReadableAction(page.getByRole('dialog').getByRole('button', { name: 'Add Month', exact: true }), 'md');
    await page.keyboard.press('Escape');

    await navigate(/^(Explorer|Explore|Document Structure)$/);
    await page.getByRole('tab', { name: 'Table View', exact: true }).click();
    for (const button of await page.locator('main .mobile-page-actions:not([role="tablist"]) button').all()) {
      await expectReadableAction(button, 'md');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});

test('draft history small actions retain readable text on desktop and mobile', async ({ page }) => {
  test.setTimeout(60_000);
  const now = new Date().toISOString();
  const document = {
    id: 'button-history', organization_id: buildDemoDataset().tenants[0].id,
    name: 'Button history fixture', content: '<p>Saved draft</p>', type: 'contract', status: 'draft',
    file_size: 40, current_version: 2, draft_count: 2, created_by: 'audit@example.com',
    created_by_name: 'UI Audit', modified_by: null, modified_by_name: null, created_at: now, modified_at: now,
  };
  await page.route('**/api/documents**', route => {
    const path = new URL(route.request().url()).pathname;
    const response = path.endsWith('/drafts') ? [2, 1].map(version_number => ({
      version_number, draft_name: null, labels: [], file_size: 40, save_kind: 'manual',
      restored_from: null, saved_by: 'audit@example.com', saved_by_name: 'UI Audit', saved_at: now,
    })) : path === '/api/documents' ? { documents: [document], total: 1, page: 1, limit: 25, creators: [] } : document;
    return route.fulfill({ json: response });
  });
  await page.route('**/api/metadata-fields', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: document.name, exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const panel = page.locator('.editor-panel-content');
  // Document info: paired facts share a row, and every row is 16px apart.
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const item = (label: string) => panel.locator('dl > div').filter({ has: page.locator('dt, label', { hasText: new RegExp(`^${label}$`) }) });
  const box = async (label: string) => (await item(label).boundingBox())!;
  const [name, type, status, created, modified, organization, versions] = await Promise.all(
    ['Name', 'Type', 'Status', 'Created', 'Modified', 'Organization', 'Versions'].map(box),
  );
  for (const [left, right] of [[created, modified], [organization, versions], [type, status]]) {
    expect(right.y).toBe(left.y);
    expect(right.x).toBeGreaterThan(left.x + left.width);
  }
  // Read-only facts first, the editable Type/Status pair last; every row is 16px apart.
  expect(created.y - (name.y + name.height)).toBe(16);
  expect(organization.y - (created.y + Math.max(created.height, modified.height))).toBe(16);
  expect(type.y - (organization.y + Math.max(organization.height, versions.height))).toBe(16);
  await page.screenshot({ path: test.info().outputPath('document-info.png'), fullPage: true });
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 1024) {
      const toggle = page.getByTitle(/Toggle.*Panel|Open.*Panel|Form.*Clause|Buka.*Panel/i);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }
    await expect(panel).toBeVisible();
    for (const action of ['View', 'Compare', 'Restore', 'Name']) {
      await expectReadableAction(panel.getByRole('button', { name: action, exact: true }).first(), 'sm');
    }
    // Restore takes the header slot the current version uses for its badge.
    const [latest, older] = await panel.locator('li.editor-panel-card').all();
    const badge = (await latest.getByText('Current', { exact: true }).boundingBox())!;
    const title = (await older.getByText('Version 1', { exact: true }).boundingBox())!;
    const restore = (await older.getByRole('button', { name: 'Restore', exact: true }).boundingBox())!;
    expect(Math.abs(restore.x + restore.width - (badge.x + badge.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(restore.y + restore.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(2);
    await expect(latest.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`history-buttons-${width}.png`), fullPage: true });
  }
});

test('mobile editor keeps a usable canvas and opens its panel as a dismissible overlay', async ({ page }) => {
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click();
  await page.getByRole('button', { name: 'Blank document', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = page.locator('.tiptap.ProseMirror:visible');
  await expect.poll(async () => (await editor.boundingBox())!.width).toBeGreaterThan(200);
  await editor.fill('A draft that remains editable on mobile.');
  const toggle = page.getByTitle(/Toggle.*Panel|Open.*Panel|Form.*Clause|Buka.*Panel/i);
  await toggle.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(editor).toContainText('A draft that remains editable on mobile.');
});

test('table actions support keyboard dismissal; mobile identity scrolls without freezing', async ({ page }) => {
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  await expect(page.getByRole('button', { name: 'Add Contract', exact: true })).toBeVisible();
  const originalRowCount = await page.locator('tbody tr').count();
  const trigger = page.getByRole('button', { name: 'Actions', exact: true }).first();
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('no matching result');
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  await page.setViewportSize({ width: 390, height: 844 });
  const scroller = page.locator('.data-table-scroll');
  await scroller.evaluate(el => { el.scrollLeft = 500; });
  const identity = page.locator('tbody tr').first().locator('td').nth(1);
  const rect = await identity.boundingBox();
  expect(rect!.x).toBeLessThan(0);
  await expect(identity).toHaveCSS('position', 'static');
  await expect(page.getByRole('combobox', { name: 'Document type' })).toBeVisible();
});

test('Contracts mobile layout is justified without a visible breadcrumb, scroll hint or frozen identity', async ({ page }) => {
  await page.getByRole('button', { name: /^Contracts(?: \d+)?$/ }).click();
  await page.getByRole('button', { name: 'Add Contract', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const actions = page.locator('.contracts-mobile-actions');
  const filters = page.locator('.contracts-mobile-filters');
  const desktop = await actions.evaluate(element => {
    const css = getComputedStyle(element);
    return { display: css.display, width: element.getBoundingClientRect().width, gap: css.gap };
  });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      const language = page.locator('header select:visible');
      await expect(language).toHaveValue('EN');
      expect(await language.evaluate(element => {
        const css = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        return element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) > context.measureText('EN').width;
      })).toBe(true);
      await expect(page.locator('.app-header > div:first-child > div')).toHaveCSS('clip-path', 'inset(50%)');
      const buttons = await actions.locator('button').all();
      const first = (await buttons[0].boundingBox())!;
      const second = (await buttons[1].boundingBox())!;
      expect(first.y).toBe(second.y);
      expect(first.width).toBeCloseTo(second.width, 0);
      const fields = await filters.locator(':scope > *').all();
      const search = (await fields[0].boundingBox())!;
      expect(search.width).toBeCloseTo((await filters.boundingBox())!.width, 0);
      for (const [left, right] of [[1, 2], [3, 4]]) {
        const a = (await fields[left].boundingBox())!;
        const b = (await fields[right].boundingBox())!;
        expect(a.y).toBe(b.y);
        expect(a.width).toBeCloseTo(b.width, 0);
      }
      await expect(page.locator('.mobile-table-hint')).toBeHidden();
      await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveCSS('position', 'static');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      if (width === 390 && dark) await page.screenshot({ path: test.info().outputPath('contracts-mobile-justified.png'), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => actions.evaluate(element => {
    const css = getComputedStyle(element);
    return { display: css.display, width: element.getBoundingClientRect().width, gap: css.gap };
  })).toEqual(desktop);
  await expect(page.locator('.app-header h1')).toBeVisible();
  await expect(filters).toHaveCSS('display', 'flex');
});

for (const section of ['Main Dashboard', 'Partners', 'Order Forms', 'Partner Spending', 'Partner Evaluation', 'Notifications', 'My Documents', 'Activity Logs', 'Import Data', 'Explorer']) {
  test(`${section} shares justified mobile controls and scrollable tables`, async ({ page }) => {
    if (section.startsWith('Partner ')) await page.getByRole('button', { name: 'Partners', exact: true }).click();
    const navigation = section === 'Order Forms' ? /^(Order Forms|Service Orders)(?: \d+)?$/
      : section === 'Notifications' ? /^Notifications(?: \d+)?$/
      : section === 'Explorer' ? /^(Explorer|Explore|Document Structure)$/ : section;
    // Operational activity is no longer a page: it opens in the Settings History drawer (PRD §6.4).
    const scope = section === 'Activity Logs' ? await openActivityHistory(page) : page.locator('main');
    if (section !== 'Activity Logs') await page.getByRole('button', { name: navigation, exact: true }).click();
    await expect(scope).toBeVisible();
    if (section === 'Explorer') await page.getByRole('tab', { name: 'Table View', exact: true }).click();
    if (section === 'Import Data') {
      await page.locator('main input[type="file"]').setInputFiles({ name: 'mobile-preview.csv', mimeType: 'text/csv', buffer: Buffer.from('nama_partner,partner_channel,country\nFixture Partner,Procurement,ID\n') });
      await expect(page.locator('main table')).toContainText('Fixture Partner');
    }
    const controls = scope.locator('.mobile-page-actions, .mobile-filter-grid');
    await expect(controls.first()).toBeVisible();
    const desktop = await controls.evaluateAll(elements => elements.map(element => getComputedStyle(element).display));
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        for (const control of await controls.all()) {
          await expect(control).toHaveCSS('display', 'grid');
          const box = (await control.boundingBox())!;
          for (const field of await control.locator(':scope > :visible:not(.sr-only)').all()) {
            const bounds = (await field.boundingBox())!;
            expect(bounds.x).toBeGreaterThanOrEqual(box.x - 1);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width + 1);
          }
        }
        for (const table of await scope.locator('table:visible').all()) {
          expect(await table.evaluate(element => getComputedStyle(element.parentElement!).overflowX)).toMatch(/auto|scroll/);
          for (const cell of await table.locator('tbody tr:first-child > td:nth-child(-n+2)').all()) {
            await expect(cell).not.toHaveCSS('position', 'sticky');
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      }
    }
    await page.screenshot({ path: test.info().outputPath(`${section.replaceAll(' ', '-')}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    expect(await controls.evaluateAll(elements => elements.map(element => getComputedStyle(element).display))).toEqual(desktop);
  });
}

test('all admin tabs keep mobile controls contained and tables scrollable', async ({ page }) => {
  test.setTimeout(90_000);
  await becomeSuperuser(page, api);
  await page.getByRole('button', { name: 'System Admin', exact: true }).click();
  const systemTabs = page.getByRole('tablist', { name: 'System Admin' });
  await expect(systemTabs).toBeVisible();
  await expect(systemTabs.getByRole('tab')).toHaveText([
    'Dashboard', /^Users(?:\s*\d+)?$/, /^Sessions(?:\s*\d+)?$/, /^Organizations(?:\s*\d+)?$/, /^API Keys(?:\s*\d+)?$/,
  ]);
  for (const submenu of ['Dashboard', 'Google & storage', 'AI Model & Parser', 'SMTP relay', 'UI texts', 'Database & reset']) {
    await expect(page.locator('aside').getByRole('button', { name: submenu, exact: true })).toBeVisible();
  }
  // Departments and invitations are tenant-scoped now (Settings › Members & Access).
  for (const tab of ['Dashboard', 'Users', 'Sessions', 'Organizations', 'API Keys']) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('tab', { name: new RegExp(`^${tab}(?: \\d+)?$`) }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const control of await panel.locator('.mobile-controls-bar').all()) {
        const box = (await control.boundingBox())!;
        for (const field of await control.locator(':scope > :visible').all()) {
          const bounds = (await field.boundingBox())!;
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
      }
      for (const table of await panel.locator('table:visible').all()) {
        expect(await table.evaluate(element => getComputedStyle(element.parentElement!).overflowX)).toMatch(/auto|scroll/);
        await expect(table.locator('th').first()).not.toHaveCSS('position', 'sticky');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }
    await page.screenshot({ path: test.info().outputPath(`admin-${tab.replaceAll(' ', '-')}-mobile.png`), fullPage: true });
  }
});

test('all settings pages and UI text modal keep mobile controls contained', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/api/auth-console/sqlite/**', route => {
    const path = new URL(route.request().url()).pathname;
    const fixtures: Record<string, unknown> = {
      '/api/auth-console/sqlite/status': { success: true, status: 'healthy', journalMode: 'wal', version: '3.50.0', fileSizeBytes: 4096, pageCount: 1, pageSize: 4096, modifiedAt: null, tablesCount: 1, totalRecords: 1, tableSummaries: { contracts: 1 } },
      '/api/auth-console/sqlite/tables': { success: true, tables: [{ name: 'contracts', count: 1, columnsCount: 2 }] },
      '/api/auth-console/sqlite/table-data': { success: true, table: 'contracts', columns: [{ cid: 0, name: 'id', type: 'TEXT', pk: 1 }, { cid: 1, name: 'title', type: 'TEXT', pk: 0 }], rows: [{ id: 'fixture-1', title: 'Fixture contract' }], total: 1, limit: 15, offset: 0 },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  // Tenant Settings: one entry, three tabs.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const label of ['Organization', 'Members & Access', 'Integrations']) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: label })).toBeVisible();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }
  }
  // Platform configuration sections are direct System Admin submenu pages.
  await becomeSuperuser(page, api);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'System Admin', exact: true }).click();
  for (const label of ['Google & storage', 'AI Model & Parser', 'SMTP relay', 'UI texts', 'Database & reset']) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    if (label === 'Google & storage') await expect(page.locator('main table')).toContainText('Fixture contract');
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      if (label === 'Google & storage') {
        const search = page.locator('.mobile-search-form');
        await expect(search.getByRole('textbox')).toBeVisible();
        expect((await search.getByRole('textbox').boundingBox())!.width).toBeGreaterThan(80);
        expect(await page.locator('main table').evaluate(element => getComputedStyle(element.parentElement!).overflowX)).toBe('auto');
      }
    }
    if (label === 'UI texts') {
      await page.getByRole('button', { name: 'Open UI Text Editor', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.mobile-page-actions')).toHaveCSS('display', 'grid');
      expect(await dialog.locator('table').evaluate(element => getComputedStyle(element.parentElement!).overflowX)).toBe('auto');
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: test.info().outputPath('ui-text-mobile.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }
  }
});

for (const [section, add] of [['Partners', 'Add Partner'], ['Order Forms', 'Add Order Form'], ['Partner Spending', 'Add Spending'], ['Partner Evaluation', 'Add Evaluation']]) {
  test(`${section} form uses a labelled dialog with focus restoration`, async ({ page }) => {
    if (section.startsWith('Partner ')) await page.getByRole('button', { name: 'Partners', exact: true }).click();
    await page.getByRole('button', { name: section === 'Order Forms' ? /^(Order Forms|Service Orders)(?: \d+)?$/ : section, exact: true }).click();
    const trigger = page.getByRole('button', { name: add === 'Add Order Form' ? /^Add (Order Form|Service Order)$/ : add, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/.+/);
    await page.setViewportSize({ width: 320, height: 740 });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('chart exposes every month, has theme colors and keeps dashboard checkboxes disabled', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: 'Year', exact: true })).toHaveValue(String(new Date().getFullYear()));
  await expect(page.locator('.recharts-xAxis .recharts-cartesian-axis-tick')).toHaveCount(12);
  await expect(page.locator('.recharts-cartesian-grid')).toBeVisible();
  for (const checkbox of await page.locator('.dashboard-data-table input[type="checkbox"]').all()) await expect(checkbox).toBeDisabled();
  await page.getByRole('button', { name: /Switch to Dark Mode/i }).click();
  expect(await page.locator('.recharts-wrapper').evaluate(el => getComputedStyle(el).getPropertyValue('--chart-grid').trim())).toBe('#334155');
  await page.setViewportSize({ width: 390, height: 844 });
  const chartControls = [
    page.getByRole('combobox', { name: 'Year', exact: true }),
    page.getByRole('combobox', { name: 'Category', exact: true }),
    page.getByRole('radiogroup', { name: 'Reporting currency', exact: true }),
  ];
  const controlBoxes = await Promise.all(chartControls.map(control => control.boundingBox()));
  expect(Math.abs(controlBoxes[0]!.y - controlBoxes[1]!.y)).toBeLessThan(2);
  expect(controlBoxes[0]!.width).toBeCloseTo(controlBoxes[1]!.width, 0);
  expect(controlBoxes[2]!.y).toBeGreaterThan(controlBoxes[0]!.y + controlBoxes[0]!.height);
  expect(controlBoxes[2]!.width).toBeCloseTo((await page.locator('main .mobile-filter-grid').boundingBox())!.width, 0);
  const chart = page.locator('.recharts-responsive-container');
  const chartBox = await chart.boundingBox();
  expect(chartBox!.width).toBeLessThanOrEqual(358);
  expect(chartBox!.width).toBeGreaterThan(280);
  expect(chartBox!.height).toBeGreaterThanOrEqual(220);
});

for (const width of [1440, 390]) {
  test(`document editor panels stay usable at ${width}px in both themes`, async ({ page }) => {
    await page.route('**/api/metadata-fields', route => route.fulfill({ json: [] }));
    await page.route('**/api/templates*', route => route.fulfill({ json: [] }));
    await page.getByRole('button', { name: 'My Documents', exact: true }).click();
    await page.getByRole('button', { name: 'New Document', exact: true }).first().click();
    await page.getByRole('button', { name: 'Blank document', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024) {
      await page.getByTitle(/Toggle.*Panel|Open.*Panel|Form.*Clause|Buka.*Panel/i).click();
    }
    const tabs = page.locator('.editor-panel-nav [role="tab"]');
    await expect(tabs).toHaveCount(7);
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      for (const tab of await tabs.all()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        const panel = page.locator('.editor-panel-content');
        await expect(panel).toBeVisible();
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        for (const button of await panel.locator('button:visible').all()) {
          expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
        }
      }
      await expect(page.getByText('Select text in the document, then choose Comment or Suggest Change.', { exact: false })).toHaveCount(0);
      await expect(page.getByText('AI reviews the whole document against', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'AI Redlining', exact: true })).toBeVisible();
    }
    await tabs.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await tabs.nth(3).click();
    const slots = page.locator('.tiptap.ProseMirror [data-slot-key]');
    const previousSlots = await slots.count();
    const insert = page.getByRole('button', { name: /^Insert field:/ }).first();
    await insert.focus();
    await page.keyboard.press('Enter');
    await expect(slots).toHaveCount(previousSlots + 1);
    await tabs.last().click();
    await page.screenshot({ path: `/tmp/editor-panels-${width}.png` });
  });
}

test('Parties panel selects a registered partner and edits both agreement parties', async ({ page }) => {
  await page.route('**/api/templates*', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click();
  await page.getByRole('button', { name: 'Blank document', exact: true }).click();
  await page.getByRole('tab', { name: 'Parties', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Parties', exact: true })).toBeVisible();
  const partnerSelect = page.getByRole('combobox', { name: 'Select Existing Partner', exact: true });
  expect(await partnerSelect.evaluate(element => element.closest('details')?.textContent?.includes('Second Party'))).toBe(true);
  await partnerSelect.selectOption({ index: 1 });

  const secondPartyName = page.getByRole('textbox', { name: 'Second Party Company Name', exact: true });
  const firstPartyName = page.getByRole('textbox', { name: 'First Party Company Name', exact: true });
  await expect(secondPartyName).toHaveValue(/PT Mitra Nusantara/);
  await expect(firstPartyName).not.toHaveValue('');

  await secondPartyName.fill('Edited Second Party Ltd.');
  await firstPartyName.fill('Edited First Party Ltd.');
  const editor = page.locator('.tiptap.ProseMirror:visible');
  await expect(editor).toContainText('Edited Second Party Ltd.');
  await expect(editor).toContainText('Edited First Party Ltd.');

  const secondPartySection = page.locator('details').filter({ hasText: 'Second Party' }).first();
  await secondPartySection.locator('summary').click();
  await expect(secondPartyName).toBeHidden();
  await secondPartySection.locator('summary').click();
  await expect(secondPartyName).toBeVisible();
  await page.locator('.editor-panel-content').evaluate(element => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: '/tmp/document-editor-parties-1440.png' });

  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = page.getByRole('dialog');
    if (!(await dialog.isVisible())) {
      await page.getByTitle(/Toggle.*Panel|Open.*Panel|Form.*Clause|Buka.*Panel/i).click();
    }
    await expect(dialog.getByRole('heading', { name: 'Parties', exact: true })).toBeVisible();
    const panel = dialog.locator('.editor-panel-content');
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.evaluate(element => element.scrollTo({ top: 0 }));
    await page.screenshot({ path: `/tmp/document-editor-parties-${width}.png` });
  }
});

/** Buttons sitting on the same row as a form field whose height differs from it. */
async function misalignedRowActions(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const fieldSelector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select:not([multiple]), button[role="combobox"]';
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const scopes = [...document.querySelectorAll('main, [role="dialog"]')];
    const issues = new Set<string>();
    for (const field of scopes.flatMap(scope => [...scope.querySelectorAll(fieldSelector)]).filter(visible)) {
      const fieldBox = field.getBoundingClientRect();
      let row = field.parentElement;
      for (let depth = 0; depth < 3 && row; depth++, row = row.parentElement) {
        for (const button of row.querySelectorAll('button:not([role="combobox"]):not([role="tab"]):not([role="switch"]), a.ui-button')) {
          // Icons placed inside the field box (date pickers, clear buttons) are not row actions.
          if (!visible(button) || button.contains(field) || getComputedStyle(button).position === 'absolute') continue;
          const box = (button.closest('[role="group"]') ?? button).getBoundingClientRect();
          const overlap = Math.min(box.bottom, fieldBox.bottom) - Math.max(box.top, fieldBox.top);
          if (overlap < Math.min(box.height, fieldBox.height) / 2) continue;
          if (Math.abs(box.height - fieldBox.height) > 1) {
            issues.add(`${(button.getAttribute('aria-label') || button.textContent || '').trim()} ${Math.round(box.height)}px beside ${Math.round(fieldBox.height)}px field`);
          }
        }
      }
    }
    return [...issues];
  });
}

/**
 * Filled (primary/destructive) actions and form submits are commits or page
 * actions, so they all use the large size. Segments, tabs, table-row actions
 * and the listed card-level actions are lower in the hierarchy (docs/design-system/STANDARD.md §3).
 */
async function undersizedPrimaryActions(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const cardLevel = new Set(['Auto-Create in Drive', 'Export CSV']);
    const issues: string[] = [];
    for (const button of document.querySelectorAll('main button, [role="dialog"] button')) {
      const box = button.getBoundingClientRect();
      if (!box.width || button.closest('[aria-pressed], [role="tab"], [role="tablist"], td')) continue;
      const [r, g, b, a = 1] = getComputedStyle(button).backgroundColor.match(/[\d.]+/g)!.map(Number);
      const filled = a > 0.5 && Math.max(r, g, b) - Math.min(r, g, b) > 60;
      if (!filled && (button as HTMLButtonElement).type !== 'submit') continue;
      const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
      if (!cardLevel.has(label) && Math.round(box.height) !== 40) issues.push(`${label} ${Math.round(box.height)}px`);
    }
    return issues;
  });
}

test('field rows and primary actions follow the control size scale', async ({ page }) => {
  test.setTimeout(120_000);
  // Platform administrator explicitly managing the organization: operational views, Settings and System Admin.
  await becomeSuperuser(page, api);
  const issues: string[] = [];
  const check = async (where: string) => {
    await page.waitForTimeout(300);
    for (const issue of await misalignedRowActions(page)) issues.push(`${where}: ${issue}`);
    for (const issue of await undersizedPrimaryActions(page)) issues.push(`${where}: primary ${issue}`);
  };
  for (const width of [1440, 390]) {
    const open = async (name: string | RegExp) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name, exact: true }).first().click();
      await page.setViewportSize({ width, height: 1000 });
    };
    for (const section of ['Main Dashboard', /^Contracts(?: \d+)?$/, 'Partners', /^(Order Forms|Service Orders)(?: \d+)?$/, 'Partner Spending', 'Partner Evaluation', /^Notifications(?: \d+)?$/, 'My Documents', 'Import Data']) {
      if (section === 'Partner Spending') await open('Partners');
      await open(section);
      await check(`${width} ${section}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openActivityHistory(page);
    await page.setViewportSize({ width, height: 1000 });
    await check(`${width} Activity history`);
    await page.keyboard.press('Escape');
    await open(/^Contracts(?: \d+)?$/);
    await page.getByRole('button', { name: 'Add Contract', exact: true }).click();
    await check(`${width} Add Contract`);
    await page.keyboard.press('Escape');
    await open('Partners');
    await page.getByRole('button', { name: 'Add Partner', exact: true }).click();
    await check(`${width} Add Partner`);
    await page.keyboard.press('Escape');
    await open('Settings');
    for (const label of ['Organization', 'Members & Access', 'Integrations']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      if (label === 'Organization') {
        const collapsed = page.locator('main button[aria-expanded="false"][aria-controls^="org-section-"]');
        while (await collapsed.count()) await collapsed.first().click();
      }
      await check(`${width} settings ${label}`);
    }
    await open('System Admin');
    for (const tab of ['Dashboard', 'Users', 'Sessions', 'Organizations', 'API Keys']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}(?: \\d+)?$`) }).click();
      await check(`${width} admin ${tab}`);
    }
    for (const label of ['Google & storage', 'AI Model & Parser', 'SMTP relay', 'UI texts', 'Database & reset']) {
      await open(label);
      await check(`${width} configuration ${label}`);
    }
  }
  expect(issues).toEqual([]);
});
