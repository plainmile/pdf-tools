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
  await expect(page.getByTestId('clear-confirmation')).toContainText('永久清除');
  await page.getByTestId('confirm-clear').click();
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
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
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

test('select pages by output ranges then extract real nonconsecutive pages', async ({ page }) => {
  await page.goto('/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'numbers.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305, 306]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('2-3, 5, 5');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toHaveText('3 pages selected');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([302, 303, 305]);
});

test('Chinese touch-width range selection uses export order and rejects reversed ranges atomically', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/delete-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'document.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await page.getByTestId('workspace-view-grouped').click();
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('1-2, 4');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByTestId('selection-ranges').fill('5-1');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.getByRole('alert')).toContainText('选择页码无效');
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByRole('button', { name: '删除页面' }).click();
  const saved = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(saved.getPages().map(p => p.getWidth())).toEqual([303, 305]);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
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
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
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
  await expect(button).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter page ranges');
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
  await page.getByTestId('confirm-clear').click();
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
  await expect(page.getByRole('button', { name: '下载拆分文件（ZIP）' })).toBeDisabled();
  await page.getByRole('textbox', { name: '页码范围' }).fill('1-2, 3');
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
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('1');
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
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
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

test('empty workspace retains undo and a successful reimport does not inherit hidden file quotas', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  const initial = await makePdf([300]);
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: 20 }, (_, n) => ({
      name: `original-${n + 1}.pdf`, mimeType: 'application/pdf', buffer: initial,
    })),
  );
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();
  await expect(page.getByTestId('empty-history-hint')).toContainText('old undo history will be cleared');

  // A failed import cannot delete the user's last undo opportunity.
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await page.getByTestId('undo-all-deleted').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(20);

  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await page.getByTestId('file-input').setInputFiles({
    name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await makePdf([501]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByText('from 1 file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([501]);
});

test('Chinese empty workspace explains undo and reset before starting a new document', async ({ page }) => {
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'test.pdf', mimeType: 'application/pdf', buffer: await makePdf([314]),
  });
  await page.getByRole('button', { name: '全选' }).click();
  await page.getByRole('button', { name: '删除页面' }).click();
  await expect(page.getByTestId('empty-history-hint')).toContainText('清除旧操作的撤销记录');
  await page.getByTestId('undo-all-deleted').click();
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(restored.getPages().map(p => p.getWidth())).toEqual([314]);
});

test('split ZIP supports 50 outputs with progress controls and valid downloaded PDFs', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fifty-parts.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 50 }, (_, index) => 301 + index)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(50);
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-output-budget')).toContainText('128 MB');
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('1');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const download = await waiting;
  const archive = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(archive.files).sort();
  expect(names).toHaveLength(50);
  const first = await PDFDocument.load(await archive.files[names[0]].async('uint8array'));
  const last = await PDFDocument.load(await archive.files[names[49]].async('uint8array'));
  expect(first.getPages()[0].getWidth()).toBe(301);
  expect(last.getPages()[0].getWidth()).toBe(350);
  await expect(page.getByRole('status')).toContainText('Created 50 PDF file(s)');
  await expect(page.getByTestId('split-cancel')).toHaveCount(0);
});

test('cancelling a long split stops ZIP download and restores workspace controls', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'cancel-split.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 320 }, (_, index) => 300 + index % 12)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(320);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('7');
  const downloads = [];
  page.on('download', event => downloads.push(event.suggestedFilename()));
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  await expect(page.getByTestId('split-cancel')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Organize' })).toBeDisabled();
  await page.getByTestId('split-cancel').click();
  await expect(page.getByRole('alert')).toContainText('Split cancelled', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
  expect(downloads).toEqual([]);
});

test('Chinese split clearly announces ZIP limit before running', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'simple.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310]),
  });
  await page.getByRole('tab', { name: '拆分文件' }).click();
  await expect(page.getByTestId('split-output-budget')).toContainText('128 MB');
});

test('Chinese workspace keeps specific file count and type errors rather than a generic failure', async ({ page }) => {
  await page.goto('/zh/workspace/');
  const sample = await makePdf([300]);
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: 21 }, (_, n) => ({
      name: `part-${n}.pdf`, mimeType: 'application/pdf', buffer: sample,
    })),
  );
  await expect(page.getByRole('alert')).toContainText('一次最多处理 20 个文件');
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('请选择 PDF、JPG、PNG、WebP、BMP 或静态 AVIF 文件');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});

