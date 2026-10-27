import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixture() {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 2; n++) {
    source.addPage([260, 360]).drawText('PNG EXPORT PAGE ' + n, {
      x: 30, y: 270, size: 16, font,
    });
  }
  return Buffer.from(await source.save());
}

test('Chinese mobile: cancel stalled PDF-to-PNG Blob read, preserve previous ZIP and retry cleanly', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer;
    window.__stallNextPageBlobRead = false;
    window.__stalledPageBlob = null;
    Blob.prototype.arrayBuffer = function () {
      if (window.__stallNextPageBlobRead && this.type === 'image/png') {
        window.__stallNextPageBlobRead = false;
        window.__stalledPageBlob = this;
        return new Promise(() => {}); // Native Blob reader never settles.
      }
      return original.apply(this, arguments);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: await fixture(),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.locator('.utility-options select').first().selectOption('png');
  const firstDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-run').click();
  const earlier = Buffer.from(await readFile(await (await firstDownload).path()));
  await expect(page.getByTestId('image-result')).toBeVisible();
  const firstZip = await JSZip.loadAsync(earlier);
  expect(Object.keys(firstZip.files).sort()).toEqual(['page-001.png', 'page-002.png']);

  const attemptDownloads = [];
  page.on('download', file => attemptDownloads.push(file.suggestedFilename()));
  await page.evaluate(() => { window.__stallNextPageBlobRead = true; });
  await page.getByTestId('utility-run').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__stalledPageBlob))).toBe(true);
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByTestId('utility-cancel')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  await expect(page.getByTestId('image-result')).toBeVisible();
  expect(attemptDownloads).toEqual([]);

  const previousDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('image-download-again').click();
  expect(Buffer.from(await readFile(await (await previousDownload).path())).equals(earlier)).toBe(true);

  const successDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-run').click();
  const retry = await JSZip.loadAsync(await readFile(await (await successDownload).path()));
  expect(Object.keys(retry.files).sort()).toEqual(['page-001.png', 'page-002.png']);
  for (const entry of Object.values(retry.files)) {
    const png = await entry.async('uint8array');
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  const pageWidth = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(pageWidth[0]).toBeLessThanOrEqual(pageWidth[1] + 2);
});
