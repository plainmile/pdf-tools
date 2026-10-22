import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PDF_BASE_URL || 'http://127.0.0.1:18081',
    headless: true,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
});