for (const dpr of [1, 2]) {
  test.describe(`thumbnail canvas recycling at ${dpr}x DPR`, () => {
    test.use({ deviceScaleFactor: dpr });
    test('releases offscreen bitmaps, redraws on return, preserves rotation and export', async ({ page }) => {
      test.setTimeout(60000);
      await page.goto('/workspace/');
      await page.getByTestId('file-input').setInputFiles({
        name: 'long-report.pdf', mimeType: 'application/pdf',
        buffer: await makePdf(Array.from({ length: 320 }, (_, i) => 300 + i % 13)),
      });
      const tiles = page.getByTestId('page-tile');
      await expect(tiles).toHaveCount(320, { timeout: 30000 });
      const first = tiles.first();
      await first.scrollIntoViewIfNeeded();
      const firstCanvas = first.locator('canvas');
      await expect.poll(async () => firstCanvas.evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      const firstBackingStore = await firstCanvas.elementHandle();
      expect(firstBackingStore).not.toBeNull();
      await tiles.nth(319).scrollIntoViewIfNeeded();
      await expect(firstCanvas).toHaveCount(0, { timeout: 10000 });
      // Keep the detached canvas handle to prove the actual pixel buffer was reset,
      // not merely hidden while hundreds of thumbnails retain their old bitmaps.
      await expect.poll(() => firstBackingStore.evaluate(c => [c.width, c.height])).toEqual([0, 0]);
      await first.scrollIntoViewIfNeeded();
      await expect.poll(async () => first.locator('canvas').evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      await first.getByRole('checkbox', { name: 'Select page 1' }).check();
      await page.getByRole('button', { name: 'Rotate clockwise' }).click();
      await expect.poll(async () => first.locator('canvas').evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
      expect(output.getPageCount()).toBe(1);
      expect(output.getPages()[0].getRotation().angle).toBe(90);
    });
  });
}

test('split requires deliberate input for a 320-page book and starts blank after clearing', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-320.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 320 }, (_, i) => 300 + i % 12)),
  });
  await expect(page.locator('.file-count')).toContainText('320 pages');
  const download = page.getByRole('button', { name: 'Download split PDFs (ZIP)' });
  const ranges = page.getByRole('textbox', { name: 'Page ranges', exact: true });
  await expect(ranges).toHaveValue('');
  await expect(download).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter page ranges');
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  const pagesPerPart = page.getByRole('spinbutton', { name: 'Pages per PDF' });
  await expect(pagesPerPart).toHaveValue('');
  await expect(download).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter how many pages');
  await pagesPerPart.fill('16');
  await expect(page.locator('.split-estimate')).toContainText('20 PDF file(s)');
  await expect(download).toBeEnabled();
  await page.getByRole('radio', { name: 'Split by page ranges' }).check();
  await expect(download).toBeDisabled();
  await ranges.fill('1-30,31-320');
  await expect(page.locator('.split-estimate')).toContainText('2 PDF file(s)');
  await expect(download).toBeEnabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'new-document.pdf', mimeType: 'application/pdf', buffer: await makePdf([350, 351, 352, 353]),
  });
  await expect(ranges).toHaveValue('');
  await expect(download).toBeDisabled();
});

test('Chinese mobile split requires a typed range and exports exactly the chosen pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'mobile.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310, 320, 330]),
  });
  const action = page.getByRole('button', { name: '下载拆分文件（ZIP）' });
  const rangeInput = page.getByRole('textbox', { name: '页码范围' });
  await expect(rangeInput).toHaveValue('');
  await expect(action).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('请填写要拆分的页码范围');
  await rangeInput.fill('1-2,3-4');
  await expect(action).toBeEnabled();
  const wait = page.waitForEvent('download');
  await action.click();
  const archive = await JSZip.loadAsync(await readFile(await (await wait).path()));
  expect(Object.keys(archive.files).sort()).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-4.pdf']);
  const first = await PDFDocument.load(await archive.files['part-01-pages-1-2.pdf'].async('uint8array'));
  const second = await PDFDocument.load(await archive.files['part-02-pages-3-4.pdf'].async('uint8array'));
  expect(first.getPages().map(p => p.getWidth())).toEqual([300, 310]);
  expect(second.getPages().map(p => p.getWidth())).toEqual([320, 330]);
});

