import { defineConfig, devices } from '@playwright/test';
import { API_PORT } from './tests/e2e/isolated/state';

export default defineConfig({
  outputDir: './.cache/system-console-test-results',
  testDir: './tests/e2e', testMatch: 'system-console.live.spec.ts',
  globalSetup: './tests/e2e/isolated/systemConsoleSetup.ts',
  fullyParallel: false, workers: 1, retries: 0, timeout: 60_000,
  reporter: [['list']], use: { baseURL: `http://127.0.0.1:${API_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
