import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function picture(page, width, height) {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  return Buffer.from(base64, 'base64');
}

test('empty image workspace can switch paper and reimport without stale undo blocking', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'old.png', mimeType: 'image/png', buffer: await picture(page, 120, 70),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();

  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-orientation').selectOption('landscape');
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);

  // Bad replacement may not discard the older work that can still be undone.
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles({
    name: 'new.png', mimeType: 'image/png', buffer: await picture(page, 160, 90),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByTestId('workspace-export-filename')).toContainText('new-images.pdf');

  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const download = await event;
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth()).toBe(792);
  expect(pdf.getPage(0).getHeight()).toBe(612);
});
