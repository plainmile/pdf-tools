import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('one-page PDF watermark encoding can be cancelled and safely retried on mobile', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__stallOneWatermark = false;
    window.__watermarkCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, format, quality) {
      if (window.__stallOneWatermark && format === 'image/png' && this.width > 100) {
        window.__stallOneWatermark = false;
        window.__watermarkCanvas = this;
        return; // Native encoder never calls back for this tiny document.
      }
      return original.call(this, callback, format, quality);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/watermark-pdf/');
  const pdf = await PDFDocument.create();
  pdf.addPage([340, 480]).drawText('ONE PAGE PRIVATE', { x: 25, y: 360, size: 14 });
  await page.getByTestId('file-input').setInputFiles({
    name: 'single-page.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('REVIEW ONLY');
  const attemptDownloads = [];
  page.on('download', download => attemptDownloads.push(download.suggestedFilename()));

  await page.evaluate(() => { window.__stallOneWatermark = true; });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__watermarkCanvas))).toBe(true);
  // Prior code displayed Cancel only for 24+ pages, leaving one-page exports
  // permanently locked on stalled watermark encoding. Progress now exists.
  await expect(page.getByTestId('export-progress')).toContainText('1');
  await expect(page.getByTestId('export-cancel')).toBeEnabled();
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-cancel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  expect(attemptDownloads).toEqual([]);
  expect(await page.evaluate(() => [window.__watermarkCanvas.width, window.__watermarkCanvas.height]))
    .toEqual([0, 0]);

  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const output = await PDFDocument.load(await readFile(await (await pending).path()));
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getSize()).toEqual({ width: 340, height: 480 });
  const resources = output.context.lookup(output.getPage(0).node.Resources(), PDFDict);
  const images = output.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  expect(images.keys().length).toBeGreaterThan(0);
  expect(attemptDownloads).toHaveLength(1);
  const layout = await page.evaluate(() => [
    document.documentElement.scrollWidth, document.documentElement.clientWidth,
  ]);
  expect(layout[0]).toBeLessThanOrEqual(layout[1] + 2);
});
