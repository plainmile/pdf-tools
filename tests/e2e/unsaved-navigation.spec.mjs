import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function syntheticPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([320, 420]);
  return Buffer.from(await doc.save());
}

test('complete two-part split ZIP releases unsaved warning; a later edit enables it again', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const width of [310, 320, 330, 340]) doc.addPage([width, 420]);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'all-in-zip.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await page.locator('#ranges-input').fill('3-4,1-2');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const archive = await JSZip.loadAsync(await readFile(await (await download).path()));
  const entries = Object.keys(archive.files).sort();
  expect(entries).toEqual(['part-01-pages-3-4.pdf', 'part-02-pages-1-2.pdf']);
  const first = await PDFDocument.load(await archive.files[entries[0]].async('uint8array'));
  const second = await PDFDocument.load(await archive.files[entries[1]].async('uint8array'));
  expect(first.getPages().map(page => page.getWidth())).toEqual([330, 340]);
  expect(second.getPages().map(page => page.getWidth())).toEqual([310, 320]);

  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect.poll(nativeGuard).toBe(false);

  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await expect.poll(nativeGuard).toBe(true);
});

test('partial two-part split ZIP never claims the omitted pages were saved', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const width of [310, 320, 330, 340]) doc.addPage([width, 420]);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'partial-zip.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await page.locator('#ranges-input').fill('1-2,4');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const archive = await JSZip.loadAsync(await readFile(await (await download).path()));
  const parts = Object.values(archive.files);
  const widths = [];
  for (const part of parts) {
    const pdf = await PDFDocument.load(await part.async('uint8array'));
    widths.push(...pdf.getPages().map(page => page.getWidth()));
  }
  expect(widths).toEqual([310, 320, 340]);
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
});

test('unchanged source PDF can be previewed and left freely; selected pages still require confirmation', async ({ page }) => {
  await page.goto('/workspace/');
  await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\\/zh\\/workspace\\/$/);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\\/workspace\\/$/);

  await page.getByTestId('file-input').setInputFiles({
    name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  // A simple preview of the original does not create any edited file.
  // Switching languages should not force a misleading unsaved-work warning.
  await expect(page.getByTestId('workspace-original-preserved')).toBeVisible();
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\\/zh\\/workspace\\/$/);
  await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);

  await page.getByTestId('file-input').setInputFiles({
    name: 'selected.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '选择第 1 页' }).check();
  await page.locator('.language-link').click();
  const dialog = page.getByTestId('unsaved-navigation-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('仅保存在当前浏览器标签页');
  await expect(page).toHaveURL(/\\/zh\\/workspace\\/$/);

  await page.getByTestId('unsaved-keep').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.locator('.language-link').click();
  await page.getByTestId('unsaved-leave').click();
  await expect(page).toHaveURL(/\\/workspace\\/$/);
});

test('successful full export allows normal navigation; a new page edit warns again', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'real-export.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await download;
  await page.locator('.primary-nav a[href="/merge-pdf/"]').click();
  await expect(page).toHaveURL(/\/merge-pdf\/$/);
  await page.getByTestId('file-input').setInputFiles({
    name: 'new-work.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
});

test('partial extract keeps the unsaved warning, but extracting every page releases it', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const width of [320, 340, 360]) doc.addPage([width, 420]);
  await page.goto('/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'all-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);

  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  const subsetEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Extract selected pages' }).click();
  const subset = await subsetEvent;
  const subsetDoc = await PDFDocument.load(await readFile(await subset.path()));
  expect(subsetDoc.getPages().map(p => p.getWidth())).toEqual([320]);
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();

  await page.getByRole('button', { name: 'Select all' }).click();
  const allEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Extract selected pages' }).click();
  const all = await allEvent;
  const allDoc = await PDFDocument.load(await readFile(await all.path()));
  expect(allDoc.getPages().map(p => p.getWidth())).toEqual([320, 340, 360]);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/zh\/extract-pages\/$/);
});

test('native Back/Reload/Close warning is registered only for unsaved work', async ({ page }) => {
  await page.goto('/workspace/');
  const cancelled = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await cancelled()).toBe(false);
  await page.getByTestId('file-input').setInputFiles({
    name: 'unsaved.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  // Reading and validating a PDF is asynchronous. The live-site network can
  // make it slower than the local Docker runner, so never assert on a React
  // guard before the source pages have finished importing.
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect.poll(cancelled, { message: 'unchanged single PDF must not trigger a false leave warning' }).toBe(false);
  // Page selection is valuable browser-only work, even when PDF bytes stay untouched.
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await expect.poll(cancelled, { message: 'unexported page selection must stay protected' }).toBe(true);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect.poll(cancelled, { message: 'clear should remove native leave protection' }).toBe(false);
});

test('text-to-PDF draft in mobile Chinese requires explicit navigation choice', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('尚未保存的合成文字');
  await page.locator('.language-link').click();
  const dialog = page.getByTestId('unsaved-navigation-dialog');
  await expect(dialog).toContainText('尚未下载');
  await page.getByTestId('unsaved-keep').click();
  await expect(page).toHaveURL(/\/zh\/txt-to-pdf\/$/);
  await expect(page.getByTestId('utility-text')).toHaveValue('尚未保存的合成文字');

  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-pdf-download')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('utility-pdf-download').click();
  await download;
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/txt-to-pdf\/$/);
});

