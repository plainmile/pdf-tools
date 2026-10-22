import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function makePdf(pageWidths) {
  const doc = await PDFDocument.create();
  for (const width of pageWidths) {
    doc.addPage([width, 420]);
  }
  return Buffer.from(await doc.save());
}

const inputDocuments = async () => ([
  { name: 'first.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310]) },
  { name: 'second.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]) },
]);

async function loadInput(page) {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles(await inputDocuments());
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByText('Added 2 files and 3 pages.')).toBeVisible();
}

async function downloadPdf(page, action) {
  const downloadEvent = page.waitForEvent('download');
  await action();
  const download = await downloadEvent;
  const bytes = await readFile(await download.path());
  return PDFDocument.load(bytes);
}

function watermarkImageCounts(pdf) {
  return pdf.getPages().map((pdfPage) => {
    const resourcesRef = pdfPage.node.Resources();
    if (!resourcesRef) return 0;
    const resources = pdf.context.lookup(resourcesRef, PDFDict);
    const xObjectRef = resources.get(PDFName.of('XObject'));
    return xObjectRef ? pdf.context.lookup(xObjectRef, PDFDict).keys().length : 0;
  });
}

test('exports without any watermark by default and only marks pages after opt-in', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  const plain = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(plain)).toEqual([0, 0, 0]);

  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('CONFIDENTIAL');
  await expect(page.getByText('CONFIDENTIAL').first()).toBeVisible();
  const marked = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(marked)).toEqual([1, 1, 1]);

  await page.getByTestId('watermark-toggle').uncheck();
  const plainAgain = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(plainAgain)).toEqual([0, 0, 0]);
});

test('watermark requires custom text, never inserts a default brand watermark', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await page.getByTestId('watermark-toggle').check();
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter watermark text');
  await page.getByTestId('watermark-text').fill('  ');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter watermark text');
});

test('Chinese watermark page supports custom Chinese text and resets to no watermark', async ({ page }) => {
  await page.goto('/zh/watermark-pdf/');
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('watermark-toggle')).toBeVisible();
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('\u5185\u90e8\u8d44\u6599');
  const marked = await downloadPdf(page, () => page.getByRole('button', { name: '\u5bfc\u51fa PDF' }).click());
  expect(watermarkImageCounts(marked)).toEqual([1, 1]);
  await page.getByRole('button', { name: '\u6e05\u7a7a', exact: true }).click();
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  const plain = await downloadPdf(page, () => page.getByRole('button', { name: '\u5bfc\u51fa PDF' }).click());
  expect(watermarkImageCounts(plain)).toEqual([0, 0]);
});

test('optional watermark is applied to selected extraction and every split PDF', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('REVIEW COPY');
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(watermarkImageCounts(extracted)).toEqual([1]);

  await page.getByRole('tab', { name: 'Split' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const downloaded = await pending;
  const zip = await JSZip.loadAsync(await readFile(await downloaded.path()));
  const parts = Object.values(zip.files);
  expect(parts).toHaveLength(2);
  for (const part of parts) {
    const pdf = await PDFDocument.load(await part.async('uint8array'));
    expect(watermarkImageCounts(pdf).every((n) => n === 1)).toBe(true);
  }
});

test('cross-file drag-and-drop changes the actual exported page order', async ({ page }) => {
  await loadInput(page);
  const cards = page.getByTestId('page-tile');
  await cards.nth(2).dragTo(cards.nth(0));
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([320, 300, 310]);
});

test('keyboard-accessible move buttons change the actual exported page order', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([310, 300, 320]);
});

test('rotate, delete, undo and extract selected pages', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  const rotated = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(extracted.getPages().map((p) => p.getWidth())).toEqual([310]);
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const afterDelete = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(afterDelete.getPages().map((p) => p.getWidth())).toEqual([300, 320]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
});

