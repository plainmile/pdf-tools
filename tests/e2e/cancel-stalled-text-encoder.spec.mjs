import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function downloadResult(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('utility-pdf-download').click();
  const download = await downloadPromise;
  return Buffer.from(await readFile(await download.path()));
}

test('cancel stalled Chinese TXT-to-PDF JPEG encoding, keep prior output, retry with real raster PDF', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__stallNextTextJpeg = false;
    window.__stalledTextCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (window.__stallNextTextJpeg && type === 'image/jpeg' &&
          this.width >= 1000 && this.height >= 1000) {
        window.__stallNextTextJpeg = false;
        window.__stalledTextCanvas = this;
        return; // Simulate a browser encoder that never calls back.
      }
      return original.call(this, callback, type, quality);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Previous searchable PDF text');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 30000 });
  const previous = await downloadResult(page);
  const before = await PDFDocument.load(previous);
  expect(before.getPageCount()).toBe(1);

  await page.getByTestId('utility-text').fill('中文内容：取消图片编码后，必须保留之前生成的 PDF。');
  await expect(page.getByTestId('text-result-stale')).toBeVisible();
  const downloads = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.evaluate(() => { window.__stallNextTextJpeg = true; });
  await page.getByTestId('utility-run').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__stalledTextCanvas))).toBe(true);
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByTestId('utility-cancel')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect(page.getByTestId('text-result-stale')).toBeVisible();
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => ({
    width: window.__stalledTextCanvas?.width,
    height: window.__stalledTextCanvas?.height,
  }))).toEqual({ width: 1, height: 1 });

  // No partial replacement or corrupt result can be offered after cancellation.
  const kept = await downloadResult(page);
  expect(kept.equals(previous)).toBe(true);

  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-result-stale')).toHaveCount(0, { timeout: 30000 });
  const final = await downloadResult(page);
  expect(final.equals(previous)).toBe(false);
  const pdf = await PDFDocument.load(final);
  expect(pdf.getPageCount()).toBe(1);
  const resources = pdf.context.lookup(pdf.getPage(0).node.Resources(), PDFDict);
  const objects = pdf.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  expect(objects.keys().length).toBeGreaterThan(0);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 2);
});
