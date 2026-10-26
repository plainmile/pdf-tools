import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function syntheticPdf(widths) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 420]);
  return Buffer.from(await pdf.save());
}

async function download(page, action) {
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await action();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

test('open-ended split ranges produce exact PDF parts and reject missing starts', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'open-ended.pdf', mimeType: 'application/pdf',
    buffer: await syntheticPdf([301, 302, 303, 304, 305, 306]),
  });
  // Split opens on its own tab, so page tiles from the Organize panel
  // are intentionally not mounted. Assert the real loaded-page summary.
  await expect(page.locator('.file-count')).toContainText('6 pages');
  const ranges = page.locator('#ranges-input');
  await expect(page.getByText('The trailing dash means through the last page', { exact: false })).toBeVisible();

  await ranges.fill('-3');
  await expect(page.locator('.split-download')).toBeDisabled();
  await ranges.fill('1-2, 3-');
  await expect(page.getByTestId('split-coverage-complete')).toContainText('6 total');
  await expect(page.getByTestId('split-coverage-omitted')).toHaveCount(0);
  await page.getByTestId('split-output-preview').locator('summary').click();
  await expect(page.getByTestId('split-output-preview')).toContainText('pages 3–6 (4 pages)');
  const result = await download(page, () => page.locator('.split-download').click());
  expect(result.name).toBe('open-ended-split.zip');
  const zip = await JSZip.loadAsync(result.bytes);
  const filenames = Object.keys(zip.files).sort();
  expect(filenames).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-6.pdf']);
  const part1 = await PDFDocument.load(await zip.file(filenames[0]).async('uint8array'));
  const part2 = await PDFDocument.load(await zip.file(filenames[1]).async('uint8array'));
  expect(part1.getPages().map(p => p.getWidth())).toEqual([301, 302]);
  expect(part2.getPages().map(p => p.getWidth())).toEqual([303, 304, 305, 306]);
});

test('Chinese mobile extraction interprets fullwidth N- using current output positions', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'extract.pdf', mimeType: 'application/pdf',
    buffer: await syntheticPdf([310, 320, 330, 340, 350, 360]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  const range = page.getByTestId('selection-ranges');
  await expect(page.getByText('从第 8 页直到末页', { exact: false })).toBeVisible();
  await range.fill('４－，１－２');
  await expect(page.getByTestId('range-combine-preview')).toContainText('4, 5, 6, 1, 2');
  const result = await download(page, () => page.getByTestId('range-combine-download').click());
  expect(result.name).toBe('extract-combined-5-pages.pdf');
  const combined = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(combined.getPages().map(p => p.getWidth())).toEqual([340, 350, 360, 310, 320]);

  // The selection button is a distinct action: it selects the same output
  // positions but checkbox extraction keeps the current workspace order.
  await page.getByTestId('selection-range-apply').click();
  const selected = await download(page, () => page.getByRole('button', { name: '提取页面', exact: true }).click());
  const selection = await PDFDocument.load(selected.bytes, { updateMetadata: false });
  expect(selection.getPages().map(p => p.getWidth())).toEqual([310, 320, 340, 350, 360]);

  await range.fill('７－');
  await expect(page.getByTestId('range-combine-download')).toBeDisabled();
  const bounds = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth + 2);
});

test('open-ended PDF image selection names the resolved ZIP and still enforces 60-page limit', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'book.pdf', mimeType: 'application/pdf',
    buffer: await syntheticPdf([301, 302, 303, 304, 305, 306, 307, 308]),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  const range = page.getByTestId('utility-page-ranges');
  await range.fill('5-');
  await expect(range).toHaveAttribute('aria-invalid', 'false');
  const result = await download(page, () => page.getByTestId('utility-run').click());
  expect(result.name).toBe('book-pages-5-8.zip');
  const zip = await JSZip.loadAsync(result.bytes);
  expect(Object.keys(zip.files).sort()).toEqual([
    'page-005.jpg', 'page-006.jpg', 'page-007.jpg', 'page-008.jpg',
  ]);
  for (const file of Object.values(zip.files)) {
    const bytes = await file.async('uint8array');
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  }

  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'long-book.pdf', mimeType: 'application/pdf',
    buffer: await syntheticPdf(Array.from({ length: 65 }, (_, i) => 301 + i)),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('65 pages');
  await range.fill('1-');
  await expect(page.getByTestId('image-range-error')).toContainText('at most 60 pages');
  await expect(page.getByTestId('utility-run')).toBeDisabled();
  await range.fill('61-');
  await expect(page.getByTestId('image-range-error')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
});
