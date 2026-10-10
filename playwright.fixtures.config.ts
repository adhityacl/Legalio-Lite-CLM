import { defineConfig, devices } from '@playwright/test';

/** Browser regression checks with mocked APIs; the application database is never opened. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['ui-accessibility.spec.ts', 'ui-refinements.spec.ts', 'refactor-regressions.spec.ts', 'spending-form.spec.ts', 'document-calendar.spec.ts', 'settings-tenant-boundaries.spec.ts'],
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:frontend && npx vite preview apps/frontend --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
