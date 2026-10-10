import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './tests/e2e/isolated/state';

/**
 * Live browser suite against an isolated server (tenant-boundaries PRD §15).
 *
 * globalSetup starts the bundled server with APP_TEST_MODE=1 in a fresh
 * temporary directory, seeds synthetic `example.test` fixtures and serves the
 * built frontend through `vite preview` proxied to that server. Nothing here
 * reads or writes the workspace auth.db, uploads/ or data_store.json; run it via
 * `npm run test:e2e:tenant-boundaries`, which also checksums those files.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['organization-onboarding.live.spec.ts', 'tenant-boundaries.live.spec.ts', 'admin-nav-rbac.spec.ts', 'spa-query-routing.spec.ts', 'ui-text-sharing.live.spec.ts'],
  globalSetup: './tests/e2e/isolated/globalSetup.ts',
  fullyParallel: false,
  workers: 1, // tests mutate shared membership state in the one isolated server
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
