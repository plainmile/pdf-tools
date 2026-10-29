import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('failed full-page preview offers bilingual mobile retry without changing exported PDF bytes', async ({ page }) => {
  // Inject one realistic canvas allocation failure only in the large preview.
  // Thumbnails, the PDF.js document and export pipeline stay fully functional.
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (this.dataset.testid === 'page-zoom-canvas' && !window.__failedZoomOnce) {
        window.__failedZoomOnce = true;
        return null;
      }
      return originalGetContext.apply(this, args);
    };
  });

  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([298, 420]);
  document.addPage([320, 420]);
  const sourceBytes = Buffer.from(await document.save());

  for (const [route, retryText] of [
    ['/organize-pdf/', 'Retry preview'],
    ['/zh/organize-pdf/', '重试预览'],
  ]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(route);
    await page.getByTestId('file-input').setInputFiles({
      name: 'retry-preview.pdf', mimeType: 'application/pdf', buffer: sourceBytes,
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(2);
    await page.getByTestId('page-preview-open').first().click();

    const retry = page.getByTestId('page-zoom-retry');
    await expect(retry).toHaveText(retryText);
    await expect(page.getByTestId('page-zoom-canvas')).toHaveJSProperty('width', 0);
    const before = await page.evaluate(() => ({
      actual: document.documentElement.scrollWidth,
      visible: document.documentElement.clientWidth,
    }));
    expect(before.actual).toBeLessThanOrEqual(before.visible + 2);

    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(page.getByTestId('page-zoom-close')).toBeFocused();
    await expect(page.getByTestId('page-zoom-canvas'))
      .toHaveCSS('visibility', 'visible', { timeout: 30000 });
    // Retry did not reload the source or rewrite page order. Navigation still
    // works and the exported PDF has the original two distinct page widths.
    await page.getByTestId('page-zoom-next').click();
    await expect(page.getByTestId('page-zoom-previous')).toBeEnabled();
    await page.getByTestId('page-zoom-close').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('.workspace-primary-buttons button').last().click(),
    ]);
    const exported = await PDFDocument.load(await readFile(await download.path()));
    expect(exported.getPageCount()).toBe(2);
    expect(exported.getPage(0).getWidth()).toBe(298);
    expect(exported.getPage(1).getWidth()).toBe(320);
  }
});
