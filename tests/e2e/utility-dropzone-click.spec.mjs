import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function localPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 590]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Local file picker works', { x: 45, y: 510, font, size: 16 });
  return Buffer.from(await doc.save());
}

test('clicking the empty converter drop area chooses a PDF, then exports real text', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  const area = page.getByTestId('utility-dropzone');
  await expect(area).toHaveJSProperty('tagName', 'LABEL');
  await expect(area).toContainText('Click anywhere in this area');
  // This hint is NOT the native file button. The whole visible drop area now
  // opens the same accessible file picker without an extra UI control.
  const fileDialog = page.waitForEvent('filechooser');
  await area.locator('.utility-drop-hint').click();
  const chooser = await fileDialog;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({ name: 'local.pdf', mimeType: 'application/pdf', buffer: await localPdf() });
  await expect(page.getByTestId('utility-file-summary')).toContainText('local.pdf');

  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('utility-run').click();
  const downloaded = await downloadEvent;
  const extracted = (await readFile(await downloaded.path())).toString('utf8');
  expect(extracted).toContain('Local file picker works');
});

test('Chinese mobile: tap drop-area hint to import TXT and export a valid PDF', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/txt-to-pdf/');
  const area = page.getByTestId('utility-dropzone');
  await expect(area).toHaveJSProperty('tagName', 'LABEL');
  await expect(area).toContainText('点击框内任意位置可选择文件');
  const fileDialog = page.waitForEvent('filechooser');
  await area.locator('.utility-drop-hint').click();
  await (await fileDialog).setFiles({
    name: 'notes.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Simple private text conversion.', 'utf8'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('notes.txt');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('utility-pdf-download').click();
  const pdf = await PDFDocument.load(await readFile(await (await downloadEvent).path()));
  expect(pdf.getPageCount()).toBe(1);
  const viewport = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(viewport.content).toBeLessThanOrEqual(viewport.client + 2);
});
