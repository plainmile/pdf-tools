import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function syntheticPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([320, 420]);
  return Buffer.from(await doc.save());
}

test('empty PDF workspace navigates freely, but an imported unsaved PDF asks before switching language', async ({ page }) => {
  await page.goto('/workspace/');
  await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/zh\/workspace\/$/);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(/\/workspace\/$/);

  await page.getByTestId('file-input').setInputFiles({
    name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.locator('.language-link').click();
  const dialog = page.getByTestId('unsaved-navigation-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('only in this browser tab');
  await expect(page).toHaveURL(/\/workspace\/$/);

  await page.getByTestId('unsaved-keep').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.locator('.language-link').click();
  await page.getByTestId('unsaved-leave').click();
  await expect(page).toHaveURL(/\/zh\/workspace\/$/);
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
  await expect.poll(cancelled, { message: 'loaded PDF should register native leave protection' }).toBe(true);
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

test('plain PDF utility after import protects its source; explicit Clear releases navigation', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'minimal.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf(),
  });
  // PDF.js loads and counts pages asynchronously; navigation protection
  // should be tested only once the active file is actually loaded.
  await expect(page.getByTestId('utility-file-summary')).toContainText('minimal.pdf');
  await page.locator('.primary-nav a[href="/merge-pdf/"]').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toHaveCount(0);
  await page.locator('.primary-nav a[href="/merge-pdf/"]').click();
  await expect(page).toHaveURL(/\/merge-pdf\/$/);
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
