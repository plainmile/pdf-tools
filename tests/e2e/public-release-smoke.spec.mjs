import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixture(widths, textPrefix = 'Public release verification') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  widths.forEach((width, i) => {
    const page = doc.addPage([width, 480]);
    page.drawText(textPrefix + ' ' + (i + 1), { x: 20, y: 400, font, size: 12 });
  });
  return Buffer.from(await doc.save());
}

async function downloaded(page, action) {
  const promise = page.waitForEvent('download', { timeout: 30000 });
  await action();
  const download = await promise;
  return { filename: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('public merge: two private PDFs become one correctly ordered PDF without upload', async ({ page }) => {
  const posted = [];
  page.on('request', r => {
    if (!['GET', 'HEAD'].includes(r.method())) posted.push(r.method() + ' ' + r.url());
  });
  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await fixture([301, 302]) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await fixture([403]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(3, { timeout: 20000 });
  const result = await downloaded(page, () => page.getByRole('button', { name: 'Export PDF', exact: true }).click());
  const doc = await PDFDocument.load(result.bytes);
  expect(doc.getPages().map(p => p.getWidth())).toEqual([301, 302, 403]);
  expect(posted).toEqual([]);
});

test('public Chinese split: page ranges export two valid PDFs in a real ZIP', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book.pdf', mimeType: 'application/pdf', buffer: await fixture([310, 320, 330, 340]),
  });
  // The focused Split tool opens its Split tab; organizer tiles are hidden.
  // Validate the real input page count before verifying downloaded ZIP bytes.
  await expect(page.locator('.file-count')).toContainText('4 页', { timeout: 20000 });
  await page.locator('#ranges-input').fill('1-2, 3-4');
  await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
  const out = await downloaded(page, () => page.locator('.split-download').click());
  expect(out.filename).toMatch(/\.zip$/i);
  const zip = await JSZip.loadAsync(out.bytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-4.pdf']);
  const widths = [];
  for (const name of names) {
    const doc = await PDFDocument.load(await zip.files[name].async('uint8array'));
    widths.push(doc.getPages().map(p => p.getWidth()));
  }
  expect(widths).toEqual([[310, 320], [330, 340]]);
});

test('public image converter: PNG ZIP contains real images in requested order', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'screens.pdf', mimeType: 'application/pdf', buffer: await fixture([311, 322, 333]),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('screens.pdf');
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('3,1');
  const out = await downloaded(page, () => page.getByTestId('utility-run').click());
  expect(out.filename).toMatch(/\.zip$/i);
  const zip = await JSZip.loadAsync(out.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['order-001-page-003.png', 'order-002-page-001.png']);
  for (const name of Object.keys(zip.files)) {
    const bytes = await zip.files[name].async('uint8array');
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test('public mobile Chinese PDF-to-TXT exports real UTF-8 data without POST', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const posted = [];
  page.on('request', r => {
    if (!['GET', 'HEAD'].includes(r.method())) posted.push(r.method());
  });
  await page.goto('/zh/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'private.pdf', mimeType: 'application/pdf', buffer: await fixture([321], 'LOCAL ONLY DOCUMENT'),
  });
  const out = await downloaded(page, () => page.getByTestId('utility-run').click());
  expect(out.filename).toMatch(/\.txt$/i);
  expect(out.bytes.toString('utf8')).toContain('LOCAL ONLY DOCUMENT 1');
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 2);
  expect(posted).toEqual([]);
});

// Simulate genuine user drag-and-drop into the browser-local converter without
// uploading a customer document or clicking the native file input.
async function dropSyntheticFile(page, selector, file) {
  const base64 = Buffer.from(file.bytes).toString('base64');
  await page.locator(selector).evaluate((node, data) => {
    const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], data.filename, { type: data.mimeType }));
    node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { base64, filename: file.name, mimeType: file.mimeType });
}

test('public drag-and-drop PDF imports locally and exports real extracted text', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await dropSyntheticFile(page, '[data-testid="utility-dropzone"]', {
    name: 'dragged.pdf', mimeType: 'application/pdf',
    bytes: await fixture([333], 'LOCAL DRAG PDF'),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('dragged.pdf');
  const out = await downloaded(page, () => page.getByTestId('utility-run').click());
  expect(out.bytes.toString('utf8')).toContain('LOCAL DRAG PDF');
});

test('public drag-and-drop text creates a valid PDF without an extra import step', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await dropSyntheticFile(page, '[data-testid="utility-dropzone"]', {
    name: 'dragged.txt', mimeType: 'text/plain',
    bytes: Buffer.from('Drag and drop a local note to PDF.', 'utf8'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('dragged.txt');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });
  const out = await downloaded(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
});

test('public long PDF final batch on a narrow Chinese mobile viewport exports last real JPGs', async ({ page }) => {
  test.setTimeout(85000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'book-125.pdf', mimeType: 'application/pdf',
    buffer: await fixture(Array.from({ length: 125 }, () => 320)),
  });
  const input = page.getByTestId('utility-page-ranges');
  await expect(input).toHaveValue('1-60', { timeout: 20000 });
  await page.getByTestId('utility-batch-next').click();
  await expect(input).toHaveValue('61-120');
  await page.getByTestId('utility-batch-next').click();
  await expect(input).toHaveValue('121-125');
  const out = await downloaded(page, () => page.getByTestId('utility-run').click());
  expect(out.filename).toMatch(/pages-121-125\.zip$/i);
  const zip = await JSZip.loadAsync(out.bytes);
  expect(Object.keys(zip.files).sort()).toEqual([
    'page-121.jpg', 'page-122.jpg', 'page-123.jpg', 'page-124.jpg', 'page-125.jpg',
  ]);
  const bytes = await zip.files['page-125.jpg'].async('uint8array');
  expect(Array.from(bytes.slice(0, 3))).toEqual([255, 216, 255]);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 2);
});
