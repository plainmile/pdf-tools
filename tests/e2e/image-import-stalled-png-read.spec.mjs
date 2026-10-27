import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

function bmp(width = 4, height = 3) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 54 + y * stride + x * 3;
    bytes[offset] = x * 60; bytes[offset + 1] = y * 70; bytes[offset + 2] = 10;
  }
  return bytes;
}

test('Chinese mobile: cancel BMP-to-PDF on a stalled PNG Blob read and retry with valid image pixels', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer;
    window.__stallNextConvertedPng = false;
    window.__stalledPngBlob = null;
    Blob.prototype.arrayBuffer = function () {
      if (window.__stallNextConvertedPng && this.type === 'image/png') {
        window.__stallNextConvertedPng = false;
        window.__stalledPngBlob = this;
        return new Promise(() => {}); // Encoder finished but Blob read never resolves.
      }
      return original.apply(this, arguments);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/image-to-pdf/');

  const source = await PDFDocument.create();
  source.addPage([299, 421]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'kept-original.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from(await source.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.evaluate(() => { window.__stallNextConvertedPng = true; });
  await page.getByTestId('file-input').setInputFiles({
    name: 'stalled.bmp', mimeType: 'image/bmp', buffer: bmp(),
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__stalledPngBlob))).toBe(true);
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.getByTestId('workspace-import-cancel').click();
  await expect(page.getByTestId('workspace-import-progress')).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  // The failed import must not poison later inputs or alter existing pages.
  await page.getByTestId('file-input').setInputFiles({
    name: 'retry.bmp', mimeType: 'image/bmp', buffer: bmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const saved = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const output = await PDFDocument.load(await readFile(await (await saved).path()));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPage(0).getSize()).toEqual({ width: 299, height: 421 });

  const resources = output.context.lookup(output.getPage(1).node.Resources(), PDFDict);
  const images = output.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  expect(images.keys().length).toBeGreaterThan(0);
  const dimensions = images.keys().map(key => output.context.lookup(images.get(key)))
    .filter(stream => stream?.dict)
    .map(stream => [stream.dict.get(PDFName.of('Width')).asNumber(),
      stream.dict.get(PDFName.of('Height')).asNumber()]);
  expect(dimensions).toContainEqual([4, 3]);
  const viewport = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 2);
});
