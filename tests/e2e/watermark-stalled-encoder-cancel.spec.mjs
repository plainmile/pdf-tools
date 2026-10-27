import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function documentFixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 28; n++) {
    document.addPage([320, 440]).drawText('Private sample page ' + n, {
      x: 24, y: 348, size: 13, font,
    });
  }
  return Buffer.from(await document.save());
}

test('Chinese mobile: stalled watermark PNG encoder cancels without download, frees canvas and retries', async ({ page }) => {
  test.setTimeout(75000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__stallWatermarkEncoder = false;
    window.__watermarkCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, mime, quality) {
      if (window.__stallWatermarkEncoder && mime === 'image/png' && this.width > 100) {
        window.__stallWatermarkEncoder = false;
        window.__watermarkCanvas = this;
        return; // Native image encoder never calls its callback.
      }
      return original.call(this, callback, mime, quality);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/watermark-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'pages.pdf', mimeType: 'application/pdf', buffer: await documentFixture(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(28);
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('内部文档 INTERNAL');

  const downloads = [];
  page.on('download', result => downloads.push(result.suggestedFilename()));
  await page.evaluate(() => { window.__stallWatermarkEncoder = true; });
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__watermarkCanvas))).toBe(true);
  await expect(page.getByTestId('export-cancel')).toBeVisible();
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-cancel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeEnabled();
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => ({
    width: window.__watermarkCanvas.width, height: window.__watermarkCanvas.height,
  }))).toEqual({ width: 0, height: 0 });
  await expect(page.getByTestId('page-tile')).toHaveCount(28);

  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const downloaded = await pending;
  const output = await PDFDocument.load(await readFile(await downloaded.path()));
  expect(output.getPageCount()).toBe(28);
  const resources = output.context.lookup(output.getPage(0).node.Resources(), PDFDict);
  const xobjects = output.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  expect(xobjects.keys().length).toBeGreaterThan(0); // actual embedded watermark
  expect(downloads).toHaveLength(1);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