function addExifOrientationToJpeg(jpeg, orientation, endian = 'II') {
  const payload = Buffer.alloc(32);
  payload.write('Exif', 0, 'ascii');
  const little = endian === 'II';
  payload.write(endian, 6, 'ascii');
  if (little) {
    payload.writeUInt16LE(42, 8); payload.writeUInt32LE(8, 10);
    payload.writeUInt16LE(1, 14); payload.writeUInt16LE(0x0112, 16);
    payload.writeUInt16LE(3, 18); payload.writeUInt32LE(1, 20);
    payload.writeUInt16LE(orientation, 24);
  } else {
    payload.writeUInt16BE(42, 8); payload.writeUInt32BE(8, 10);
    payload.writeUInt16BE(1, 14); payload.writeUInt16BE(0x0112, 16);
    payload.writeUInt16BE(3, 18); payload.writeUInt32BE(1, 20);
    payload.writeUInt16BE(orientation, 24);
  }
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 34]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function visiblePhotoCorners(page) {
  const canvas = page.getByTestId('page-tile').first().locator('canvas');
  return canvas.evaluate(element => {
    if (!element.width || !element.height) return [];
    const ctx = element.getContext('2d');
    const width = element.width, height = element.height;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const red = data[i], green = data[i + 1], blue = data[i + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 70) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return [];
    const reference = [
      { name: 'R', rgb: [245, 20, 20] },
      { name: 'G', rgb: [20, 235, 35] },
      { name: 'B', rgb: [20, 70, 245] },
      { name: 'Y', rgb: [250, 235, 30] },
    ];
    return [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([u, v]) => {
      const x = Math.round(minX + (maxX - minX) * u);
      const y = Math.round(minY + (maxY - minY) * v);
      const i = (y * width + x) * 4;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      const choices = reference.map(target => ({
        name: target.name,
        distance: target.rgb.reduce((total, component, n) => total + Math.pow(component - rgb[n], 2), 0),
      })).sort((a, b) => a.distance - b.distance);
      return choices[0].name;
    });
  });
}

test('all eight EXIF orientations render actual PDF pages upright, including mirrored camera photos', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/image-to-pdf/');
  const source = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    const quadrants = [
      [0, 0, '#f51414'], [120, 0, '#14eb23'],
      [0, 80, '#1446f5'], [120, 80, '#faeb1e'],
    ];
    for (const [x, y, color] of quadrants) {
      ctx.fillStyle = color; ctx.fillRect(x, y, 120, 80);
    }
    return canvas.toDataURL('image/jpeg', .96).split(',')[1];
  }), 'base64');
  const expected = {
    1: 'RGBY', 2: 'GRYB', 3: 'YBGR', 4: 'BYRG',
    5: 'RBGY', 6: 'BRYG', 7: 'YGBR', 8: 'GYRB',
  };
  const writes = [];
  page.on('request', req => {
    if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.method() + ' ' + req.url());
  });
  for (let orientation = 1; orientation <= 8; orientation++) {
    const jpeg = addExifOrientationToJpeg(source, orientation, orientation % 2 ? 'II' : 'MM');
    // XMP/IPTC/COM can contain private camera/GPS fields; none should be
    // embedded in the PDF's JPEG image XObject after orientation is read.
    const secret = Buffer.from('PM_GPS_PRIVATE_37.7749_-122.4194', 'ascii');
    const jpegWithSecrets = Buffer.concat([jpeg.subarray(0, 2),
      jpegTestSegment(0xe1, secret), jpegTestSegment(0xed, secret),
      jpegTestSegment(0xfe, secret), jpeg.subarray(2)]);
    await page.goto('/image-to-pdf/');
    await page.getByTestId('file-input').setInputFiles({
      name: 'phone-' + orientation + '.jpg',
      mimeType: orientation % 2 ? 'image/jpeg' : 'application/octet-stream',
      buffer: jpegWithSecrets,
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(1);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    // Strip private JPEG headers, but preserve the original entropy-coded
    // image data byte-for-byte, without a lossy canvas re-encode.
    const resources = pdf.context.lookup(pdf.getPage(0).node.Resources(), PDFDict);
    const xObjects = pdf.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
    const image = pdf.context.lookup(xObjects.get(xObjects.keys()[0]));
    const embedded = Buffer.from(image.getContents());
    expect(embedded.equals(source)).toBe(true);
    expect(embedded.includes(Buffer.from('PM_GPS_PRIVATE'))).toBe(false);
    expect(embedded.includes(Buffer.from('Exif'))).toBe(false);

    // Re-open the ACTUAL DOWNLOADED PDF and inspect PDF.js-rendered pixel colors.
    await page.goto('/workspace/');
    await page.getByTestId('file-input').setInputFiles({
      name: 'exported-' + orientation + '.pdf', mimeType: 'application/pdf', buffer: bytes,
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(1);
    await expect.poll(async () => (await visiblePhotoCorners(page)).join(''), { timeout: 15000 })
      .toBe(expected[orientation]);
    // Release the imported preview PDF before moving to the next scenario.
    // Its image source has not itself been re-exported, so navigation would
    // correctly warn that this in-memory document would be discarded.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByTestId('confirm-clear').click();
  }
  expect(writes).toEqual([]);
});

function jpegTestSegment(marker, payload) {
  const size = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, size >>> 8, size & 255]), payload]);
}

