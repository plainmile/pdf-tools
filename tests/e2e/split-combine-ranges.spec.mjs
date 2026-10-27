import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function samplePdf(widths = [301, 302, 303, 304, 305]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 450]);
  return Buffer.from(await pdf.save());
}

async function capture(page, action) {
  const downloadEvent = page.waitForEvent('download', { timeout: 30000 });
  await action();
  const download = await downloadEvent;
  return { name: download.suggestedFilename(), bytes: Buffer.from(await readFile(await download.path())) };
}

async function outputWidths(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  return pdf.getPages().map(p => p.getWidth());
}

test('split page exports one combined PDF in typed order while preserving separate ZIP and selections', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book.pdf', mimeType: 'application/pdf', buffer: await samplePdf(),
  });
  await expect(page.locator('.file-count')).toContainText('5');

  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByRole('checkbox', { name: 'Select page 4' }).check();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.locator('#ranges-input').fill('5, 2-3, 5, 1');

  await expect(page.getByTestId('split-multiple-ranges-hint')).toContainText('4 separate PDFs');
  await expect(page.getByTestId('split-combined-preview')).toContainText('4 page(s)');
  await expect(page.getByTestId('split-combined-preview')).toContainText('5, 2, 3, 1');
  await expect(page.getByTestId('split-combine-download')).toBeEnabled();

  const combined = await capture(page, () => page.getByTestId('split-combine-download').click());
  expect(combined.name.endsWith('book-combined-4-pages.pdf')).toBe(true);
  expect(await outputWidths(combined.bytes)).toEqual([305, 302, 303, 301]);
  await expect(page.locator('#ranges-input')).toHaveValue('5, 2-3, 5, 1');

  // The original ZIP path intentionally repeats pages across different PDFs.
  const split = await capture(page, () => page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click());
  const zip = await JSZip.loadAsync(split.bytes);
  expect(Object.keys(zip.files).sort()).toEqual([
    'part-01-pages-5-5.pdf', 'part-02-pages-2-3.pdf',
    'part-03-pages-5-5.pdf', 'part-04-pages-1-1.pdf',
  ]);
  const widths = [];
  for (const name of Object.keys(zip.files).sort()) {
    widths.push(await outputWidths(await zip.files[name].async('uint8array')));
  }
  expect(widths).toEqual([[305], [302, 303], [305], [301]]);

  await page.getByRole('tab', { name: 'Organize' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select page 4' })).toBeChecked();
  const original = await capture(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(await outputWidths(original.bytes)).toEqual([301, 302, 303, 304, 305]);
});

test('Chinese mobile: fullwidth and overlapping ranges combine without duplicates; invalid inputs cannot download', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: '章节.pdf', mimeType: 'application/pdf', buffer: await samplePdf(),
  });
  await expect(page.locator('.file-count')).toContainText('5');

  const input = page.locator('#ranges-input');
  const combinedButton = page.getByTestId('split-combine-download');
  const otherDownloads = [];
  page.on('download', item => otherDownloads.push(item.suggestedFilename()));

  await input.fill('５－２');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(combinedButton).toBeDisabled();
  await expect(page.getByRole('button', { name: '下载拆分文件（ZIP）' })).toBeDisabled();
  await input.fill(Array(51).fill('1').join(','));
  await expect(combinedButton).toBeDisabled();
  expect(otherDownloads).toEqual([]);

  await input.fill('５，１－２，５');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('split-combined-preview')).toContainText('5, 1, 2');
  await expect(combinedButton).toBeEnabled();
  const combined = await capture(page, () => combinedButton.click());
  expect(combined.name.endsWith('-combined-3-pages.pdf')).toBe(true);
  expect(await outputWidths(combined.bytes)).toEqual([305, 301, 302]);
  await expect(page.locator('.file-count')).toContainText('5');
  const viewport = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.client + 2);
});

test('combining all pages in current order keeps pristine original PDF bytes', async ({ page }) => {
  const bytes = await samplePdf();
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'original.pdf', mimeType: 'application/pdf', buffer: bytes,
  });
  await expect(page.locator('.file-count')).toContainText('5');
  await page.locator('#ranges-input').fill('1-2, 3-5');
  const download = await capture(page, () => page.getByTestId('split-combine-download').click());
  expect(download.bytes.equals(bytes)).toBe(true);
});

test('combined-range help is server-rendered on the bilingual canonical split pages', async ({ request }) => {
  for (const [path, terms] of [
    ['/split-pdf/', ['Can overlapping ranges be combined without duplicated pages?', 'Download ranges as one PDF']],
    ['/zh/split-pdf/', ['范围重叠时，合并 PDF 会重复页面吗？', '将这些范围合并为一份 PDF']],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    for (const term of terms) expect(html, path).toContain(term);
    expect(html, path).toContain('rel="canonical"');
    expect(html, path).toContain('hreflang="en"');
    expect(html, path).toContain('hreflang="zh-CN"');
    expect(html, path).toContain('https://image.plainmile.com/');
  }
});
