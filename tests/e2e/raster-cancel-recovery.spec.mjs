import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixture(pageCount = 2) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    pdf.addPage([330, 460]).drawText('Raster export source ' + i, {
      x: 35, y: 350, size: 16, font,
    });
  }
  return Buffer.from(await pdf.save());
}

async function upload(page, count = 2) {
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'raster-source.pdf', mimeType: 'application/pdf', buffer: await fixture(count),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
}

test('Cancel frees a stalled encoder and retains previous ZIP for download before a valid retry', async ({ page }) => {
  // A stalled toBlob callback is an actual browser failure mode; the PDF.js
  // page render has already completed, so cancelling that render alone is not
  // enough to unblock the editor.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__stallNextRasterEncode = false;
    window.__stalledRasterCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, mime, quality) {
      if (window.__stallNextRasterEncode && mime === 'image/jpeg' &&
          this.width > 1 && this.height > 1) {
        window.__stallNextRasterEncode = false;
        window.__stalledRasterCanvas = this;
        return; // Simulates an encoder that never calls back.
      }
      return original.call(this, callback, mime, quality);
    };
  });
  await page.goto('/pdf-to-images/');
  await upload(page);
  // An earlier successful conversion is the only copy if the browser blocked
  // the automatic save. Failure on the next retry must not erase its fallback.
  const firstPending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-run').click();
  const firstFile = await firstPending;
  const previousZipBytes = await readFile(await firstFile.path());
  await expect(page.getByTestId('image-result')).toBeVisible();
  const failedAttemptDownloads = [];
  page.on('download', file => failedAttemptDownloads.push(file.suggestedFilename()));
  await page.evaluate(() => { window.__stallNextRasterEncode = true; });
  await page.getByTestId('utility-run').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__stalledRasterCanvas))).toBe(true);
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  await expect(page.getByTestId('utility-cancel')).toHaveCount(0);
  await expect(page.getByTestId('image-result')).toBeVisible();
  expect(failedAttemptDownloads).toEqual([]);
  expect(await page.evaluate(() => ({
    width: window.__stalledRasterCanvas?.width,
    height: window.__stalledRasterCanvas?.height,
  }))).toEqual({ width: 1, height: 1 });

  const fallbackPending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('image-download-again').click();
  const fallbackDownload = await fallbackPending;
  expect((await readFile(await fallbackDownload.path())).equals(previousZipBytes)).toBe(true);

  const pendingDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-run').click();
  const download = await pendingDownload;
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['page-001.jpg', 'page-002.jpg']);
  for (const name of names) {
    const bytes = await zip.files[name].async('uint8array');
    expect(Array.from(bytes.slice(0, 3))).toEqual([255, 216, 255]);
  }
});

test('Chinese PDF-to-JPG context failure frees allocated pixels and lets the next conversion succeed', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.__rejectNextRasterContext = false;
    window.__failedRasterContextCanvas = null;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (window.__rejectNextRasterContext && type === '2d' &&
          options?.alpha === false && this.width > 1 && this.height > 1) {
        window.__rejectNextRasterContext = false;
        window.__failedRasterContextCanvas = this;
        return null;
      }
      return original.call(this, type, options);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/pdf-to-images/');
  await upload(page, 1);
  await page.evaluate(() => { window.__rejectNextRasterContext = true; });
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  await expect(page.getByTestId('image-result')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    intercepted: Boolean(window.__failedRasterContextCanvas),
    width: window.__failedRasterContextCanvas?.width,
    height: window.__failedRasterContextCanvas?.height,
  }))).toEqual({ intercepted: true, width: 1, height: 1 });

  const pendingDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-run').click();
  const jpg = await pendingDownload;
  const bytes = await readFile(await jpg.path());
  expect(Array.from(bytes.subarray(0, 3))).toEqual([255, 216, 255]);
  await expect(page.getByTestId('image-result')).toBeVisible();
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 2);
});