test('split PDFs into ZIP ranges in the current workspace order', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const download = await downloadEvent;
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-3.pdf']);
  const partOne = await PDFDocument.load(await zip.files[names[0]].async('uint8array'));
  const partTwo = await PDFDocument.load(await zip.files[names[1]].async('uint8array'));
  expect(partOne.getPages().map((p) => p.getWidth())).toEqual([300, 310]);
  expect(partTwo.getPages().map((p) => p.getWidth())).toEqual([320]);
});

test('invalid split ranges disable download until corrected', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  const button = page.getByRole('button', { name: 'Download split PDFs (ZIP)' });
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('3-1');
  await expect(button).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('maximum 50 output PDFs');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  await expect(button).toBeEnabled();
});

test('rejects password-protected or malformed PDFs safely', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await expect(page.getByTestId('dropzone')).toBeVisible();
});

test('PNG images become an A4 PDF page without server upload', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const base64Image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = 'teal';
    context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(base64Image, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
});

test('undo and redo reverse a drag reorder', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(undone.getPages().map((p) => p.getWidth())).toEqual([300, 310, 320]);
  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(redone.getPages().map((p) => p.getWidth())).toEqual([310, 300, 320]);
});


test('deleting every page allows the workspace to be completely reset', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await page.getByRole('button', { name: 'Clear workspace and start over' }).click();
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([300, 310]);
});

test('Chinese pages switch languages while preserving tri-state theme choice', async ({ page }) => {
  await page.goto('/zh/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: '整理 PDF 页面，就这么简单。' })).toBeVisible();
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', 'https://pdf.plainmile.com/');
  const theme = page.getByRole('combobox', { name: '外观' });
  await expect(theme).toHaveValue('system');
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/zh/workspace/');
  await expect(page.getByRole('combobox', { name: '外观' })).toHaveValue('dark');
  await page.getByRole('link', { name: '语言: English' }).click();
  await expect(page).toHaveURL(/\/workspace\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark');
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});

test('batch-drag selected pages together across documents in the exported PDF', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  const cards = page.getByTestId('page-tile');
  await cards.nth(0).dragTo(cards.nth(1));
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([300, 320, 310]);
});

test('Chinese split tool exports current pages without uploading the document', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles(await inputDocuments());
  await expect(page.getByText('预计生成 2 个 PDF 文件。')).toBeVisible();
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载拆分文件（ZIP）' }).click();
  const download = await wait;
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  expect(Object.keys(zip.files).sort()).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-3.pdf']);
});

test('workbench imports 320-page book with lazy previews and extracts one page', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-320-pages.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({length:320},()=>420)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(320, { timeout: 30000 });
  await expect(page.getByTestId('workspace-large-warning')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  const one = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(one.getPageCount()).toBe(1);
});

test('workbench reports the actual 100 MB file limit, not a stale 25 MB limit', async ({ page }) => {
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0),
  });
  await expect(page.getByRole('alert')).toContainText('100 MB');
  await expect(page.getByRole('alert')).not.toContainText('25 MB');
});

test('split output count over 50 is explained before download', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fifty-one.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 51 }, () => 300)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(51);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  const button = page.getByRole('button', { name: 'Download split PDFs (ZIP)' });
  await expect(button).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('maximum 50 output PDFs');
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('2');
  await expect(button).toBeEnabled();
});

test('image import uses filename when MIME is generic and blocks oversized PNG before decoding', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 48;
    canvas.getContext('2d').fillRect(0, 0, 96, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'photo.png', mimeType: 'application/octet-stream', buffer: Buffer.from(base64, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const header = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(header, 0);
  Buffer.from('IHDR').copy(header, 12);
  header.writeUInt32BE(18000, 16);
  header.writeUInt32BE(18000, 20);
  await page.getByTestId('file-input').setInputFiles({
    name: 'huge.png', mimeType: 'image/png', buffer: header,
  });
  await expect(page.getByRole('alert')).toContainText('Image dimensions are too large');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});
