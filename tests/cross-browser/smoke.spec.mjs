import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function pdfFixture(widths = [300, 320]) {
  const document = await PDFDocument.create();
  for (const width of widths) {
    const page = document.addPage([width, 450]);
    page.drawText('Local source ' + width, { x: 28, y: 400 });
  }
  return Buffer.from(await document.save());
}

async function downloadBytes(page, action) {
  const pending = page.waitForEvent('download', { timeout: 30_000 });
  await action();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('merging PDFs preserves page order and exports real PDF bytes', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdfFixture([301, 302]) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdfFixture([303]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  const exported = await downloadBytes(page, () =>
    page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.name).toMatch(/\.pdf$/);
  const result = await PDFDocument.load(exported.bytes);
  expect(result.getPages().map(p => Math.round(p.getWidth()))).toEqual([301, 302, 303]);
});

test('PDF-to-PNG renders requested page without using a server upload', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'browser-source.pdf', mimeType: 'application/pdf', buffer: await pdfFixture([120, 144]),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('browser-source.pdf');
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('2');
  const exported = await downloadBytes(page, () => page.getByTestId('utility-run').click());
  expect(exported.name).toMatch(/page-002\.png$/);
  expect(exported.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(exported.bytes.readUInt32BE(16)).toBeGreaterThan(0);
});

test('Chinese 375px image-to-PDF preserves a local PNG and usable mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/image-to-pdf/');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const context = canvas.getContext('2d');
    context.fillStyle = '#35768b';
    context.fillRect(0, 0, 40, 30);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
  const exported = await downloadBytes(page, () =>
    page.getByRole('button', { name: '导出 PDF' }).click());
  const doc = await PDFDocument.load(exported.bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
});

test('browser-local Unicode text creates a downloadable PDF, not a blank output', async ({ page }) => {
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('中文测试：春天来了。\n第二行，保存完整内容。');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.notice-success')).toContainText('图片', { timeout: 30_000 });
  const exported = await downloadBytes(page, () => page.getByTestId('utility-pdf-download').click());
  const doc = await PDFDocument.load(exported.bytes);
  expect(doc.getPageCount()).toBe(1);
  // Unicode text in the built-in-font fallback must create a raster image
  // rather than an empty page or a silent missing-glyph PDF.
  const resources = doc.context.lookup(doc.getPage(0).node.Resources(), PDFDict);
  const xObjectRef = resources.get(PDFName.of('XObject'));
  expect(xObjectRef).toBeTruthy();
  const xObjects = doc.context.lookup(xObjectRef, PDFDict);
  expect(xObjects.keys().length).toBeGreaterThan(0);
});

test('converter opens unchanged source freely, while unsaved workspace edits ask to stay', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'original.pdf', mimeType: 'application/pdf', buffer: await pdfFixture([355]),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('original.pdf');
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/zh\/pdf-to-txt\/$/);
  await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);

  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'work.pdf', mimeType: 'application/pdf', buffer: await pdfFixture([355]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();
  await expect(page).toHaveURL(/\/merge-pdf\/$/);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
});
