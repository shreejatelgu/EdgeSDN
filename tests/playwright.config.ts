import { defineConfig, devices } from '@playwright/test';
import { ENV } from './fixtures/env';

/**
 * Test levels (run one with --project=<name>):
 *   unit        pure frontend logic, no browser, no servers
 *   integration REST contracts of backend / twin-agent / ML service (no browser)
 *   e2e-mocked  real Angular UI in Chromium, /api answered by an in-browser mock (only the UI must run)
 *   e2e         real UI + real backend
 *   uat         business acceptance scenarios on the real stack
 * Suites that need Mininet + OpenDaylight skip themselves when that part is unavailable
 * (set EDGE_REQUIRE_NETWORK=1 to make them fail instead).
 */
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One shared backend: tests change global state (policy, provider), so run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'reports/html' }],
    ['junit', { outputFile: 'reports/junit.xml' }]
  ],
  use: {
    baseURL: ENV.uiUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    { name: 'unit', testDir: './unit' },
    { name: 'integration', testDir: './integration', timeout: 240_000 },
    { name: 'e2e-mocked', testDir: './e2e/mocked', use: { ...devices['Desktop Chrome'] } },
    { name: 'e2e', testDir: './e2e/live', use: { ...devices['Desktop Chrome'] } },
    { name: 'uat', testDir: './uat', timeout: 480_000, use: { ...devices['Desktop Chrome'] } }
  ],
  // EDGE_START_UI=1 starts (or reuses) the Angular dev server for the browser suites.
  webServer: process.env.EDGE_START_UI === '1'
    ? { command: 'npm start', cwd: '../frontend', url: ENV.uiUrl, reuseExistingServer: true, timeout: 180_000 }
    : undefined
});