test('emptying text cannot silently discard an undownloaded earlier PDF; downloading it then frees the guard', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Recoverable first draft PDF');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-pdf-download')).toBeVisible();
  // Clearing the ENTIRE input must not silently erase the only generated PDF.
  await page.getByTestId('utility-text').fill('');
  await expect(page.getByTestId('utility-pdf-download')).toBeVisible();
  await expect(page.getByTestId('text-result-stale')).toContainText('previous text');
  await expect(page.getByTestId('utility-run')).toBeDisabled();

  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect.poll(nativeGuard).toBe(true);
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();

  const event = page.waitForEvent('download');
  await page.getByTestId('utility-pdf-download').click();
  const dl = await event;
  const saved = await PDFDocument.load(await (await import('node:fs/promises')).readFile(await dl.path()));
  expect(saved.getPageCount()).toBe(1);
  // Both the edited text and previous PDF are already gone/saved, so no
  // further false positive "unsaved" warning is necessary.
  await expect.poll(nativeGuard).toBe(false);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/zh\/txt-to-pdf\/$/);
});

test('importing an unchanged PDF into a converter never reports unsaved work', async ({ page }) => {
  const buffer = await syntheticPdf();
  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  for (const route of ['/pdf-to-txt/', '/pdf-to-images/', '/add-page-numbers/', '/compress-pdf/']) {
    await page.goto(route);
    await page.getByTestId('utility-file-input').setInputFiles({
      name: 'unchanged.pdf', mimeType: 'application/pdf', buffer,
    });
    await expect(page.getByTestId('utility-file-summary')).toContainText('unchanged.pdf');
    await expect.poll(nativeGuard).toBe(false);
    if (route === '/pdf-to-images/') {
      await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
      await expect.poll(nativeGuard).toBe(false);
    }
    await page.locator('.primary-nav a[href="/merge-pdf/"]').click();
    await expect(page).toHaveURL(/\/merge-pdf\/$/);
    await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);
  }
});

test('an incomplete PDF text extraction still blocks navigation until downloaded', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([320, 420]).drawText('Selectable text on page one');
  doc.addPage([320, 420]); // Page two cannot be extracted without OCR.
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'mixed.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('mixed.pdf');
  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect.poll(nativeGuard).toBe(false);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('partial-text-download')).toBeVisible();
  await expect.poll(nativeGuard).toBe(true);
  await page.locator('.primary-nav a[href="/merge-pdf/"]').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('partial-text-download').click();
  await download;
  await expect.poll(nativeGuard).toBe(false);
});

test('deleting all pages protects the recoverable Undo history on internal and native navigation', async ({ page }) => {
  await page.goto('/workspace/');
  const doc = await PDFDocument.create();
  doc.addPage([331, 490]);
  doc.addPage([442, 590]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'all-deleted.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();

  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect.poll(nativeGuard).toBe(true);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/workspace\/$/);
  const dialog = page.getByTestId('unsaved-navigation-dialog');
  await expect(dialog).toContainText('Undo to restore them');
  await page.getByTestId('unsaved-keep').click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('undo-all-deleted').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const outputEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const outputFile = await outputEvent;
  const restored = await PDFDocument.load(await (await import('node:fs/promises')).readFile(await outputFile.path()));
  expect(restored.getPages().map(p => p.getWidth())).toEqual([331, 442]);

  await expect.poll(nativeGuard).toBe(false);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/zh\/workspace\/$/);
});

test('Chinese saved PDF becomes unsaved after deleting the final page; deliberate Clear releases the guard', async ({ page }) => {
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'one-page.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  await download;
  await page.getByRole('button', { name: '全选' }).click();
  await page.getByRole('button', { name: '删除页面' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();

  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toContainText('仍可通过“撤销”恢复');
  await page.getByTestId('unsaved-keep').click();
  await page.getByRole('button', { name: '清空工作台，重新开始' }).click();
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByTestId('undo-all-deleted')).toHaveCount(0);
  const isGuarded = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(isGuarded).toBe(false);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/workspace\/$/);
});