test('deleting one entire source frees an active file slot without discarding Undo', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  const base = await makePdf([301]);
  await page.getByTestId('file-input').setInputFiles(Array.from({ length: 20 }, (_, i) => ({
    name: 'doc-' + i + '.pdf', mimeType: 'application/pdf', buffer: base,
  })));
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(19);
  await expect(page.getByText('from 19 files')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles({
    name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await makePdf([511]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([...Array(19).fill(301), 511]);

  // Undo must still be able to restore the previously deleted original pages.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(19);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();
});


async function makeTestPng(page, width, height, color) {
  const base64 = await page.evaluate(({ width, height, color }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height, color });
  return Buffer.from(base64, 'base64');
}

test('image-to-PDF layout: A4 defaults, US Letter landscape and fit-to-image; reflow keeps reordered pages', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/image-to-pdf/');
  await expect(page.getByTestId('image-page-settings')).toBeVisible();
  await expect(page.getByTestId('image-paper')).toHaveValue('a4');
  await expect(page.getByTestId('image-orientation')).toHaveValue('portrait');
  await expect(page.getByTestId('image-margin')).toHaveValue('30');

  const one = await makeTestPng(page, 160, 90, 'red');
  const two = await makeTestPng(page, 90, 160, 'green');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'wide.png', mimeType: 'image/png', buffer: one },
    { name: 'tall.png', mimeType: 'image/png', buffer: two },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);

  const initial = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(initial.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]))
    .toEqual([[595, 842], [595, 842]]);

  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-orientation').selectOption('landscape');
  await page.getByTestId('image-margin').selectOption('12');
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  // Importing again before applying must not silently mix letter/A4 page layouts.
  await page.getByTestId('file-input').setInputFiles({
    name: 'third.png', mimeType: 'image/png', buffer: one,
  });
  await expect(page.getByRole('alert')).toContainText('Apply updated page settings before adding');
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const letter = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(letter.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]))
    .toEqual([[792, 612], [792, 612]]);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('plainmile-2-files-images.pdf');

  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  await page.getByTestId('image-paper').selectOption('fit');
  // Fit should immediately follow the photo shape instead of reusing old landscape/portrait.
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('image-layout-apply').click();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  const sizes = output.getPages().map(p => [p.getWidth(), p.getHeight()]);
  expect(sizes[0][0]).toBeCloseTo(67.5, 2);
  expect(sizes[0][1]).toBeCloseTo(120, 2);
  expect(sizes[1][0]).toBeCloseTo(120, 2);
  expect(sizes[1][1]).toBeCloseTo(67.5, 2);
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(undone.getPages()[0].getWidth()).toBeCloseTo(120, 2);
});

