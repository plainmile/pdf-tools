import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function bloatedSearchablePdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 12; i++) {
    const sheet = doc.addPage([595, 842]);
    sheet.drawText('Searchable chapter ' + (i + 1), {
      font, size: 16, x: 70, y: 730,
    });
  }
  const field = doc.getForm().createTextField('reference');
  field.setText('Invoice X123');
  field.addToPage(doc.getPage(0), { x: 70, y: 590, width: 180, height: 30 });
  // Force ordinary independent PDF objects, to provide a deterministic
  // realistic case where modern PDF object streams can save bytes.
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function upload(page, bytes) {
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'source-report.pdf', mimeType: 'application/pdf', buffer: bytes,
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
}

async function download(page, selector) {
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId(selector).click();
  const item = await pending;
  return Buffer.from(await readFile(await item.path()));
}

test('default PDF optimization keeps actual text and editable form fields, does not rasterize', async ({ page }) => {
  const source = await bloatedSearchablePdf();
  await page.goto('/compress-pdf/');
  await expect(page.getByTestId('compression-strategy')).toHaveValue('structure');
  await expect(page.getByTestId('compression-level')).toHaveCount(0);
  await expect(page.getByTestId('utility-limit-hint')).toHaveText('PDF up to 100 MB / 120 pages.');
  await expect(page.locator('.utility-note')).toContainText('digital signatures');
  await upload(page, source);
  const unexpectedDownloads = [];
  page.on('download', d => unexpectedDownloads.push(d.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-result')).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId('compression-result-method')).toContainText('Keep selectable text');
  await expect(page.getByTestId('compression-change-label')).toHaveText('Saved');
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  expect(unexpectedDownloads).toEqual([]);
  const bytes = await download(page, 'compression-download');
  expect(bytes.length).toBeLessThan(source.length);
  const optimized = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(optimized.getPageCount()).toBe(12);
  expect(optimized.getForm().getTextField('reference').getText()).toBe('Invoice X123');
  expect(optimized.getProducer()).toBeUndefined();
  expect(optimized.getCreator()).toBeUndefined();

  // The text is not merely rendered with a font in PDF-lib: run the output
  // through our real PDF.js TXT extractor and assert selectable page text.
  await page.goto('/pdf-to-txt/');
  await upload(page, bytes);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('form-text-result')).toBeVisible({ timeout: 20000 });
  const text = (await download(page, 'form-text-download')).toString('utf8');
  expect(text).toContain('Searchable chapter 1');
  expect(text).toContain('Searchable chapter 12');
});

test('switching compression methods keeps the earlier output until user regenerates', async ({ page }) => {
  const source = await bloatedSearchablePdf();
  await page.goto('/compress-pdf/');
  await upload(page, source);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled({ timeout: 25000 });
  const first = await download(page, 'compression-download');
  await page.getByTestId('compression-strategy').selectOption('raster');
  await expect(page.getByTestId('utility-limit-hint')).toContainText('JPEG output safety budget 96 MB');
  await expect(page.getByTestId('compression-result-stale')).toBeVisible();
  await expect(page.getByTestId('compression-result-method')).toContainText('Keep selectable text');
  await expect(page.getByTestId('compression-level')).toBeVisible();
  expect((await download(page, 'compression-download')).equals(first)).toBe(true);
  await page.getByTestId('compression-strategy').selectOption('structure');
  await expect(page.getByTestId('compression-result-stale')).toHaveCount(0);
  await expect(page.getByTestId('compression-level')).toHaveCount(0);
});

test('Chinese phone UI labels both choices, warns about signatures and stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/compress-pdf/');
  const strategy = page.getByTestId('compression-strategy');
  await expect(strategy).toHaveValue('structure');
  await expect(page.getByTestId('utility-limit-hint')).toHaveText('PDF 最多 100 MB / 120 页。');
  await expect(strategy.locator('option')).toHaveCount(2);
  await expect(page.locator('.utility-note')).toContainText('数字签名');
  await strategy.selectOption('raster');
  await expect(page.getByTestId('utility-limit-hint')).toContainText('JPEG 数据累计上限 96 MB');
  await expect(page.locator('.utility-note')).toContainText('图片');
  await expect(page.getByTestId('compression-level')).toBeVisible();
  await strategy.selectOption('structure');
  await upload(page, await bloatedSearchablePdf());
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled({ timeout: 25000 });
  await expect(page.getByTestId('compression-result-method')).toContainText('保留可搜索文字');
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(size.content).toBeLessThanOrEqual(size.viewport + 2);
});
