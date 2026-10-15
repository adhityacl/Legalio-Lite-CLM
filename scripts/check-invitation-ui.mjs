// Run with the frontend server on INVITATION_PREVIEW_URL (default: localhost:5173).
// APIs are mocked: this check does not register accounts or consume invitations.
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.INVITATION_PREVIEW_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let previewStatus = 'pending';
let invitedEmail = 'member@example.com';
let registrationEmail;
let previewFailure = false;
let registrationToken;
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/me') return route.fulfill({ status: 401, json: { error: 'UNAUTHENTICATED' } });
  if (url.pathname === '/api/system/public-status') return route.fulfill({ json: { needsSetup: false } });
  if (decodeURIComponent(url.pathname).includes('malformed\\token')) return route.fulfill({ status: 404, json: { error: 'RESOURCE_NOT_FOUND' } });
  if (url.pathname.endsWith('/preview')) return route.fulfill({
    status: previewFailure ? 503 : 200,
    json: previewFailure ? { error: 'UNAVAILABLE' } : { organizationName: 'ITS', email: invitedEmail, tenantRole: 'manager', status: previewStatus, expiresAt: '2099-01-01' },
  });
  if (url.pathname === '/api/auth/sign-up/email') {
    registrationToken = route.request().headers()['x-invitation-token'];
    registrationEmail = route.request().postDataJSON().email;
    return route.fulfill({ status: 400, json: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' } });
  }
  return route.fulfill({ json: {} });
});

try {
  await page.goto(`${baseURL}/app?accept_invite=test-invitation-token`);
  const title = page.getByRole('heading', { level: 1, name: 'You’ve been invited to join ITS' });
  await expect(title).toBeVisible();
  await expect(page.locator('#signin-email')).toHaveValue('member@example.com');
  await expect(page.locator('#signin-email')).not.toBeEditable();
  await expect(page.getByLabel('Full Name', { exact: true })).toBeVisible();
  await expect(page.getByText('Your workspace role: Manager')).toHaveCount(0);
  await expect(page.getByText('Your invitation is ready. No superuser approval needed.')).toHaveCount(0);
  await expect(page.locator('#invited-email-hint')).toHaveCount(0);
  await expect(page.locator('#signin-invite-code')).toHaveCount(0);
  await expect(page.locator('#signin-password')).toHaveAttribute('autocomplete', 'new-password');
  await page.screenshot({ path: '/tmp/legalio-invitation-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(title).toBeVisible();
  await expect(page.locator('#signin-name')).toHaveCount(0);
  await expect(page.locator('#signin-email')).toHaveValue('member@example.com');
  await expect(page.locator('#signin-email')).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Sign in & continue', exact: true })).toBeVisible();
  await page.reload();
  await expect(title).toBeVisible();
  await expect(page.locator('#signin-name')).toBeVisible();

  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(title).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Create account & continue', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/legalio-invitation-mobile-${width}.png`, fullPage: true });
  }
  await page.locator('#signin-name').fill('New Member');
  await expect(page.locator('#signin-email')).toHaveValue('member@example.com');
  await page.locator('#signin-password').fill('test-password-1234');
  await page.getByRole('button', { name: 'Create account & continue', exact: true }).click();
  await expect.poll(() => registrationToken).toBe('test-invitation-token');
  expect(registrationEmail).toBe('member@example.com');
  invitedEmail = null;
  await page.reload();
  await expect(page.locator('#signin-email')).toBeEditable();
  await page.locator('#signin-email').fill('code-holder@example.com');
  invitedEmail = 'member@example.com';

  previewStatus = 'expired';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This invitation is no longer available' })).toBeVisible();
  await expect(page.locator('#signin-name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue without an invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pendingInvitation'))).toBeNull();
  // Manual invite codes belong to registration, never the sign-in form.
  await expect(page.locator('#signin-invite-code')).toHaveCount(0);
  await page.getByRole('button', { name: /request access/i }).click();
  await expect(page.locator('#signin-invite-code')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#signin-invite-code')).toHaveCount(0);

  previewFailure = true;
  await page.goto(`${baseURL}/?accept_invite=another-invitation-token`);
  await expect(page.getByRole('heading', { name: 'We couldn’t load your invitation' })).toBeVisible();
  previewFailure = false;
  previewStatus = 'pending';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(title).toBeVisible();
  await page.goto(`${baseURL}/app?accept_invite=malformed%5Ctoken`);
  await expect(page.getByRole('heading', { name: 'This invitation is no longer available' })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('Invitation UI passed: registration, sign-in switch, refresh, mobile, token forwarding, expired links, retry, legacy links.');
} finally {
  await browser.close();
}
