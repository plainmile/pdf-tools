import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function previewFixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 9; index++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('Unique chapter number ' + index, { x: 75, y: 690, size: 26, font });
  }
  return Buffer.from(await pdf.save());
}

test('page previews reuse one PDF.js worker while navigating and release it for new result bytes', async ({ page }) => {
  // PDF.js workers are expensive on 100 MB books. Capture actual worker
  // constructors before the application imports PDF.js, rather than relying
  // on the preview label to claim reuse.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__pdfWorkerCreations = 0;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args, target);
        window.__pdfWorkerCreations++;
        return worker;
      },
    });
  });
  await page.goto('/add-page-numbers/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'nine-page-book.pdf',
    mimeType: 'application/pdf',
    buffer: await previewFixture(),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.getByTestId('utility-run').click();
  const preview = page.getByTestId('utility-pdf-preview');
  await expect(preview).toHaveAttribute('data-rendered-page', '1');
  const firstScreenshot = await preview.locator('canvas').screenshot();
  const workerBaseline = await page.evaluate(() => window.__pdfWorkerCreations);
  expect(workerBaseline).toBeGreaterThan(0);

  for (const [option, expected] of [
    ['last', '9'], ['first', '1'], ['last', '9'], ['first', '1'],
  ]) {
    await page.getByTestId('number-preview-page').selectOption(option);
    await expect(preview).toHaveAttribute('data-rendered-page', expected);
  }
  await page.getByTestId('number-preview-page').selectOption('custom');
  await page.getByTestId('number-preview-custom').fill('8');
  await page.getByTestId('number-preview-custom').fill('5');
  await expect(preview).toHaveAttribute('data-rendered-page', '5');
  const middleScreenshot = await preview.locator('canvas').screenshot();
  expect(firstScreenshot.equals(middleScreenshot)).toBe(false);
  // Even a temporarily invalid custom page must not destroy the existing
  // PDF.js document. Hide the preview but preserve its Worker until input
  // becomes valid again.
  await page.getByTestId('number-preview-custom').fill('0');
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId('number-preview-invalid')).toBeVisible();
  await page.getByTestId('number-preview-custom').fill('7');
  await expect(preview).toHaveAttribute('data-rendered-page', '7');
  expect(await page.evaluate(() => window.__pdfWorkerCreations)).toBe(workerBaseline);

  // The preview always uses the real output bytes. A new generation must
  // close the previous document and open a new one, even with identical pages.
  await page.getByTestId('number-margin').selectOption('40');
  await expect(page.getByTestId('numbered-result-stale')).toBeVisible();
  await page.getByTestId('utility-run').click();
  await expect(preview).toHaveAttribute('data-rendered-page', '1');
  await expect(page.getByTestId('numbered-result-stale')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pdfWorkerCreations)).toBe(workerBaseline + 1);

  const pending = page.waitForEvent('download');
  await page.getByTestId('numbered-pdf-download').click();
  const result = await pending;
  const bytes = await readFile(await result.path());
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(9);
});

test('rapid toggles while rendering never show the wrong PDF page or a preview failure', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'fast-preview.pdf', mimeType: 'application/pdf', buffer: await previewFixture(),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.getByTestId('utility-run').click();
  const preview = page.getByTestId('utility-pdf-preview');
  await expect(preview).toHaveAttribute('data-rendered-page', '1');
  await page.getByTestId('number-preview-page').selectOption('last');
  await page.getByTestId('number-preview-page').selectOption('first');
  await page.getByTestId('number-preview-page').selectOption('custom');
  await page.getByTestId('number-preview-custom').fill('4');
  await page.getByTestId('number-preview-custom').fill('7');
  await page.getByTestId('number-preview-custom').fill('3');
  await expect(preview).toHaveAttribute('data-rendered-page', '3');
  await expect(page.getByTestId('utility-pdf-preview').getByText('Preview unavailable')).toHaveCount(0);
  await page.getByTestId('number-preview-custom').fill('0');
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId('number-preview-invalid')).toBeVisible();
  await page.getByTestId('number-preview-custom').fill('9');
  await expect(preview).toHaveAttribute('data-rendered-page', '9');
});
