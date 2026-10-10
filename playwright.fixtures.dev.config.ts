import { defineConfig } from '@playwright/test';
import base from './playwright.fixtures.config';

/** Exercise lazy dependency loading in development; APIs remain mocked. */
export default defineConfig({
  ...base,
  testMatch: ['ui-refinements.spec.ts', 'refactor-regressions.spec.ts', 'document-calendar.spec.ts'],
  workers: 1,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'npx vite apps/frontend --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
