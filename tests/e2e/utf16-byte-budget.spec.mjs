import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('UTF-16 import exceeding decoded UTF-8 budget fails early without losing prior PDF', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Original draft remains available');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });

  // A real UTF-16 LE text file is comfortably under the file upload cap,
  // but its decoded UTF-8 content is larger than the conversion limit.
  const chinese = '中'.repeat(1_800_000);
  const input = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(chinese, 'utf16le')]);
  const cap = 5 * 1024 * 1024;
  expect(input.length).toBeLessThan(cap);
  expect(Buffer.byteLength(chinese, 'utf8')).toBeGreaterThan(cap);

  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'large-utf16.txt', mimeType: 'text/plain', buffer: input,
  });
  await expect(page.getByTestId('utility-replace-confirm')).toBeVisible();
  await page.getByTestId('utility-replace-accept').click();
  await expect(page.getByRole('alert')).toContainText('Text exceeds 5 MB.', { timeout: 20000 });
  await expect(page.getByTestId('utility-text')).toHaveValue('Original draft remains available');
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();

  const pendingDownload = page.waitForEvent('download');
  await page.getByTestId('utility-pdf-download').click();
  const download = await pendingDownload;
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  expect(pdf.getPageCount()).toBe(1);
});
