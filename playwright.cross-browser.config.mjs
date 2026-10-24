import { defineConfig, devices } from '@playwright/test';

/** Focused browser-engine regression; the complete suite remains Chromium-only.
 * Run this against the SAME production-style Docker image and local origin.
 * WebKit here is desktop WebKit, not a substitute for physical iPhone Safari QA.
 */
export default defineConfig({
  testDir: './tests/cross-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PDF_BASE_URL || 'http://127.0.0.1:18081',
    headless: true,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