test('image layout before import, mixed PDF inputs and Chinese text labels are consistent', async ({ page }) => {
  await page.goto('/zh/image-to-pdf/');
  await expect(page.getByTestId('image-page-settings')).toContainText('图片页面设置');
  await page.getByTestId('image-paper').selectOption('fit');
  // Fit should immediately follow the photo shape instead of reusing old landscape/portrait.
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample-phone.png', mimeType: 'image/png',
    buffer: await makeTestPng(page, 240, 135, 'blue'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('sample-phone-images.pdf');
  const image = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(image.getPage(0).getWidth()).toBeCloseTo(180, 2);
  expect(image.getPage(0).getHeight()).toBeCloseTo(101.25, 2);

  await page.getByTestId('image-paper').selectOption('a4');
  await expect(page.getByTestId('image-layout-dirty')).toContainText('尚未应用');
  await page.getByTestId('image-layout-apply').click();
  const revised = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(revised.getPage(0).getWidth()).toBeCloseTo(841.89, 1);
});


test('fit-to-image cannot produce an arbitrarily portrait page from landscape photos', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await expect(page.getByTestId('image-orientation')).toBeDisabled();
  await expect(page.getByTestId('image-fit-orientation-hint')).toContainText('follows each photo shape');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('file-input').setInputFiles({
    name: 'landscape.png', mimeType: 'image/png',
    buffer: await makeTestPng(page, 400, 200, 'blue'),
  });
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPage(0).getWidth()).toBeCloseTo(300, 1);
  expect(output.getPage(0).getHeight()).toBeCloseTo(150, 1);
  await page.getByTestId('image-paper').selectOption('a4');
  await expect(page.getByTestId('image-orientation')).toBeEnabled();
  await page.getByTestId('image-orientation').selectOption('portrait');
  await page.getByTestId('image-layout-apply').click();
  const a4 = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(a4.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  expect(a4.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
});

test('Chinese fit-to-image explains automatic orientation and disabled controls', async ({ page }) => {
  await page.goto('/zh/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-orientation')).toBeDisabled();
  await expect(page.getByTestId('image-fit-orientation-hint')).toContainText('自动匹配每张照片方向');
  await page.getByTestId('image-paper').selectOption('letter');
  await expect(page.getByTestId('image-orientation')).toBeEnabled();
});


test('oversized WebP header is rejected before canvas decode, while ordinary WebP still converts', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  // RIFF WEBP VP8X announces 10000x9000 pixels (90 MP) in just 30 bytes.
  const massive = Buffer.alloc(30);
  massive.write('RIFF', 0, 'ascii');
  massive.writeUInt32LE(22, 4);
  massive.write('WEBPVP8X', 8, 'ascii');
  massive.writeUInt32LE(10, 16);
  const widthMinusOne = 9999;
  const heightMinusOne = 8999;
  massive[24] = widthMinusOne & 255;
  massive[25] = (widthMinusOne >>> 8) & 255;
  massive[26] = (widthMinusOne >>> 16) & 255;
  massive[27] = heightMinusOne & 255;
  massive[28] = (heightMinusOne >>> 8) & 255;
  massive[29] = (heightMinusOne >>> 16) & 255;
  await page.getByTestId('file-input').setInputFiles({
    name: 'oversized.webp', mimeType: 'image/webp', buffer: massive,
  });
  await expect(page.getByRole('alert')).toContainText('Image dimensions are too large.');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);

  // Test a REAL WebP produced by Chromium, not only fake headers.
  const webpBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = 'purple';
    context.fillRect(0, 0, 64, 32);
    return canvas.toDataURL('image/webp', .87).split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'legitimate.webp', mimeType: 'image/webp',
    buffer: Buffer.from(webpBase64, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
});

test('irreversible workspace reset has a cancellable confirmation and preserves edits until confirmed', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toContainText('undo history');
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('cancel-clear').click();
  await expect(page.getByTestId('clear-confirmation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('clear-confirmation')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toHaveCount(0);
});

test('mobile Chinese clear confirmation preserves document when cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'private-synthetic.pdf', mimeType: 'application/pdf', buffer: await makePdf([301]),
  });
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toContainText('永久清除');
  await page.getByTestId('cancel-clear').click();
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(pdf.getPage(0).getWidth()).toBe(301);
});

test('duplicate nonadjacent selected pages and preserve exact exported order and Undo/Redo', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  await page.getByTestId('duplicate-pages').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300, 300, 310, 320, 320]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(redone.getPages().map(p => p.getWidth())).toEqual([300, 300, 310, 320, 320]);
});

