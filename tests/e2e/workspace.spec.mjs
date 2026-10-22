import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
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

test('rejects invalid reversed split range without a download', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByLabel('Page ranges').fill('3-1');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  await expect(page.getByRole('alert')).toContainText('reversed');
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
