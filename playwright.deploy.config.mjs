import { defineConfig } from '@playwright/test';

// The full ~340-test fault-injection suite is mandatory in CI (playwright.config.mjs).
// The release gate only needs real HTTPS browser processing and all 36 SEO
// routes. Running synthetic worker stalls/large-book stress tests against the
// public CDN caused repeated timeout + a false rollback on 2026-10-28.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/public.spec.mjs', '**/public-release-smoke.spec.mjs'],
  fullyParallel: false,
  workers: 1,
  retries: 0, // CI is always strict; deploy requests one public-only network retry.
  timeout: 45000,
  globalTimeout: 8 * 60 * 1000,
  reporter: 'list',
  use: {
    baseURL: process.env.PDF_BASE_URL || 'https://pdf.plainmile.com',
    headless: true,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
});
