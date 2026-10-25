import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('workspace file import can be cancelled without discarding existing page edits', async ({ page }) => {
  await page.goto('/organize-pdf/');
  const original = await PDFDocument.create();
  original.addPage([300, 400]); original.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await original.save()) });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.evaluate(() => {
    const originalRead = FileReader.prototype.readAsArrayBuffer;
    window.__restoreRead = () => { FileReader.prototype.readAsArrayBuffer = originalRead; };
    FileReader.prototype.readAsArrayBuffer = function () { /* hold until cancelled */ };
  });
  const incoming = await PDFDocument.create(); incoming.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles({ name:'stall.pdf', mimeType:'application/pdf', buffer:Buffer.from(await incoming.save()) });
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.getByTestId('workspace-import-cancel').click();
  await expect(page.getByTestId('workspace-import-progress')).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.evaluate(() => window.__restoreRead());
});
