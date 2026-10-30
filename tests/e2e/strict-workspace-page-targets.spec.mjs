import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function sixPagePdf() {
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= 6; n++) pdf.addPage([300 + n, 420]);
  return Buffer.from(await pdf.save());
}

async function openBook(page, route) {
  await page.goto(route);
  await page.getByTestId('file-input').setInputFiles({
    name: 'numbered-markers.pdf',
    mimeType: 'application/pdf',
    buffer: await sixPagePdf(),
  });
  await expect(page.locator('.file-count')).toContainText('6');
}

async function savedBytes(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  return readFile(await (await pending).path());
}

test('Chinese page jump rejects compatibility numerals, but retains fullwidth digit navigation and page order', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openBook(page, '/zh/workspace/');
  await page.getByTestId('page-jump-panel').locator('summary').click();
  const field = page.getByTestId('page-jump-input');
  for (const invalid of ['②', '³', 'Ⅳ', '０', '７']) {
    await field.fill(invalid);
    await page.getByTestId('page-jump-submit').click();
    await expect(page.locator('.notice-error')).toContainText('1 到 6');
    await expect(page.locator('.notice-success')).toHaveCount(0);
  }
  // Ordinary zero-padded fullwidth decimals remain valid (② must not).
  await field.fill('００６');
  await page.getByTestId('page-jump-submit').click();
  await expect(page.locator('.notice-success')).toContainText('第 6 页');
  await expect(page.locator('[data-testid="page-grid"] [data-export-position="6"]')).toBeInViewport();

  const saved = await PDFDocument.load(await savedBytes(page, () =>
    page.getByRole('button', { name: '导出 PDF' }).click()));
  expect(saved.getPages().map(p => p.getWidth())).toEqual([301, 302, 303, 304, 305, 306]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
});

test('Chinese mobile exact move rejects circled target without changing pages or Undo, then accepts fullwidth target', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openBook(page, '/zh/workspace/');
  await page.getByTestId('page-grid').getByTestId('page-tile').nth(1).locator('input[type="checkbox"]').check();
  await page.getByTestId('move-position-panel').locator('summary').click();
  const field = page.getByTestId('move-target-input');
  const undoWasDisabled = await page.getByRole('button', { name: '撤销' }).isDisabled();
  for (const invalid of ['③', '²', 'Ⅲ']) {
    await field.fill(invalid);
    await page.getByTestId('move-position-submit').click();
    await expect(page.locator('.notice-error')).toContainText('1 到 6');
    await expect(page.locator('.selection-info strong')).toContainText('1 页已选中');
    expect(await page.getByRole('button', { name: '撤销' }).isDisabled()).toBe(undoWasDisabled);
  }
  // An invalid pasted page marker never creates a history entry or reorders the PDF.
  const unchanged = await PDFDocument.load(await savedBytes(page, () =>
    page.getByRole('button', { name: '导出 PDF' }).click()));
  expect(unchanged.getPages().map(p => p.getWidth())).toEqual([301, 302, 303, 304, 305, 306]);
  // Moving to a zero-padded fullwidth page is intentional and unambiguous.
  await field.fill('００６');
  await page.getByTestId('move-position-side').selectOption('after');
  await page.getByTestId('move-position-submit').click();
  const moved = await PDFDocument.load(await savedBytes(page, () =>
    page.getByRole('button', { name: '导出 PDF' }).click()));
  expect(moved.getPages().map(p => p.getWidth())).toEqual([301, 303, 304, 305, 306, 302]);
  await page.getByRole('button', { name: '撤销' }).click();
  const restored = await PDFDocument.load(await savedBytes(page, () =>
    page.getByRole('button', { name: '导出 PDF' }).click()));
  expect(restored.getPages().map(p => p.getWidth())).toEqual([301, 302, 303, 304, 305, 306]);
});

test('visual split page jump uses strict digits without modifying cuts or ZIP PDF contents', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openBook(page, '/zh/split-pdf/');
  await page.locator('#ranges-input').fill('1-3, 4-6');
  await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
  await page.getByTestId('visual-split-panel').locator('summary').click();
  const field = page.getByTestId('split-visual-jump-input');
  for (const invalid of ['④', '²', 'Ⅳ']) {
    await field.fill(invalid);
    await page.getByTestId('split-visual-jump-submit').click();
    await expect(page.locator('.notice-error')).toContainText('1 到 6');
    await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
  }
  await field.fill('００４');
  await page.getByTestId('split-visual-jump-submit').click();
  await expect(page.locator('.notice-success')).toContainText('第 4 页');
  await expect(page.locator('[data-testid="visual-split-page"][data-export-position="4"]')).toBeFocused();
  const zipBytes = await savedBytes(page, () => page.locator('.split-download').click());
  const zip = await JSZip.loadAsync(zipBytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['part-01-pages-1-3.pdf', 'part-02-pages-4-6.pdf']);
  const first = await PDFDocument.load(await zip.file(names[0]).async('uint8array'));
  const second = await PDFDocument.load(await zip.file(names[1]).async('uint8array'));
  expect(first.getPages().map(p => p.getWidth())).toEqual([301, 302, 303]);
  expect(second.getPages().map(p => p.getWidth())).toEqual([304, 305, 306]);
});
