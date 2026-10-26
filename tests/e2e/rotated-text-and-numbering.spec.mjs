import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function upload(page, bytes) {
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'rotated-reading.pdf', mimeType: 'application/pdf', buffer: bytes,
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
}
async function download(page, action) {
  const pending = page.waitForEvent('download', {timeout: 25000});
  await action();
  const item = await pending;
  return Buffer.from(await readFile(await item.path()));
}

test('PDF /Rotate 90 and 180 export visible row order instead of unrotated PDF Y order', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const r90 = doc.addPage([600, 800]);
  r90.setRotation(degrees(90));
  // This text is counter-rotated by its own transform so it is upright
  // after the PDF page /Rotate is applied by a normal PDF viewer.
  for (const [label, x, y] of [
    ['TOP_LEFT_90', 105, 95],
    ['TOP_RIGHT_90', 105, 445],
    ['BOTTOM_LEFT_90', 155, 95],
    ['BOTTOM_RIGHT_90', 155, 445],
  ]) r90.drawText(label, {x,y,font,size:12,rotate:degrees(90)});
  const r180 = doc.addPage([600, 800]);
  r180.setRotation(degrees(180));
  for (const [label, x, y] of [
    ['TOP_LEFT_180', 500, 130],
    ['TOP_RIGHT_180', 240, 130],
    ['BOTTOM_LEFT_180', 500, 190],
    ['BOTTOM_RIGHT_180', 240, 190],
  ]) r180.drawText(label, {x,y,font,size:12,rotate:degrees(180)});
  await page.goto('/pdf-to-txt/');
  await upload(page, Buffer.from(await doc.save()));
  const text = (await download(page, () => page.getByTestId('utility-run').click())).toString('utf8');
  expect(text).toContain('TOP_LEFT_90 TOP_RIGHT_90\nBOTTOM_LEFT_90 BOTTOM_RIGHT_90');
  expect(text).toContain('TOP_LEFT_180 TOP_RIGHT_180\nBOTTOM_LEFT_180 BOTTOM_RIGHT_180');
  // Column-first uses the same displayed viewport rather than PDF user X.
  await page.getByTestId('text-reading-order').selectOption('left-first');
  const columnText = (await download(page, () => page.getByTestId('utility-run').click())).toString('utf8');
  expect(columnText).toContain('TOP_LEFT_90\nBOTTOM_LEFT_90\nTOP_RIGHT_90\nBOTTOM_RIGHT_90');
});

test('numbered PDF pending preview survives changed options, invalid retries and Clear cancellation', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) doc.addPage([595,842])
    .drawText('Source chapter ' + i, { x:70,y:730,font,size:14 });
  await page.goto('/add-page-numbers/');
  await upload(page, Buffer.from(await doc.save()));
  await page.getByTestId('number-first-pdf-page').fill('2');
  await page.getByTestId('number-start').fill('11');
  const unexpectedDownloads = [];
  page.on('download', item => unexpectedDownloads.push(item.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 2 of 4');
  await expect.poll(() => page.getByTestId('utility-pdf-preview').locator('canvas')
    .evaluate(canvas => canvas.width)).toBeGreaterThan(0);
  expect(unexpectedDownloads).toEqual([]);

  // The settings shown above the preview now differ from the completed PDF.
  // Keep the ONLY unsaved result until the user explicitly downloads or clears it.
  await page.getByTestId('number-first-pdf-page').fill('4');
  await page.getByTestId('number-start').fill('41');
  await page.getByRole('combobox', {name:'Position'}).selectOption('top-right');
  await page.getByRole('combobox', {name:'Font size'}).selectOption('16');
  await expect(page.getByTestId('numbered-result-stale')).toContainText('previous page-number settings');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 2 of 4');
  await expect(page.getByTestId('numbered-pdf-download')).toContainText('previous PDF');

  await page.getByRole('button', {name:'Clear',exact:true}).click();
  await expect(page.getByTestId('utility-clear-confirm')).toBeVisible();
  await page.getByTestId('utility-clear-keep').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();

  // 99999 is valid if exactly one page is numbered. Request two pages
  // so that the last printed number exceeds the allowed maximum.
  await page.getByTestId('number-first-pdf-page').fill('3');
  await page.getByTestId('number-start').fill('99999');
  // Reject impossible settings before running PDF-lib; the old PDF is kept.
  await expect(page.getByTestId('numbering-plan-error')).toContainText('exceed 99999');
  await expect(page.getByTestId('number-start')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('utility-run')).toBeDisabled();
  await expect(page.getByTestId('numbered-result-stale')).toBeVisible();
  const originalNumbering = await download(page, () => page.getByTestId('numbered-pdf-download').click());
  expect((await PDFDocument.load(originalNumbering)).getPageCount()).toBe(4);

  // A new successful run uses the newly selected first page (not the old
  // PDF's preview page), and no longer claims the result is stale.
  await page.getByTestId('number-first-pdf-page').fill('4');
  await page.getByTestId('number-start').fill('41');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-result-stale')).toHaveCount(0);
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 4 of 4');
  const updatedNumbering = await download(page, () => page.getByTestId('numbered-pdf-download').click());
  expect((await PDFDocument.load(updatedNumbering)).getPageCount()).toBe(4);

  // Inspect actual selectable output through the site's independent text
  // extractor, instead of trusting UI labels or PDF metadata alone.
  await page.goto('/pdf-to-txt/');
  await upload(page, originalNumbering);
  const first = (await download(page, () => page.getByTestId('utility-run').click())).toString('utf8');
  expect(first).toMatch(/\b11\b/);
  expect(first).toMatch(/\b13\b/);
  expect(first).not.toMatch(/\b41\b/);
  await upload(page, updatedNumbering);
  const second = (await download(page, () => page.getByTestId('utility-run').click())).toString('utf8');
  expect(second).toMatch(/\b41\b/);
  expect(second).not.toMatch(/\b11\b/);
});
