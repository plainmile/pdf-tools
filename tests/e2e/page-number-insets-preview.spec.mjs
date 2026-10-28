import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function upload(page, bytes) {
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'number-insets.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
}
async function download(page) {
  const pending = page.waitForEvent('download', { timeout: 25000 });
  await page.getByTestId('numbered-pdf-download').click();
  const item = await pending;
  return Buffer.from(await readFile(await item.path()));
}
async function fixture(count = 8, size = [595, 842]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) doc.addPage(size)
    .drawText('Chapter original ' + i, { x: 15, y: size[1] - 35, font, size: 8 });
  return Buffer.from(await doc.save());
}

test('numbering preview navigates cover, middle and last pages without regenerating or silently downloading', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await upload(page, await fixture());
  await page.getByTestId('number-first-pdf-page').fill('3');
  await page.getByTestId('number-start').fill('21');
  const downloads = [];
  const listener = item => downloads.push(item.suggestedFilename());
  page.on('download', listener);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 3 of 8');
  await expect(page.getByTestId('number-preview-page').locator('option')).toHaveCount(3);
  await page.getByTestId('number-preview-page').selectOption('custom');
  await expect(page.getByTestId('number-preview-custom')).toHaveValue('3');
  await page.getByTestId('number-preview-custom').fill('2');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 2 of 8');
  await page.getByTestId('number-preview-custom').fill('6');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 6 of 8');
  await page.getByTestId('number-preview-custom').fill('9');
  await expect(page.getByTestId('number-preview-invalid')).toContainText('between 1 and 8');
  await expect(page.getByTestId('utility-pdf-preview')).toHaveCount(0);
  await page.getByTestId('number-preview-custom').fill('3.5');
  await expect(page.getByTestId('number-preview-invalid')).toBeVisible();
  await page.getByTestId('number-preview-custom').fill('1');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 1 of 8');
  await page.getByTestId('number-preview-page').selectOption('last');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('page 8 of 8');
  expect(downloads).toHaveLength(0);
  const generated = await download(page);
  expect((await PDFDocument.load(generated)).getPageCount()).toBe(8);
  page.off('download', listener);
});

test('page number margins visibly move printed numbers on rotated and cropped pages', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const p = doc.addPage([500, 700]);
    p.setRotation(degrees(angle));
    p.setCropBox(20, 30, 400, 550);
  }
  await page.goto('/add-page-numbers/');
  await upload(page, await doc.save());
  await page.getByRole('combobox', { name: 'Position' }).selectOption('top-left');
  await expect(page.getByRole('combobox', { name: 'Position' }).locator('option')).toHaveCount(6);
  await expect(page.getByTestId('number-margin')).toHaveValue('24');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
  const preview = page.getByTestId('utility-pdf-preview');
  const canvas = preview.locator('canvas');
  await expect.poll(() => canvas.evaluate(c => c.width)).toBeGreaterThan(0);
  const originalPreview = await canvas.screenshot();
  const first = await download(page);
  await page.getByTestId('number-margin').selectOption('40');
  await expect(page.getByTestId('numbered-result-stale')).toBeVisible();
  await expect(page.getByTestId('numbered-pdf-download')).toContainText('previous PDF');
  await expect(canvas).toBeVisible();
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-result-stale')).toHaveCount(0);
  await expect.poll(async () => {
    if (await canvas.evaluate(c => c.width) < 1) return false;
    return !originalPreview.equals(await canvas.screenshot());
  }, { timeout: 15000 }).toBe(true);
  const wide = await download(page);
  expect(first.equals(wide)).toBe(false);
  for (const bytes of [first, wide]) {
    const result = await PDFDocument.load(bytes);
    expect(result.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 180, 270]);
    expect(result.getPages().map(p => p.getCropBox().width)).toEqual([400,400,400,400]);
  }
});

test('wide numbering margin fails safely on tiny PDFs and retains the prior generated result', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/add-page-numbers/');
  // A 90pt crop fits a narrow 12pt inset but cannot fit 40pt either side.
  await upload(page, await fixture(1, [90, 100]));
  await page.getByRole('combobox', { name: '页码位置' }).selectOption('bottom-right');
  await page.getByTestId('number-margin').selectOption('12');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
  await page.getByTestId('number-margin').selectOption('40');
  await expect(page.getByTestId('numbered-result-stale')).toBeVisible();
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('页面尺寸太小');
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
  await expect(page.getByTestId('numbered-pdf-download')).toContainText('之前');
  const retained = await download(page);
  expect((await PDFDocument.load(retained)).getPageCount()).toBe(1);
  await page.getByTestId('number-margin').selectOption('12');
  await expect(page.getByTestId('numbered-result-stale')).toHaveCount(0);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 2);
});


test('both locales reject exponent page inputs, recover and export a valid PDF without changing an earlier preview', async ({ page }) => {
  test.setTimeout(90000);
  for (const route of ['/add-page-numbers/', '/zh/add-page-numbers/']) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(route);
    await upload(page, await fixture(3));
    const start = page.getByTestId('number-start');
    const first = page.getByTestId('number-first-pdf-page');
    const run = page.getByTestId('utility-run');
    await start.fill('2e0');
    await expect(start).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('numbering-plan-error')).toBeVisible();
    await expect(run).toBeDisabled();
    await start.fill('2.0');
    await expect(run).toBeDisabled();
    await start.fill('2');
    await first.fill('1e0');
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    await expect(run).toBeDisabled();
    await first.fill('1');
    await expect(page.getByTestId('numbering-plan-error')).toHaveCount(0);
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
    await page.getByTestId('number-preview-page').selectOption('custom');
    const previewInput = page.getByTestId('number-preview-custom');
    await previewInput.fill('2e0');
    await expect(page.getByTestId('number-preview-invalid')).toBeVisible();
    await expect(page.getByTestId('utility-pdf-preview')).toHaveCount(0);
    await previewInput.fill('2');
    await expect(page.getByTestId('number-preview-invalid')).toHaveCount(0);
    await expect(page.getByTestId('utility-pdf-preview')).toBeVisible();
    const source = await download(page);
    expect((await PDFDocument.load(source)).getPageCount()).toBe(3);
    const size = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(size.content, route).toBeLessThanOrEqual(size.viewport + 2);
  }
});