test('insert blank after a rotated page matching its visible dimensions, without copying content', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(4);
  await expect(page.locator('.file-count')).toContainText('2 files');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300, 310, 420, 320]);
  expect(output.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 0, 0]);
  expect(output.getPage(2).getHeight()).toBe(310);
  expect(output.getPage(2).getRotation().angle).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(4);
});

test('no selection appends blank page; Chinese mobile disables ambiguous multi-selection insert', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 320]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([300, 320, 320]);
  await page.getByRole('checkbox', { name: '选择第 1 页' }).check();
  await page.getByRole('checkbox', { name: '选择第 2 页' }).check();
  await expect(page.getByTestId('insert-blank-page')).toBeDisabled();
  await expect(page.getByTestId('duplicate-pages')).toBeEnabled();
  await expect(page.getByTestId('blank-position-hint')).toContainText('最多选中一页');
});

test('duplicating at the 600-page workspace boundary fails safely and preserves document', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'synthetic-600-pages.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 600 }, () => 300)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(600, { timeout: 20000 });
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByTestId('duplicate-pages').click();
  await expect(page.getByRole('alert')).toContainText('600 pages');
  await expect(page.getByTestId('page-tile')).toHaveCount(600);
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByRole('alert')).toContainText('600 pages');
  await expect(page.getByTestId('page-tile')).toHaveCount(600);
});


test('photo paper reflow skips deleted Undo-only images until they are restored', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'old-deleted.png', mimeType: 'image/png', buffer: await makeTestPng(page, 120, 80, 'red') },
    { name: 'still-visible.png', mimeType: 'image/png', buffer: await makeTestPng(page, 80, 120, 'green') },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.getByTestId('image-paper').selectOption('letter');
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const onePage = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(onePage.getPageCount()).toBe(1);
  expect(onePage.getPage(0).getWidth()).toBeCloseTo(612, 1);

  // Undo revives an image that was deliberately not re-encoded while hidden.
  // Warn before exporting or mixing A4 and Letter pages; no silent change.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(restored.getPageCount()).toBe(2);
  expect(restored.getPages().map(p => Math.round(p.getWidth()))).toEqual([612, 612]);
});


test('expired 20-step Undo history frees deleted PDF bytes without affecting active export', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'expired.pdf', mimeType: 'application/pdf', buffer: await makePdf([300]) },
    { name: 'kept.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const retainedBytes = async () => Number(await page.locator('.file-count').getAttribute('data-retained-bytes'));
  const originalBytes = await retainedBytes();
  expect(originalBytes).toBeGreaterThan(0);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  // Removing a page is reversible, so the deleted source is initially retained.
  expect(await retainedBytes()).toBe(originalBytes);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  for (let step = 0; step < 21; step++) {
    await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  }
  // The old source is no longer reachable from any of the last 20 edits.
  await expect.poll(retainedBytes).toBeLessThan(originalBytes);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(1);
  expect(exported.getPage(0).getWidth()).toBeCloseTo(320, 1);
});


test('one split range downloads a real PDF directly, not a ZIP', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('2-3');
  await expect(page.locator('.split-estimate')).toContainText('1 PDF file(s)');
  const action = page.getByRole('button', { name: 'Download PDF' });
  await expect(action).toBeEnabled();
  const pending = page.waitForEvent('download');
  await action.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('plainmile-2-files-pages-2-3.pdf');
  const output = await PDFDocument.load(await readFile(await download.path()));
  expect(output.getPages().map((p) => p.getWidth())).toEqual([310, 320]);
  await expect(page.getByRole('status')).toContainText('No ZIP extraction needed');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
});

test('Chinese single-result split by pages per PDF is a direct full PDF export', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'three.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303]) });
  // /split-pdf/ starts on the Split tab; thumbnails only exist on Organize.
  await expect(page.locator('.file-count')).toContainText('3 页');
  await page.getByRole('tab', { name: '拆分文件' }).click();
  await page.getByRole('radio', { name: '每 N 页拆分一次' }).check();
  await page.getByRole('spinbutton', { name: '每个 PDF 的页数' }).fill('3');
  const action = page.getByRole('button', { name: '下载 PDF' });
  await expect(action).toBeEnabled();
  const result = await downloadPdf(page, () => action.click());
  expect(result.getPages().map(p => p.getWidth())).toEqual([301, 302, 303]);
  await expect(page.getByRole('status')).toContainText('无需解压 ZIP');
});
