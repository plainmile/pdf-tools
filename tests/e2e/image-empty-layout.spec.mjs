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

test('cover image layout clips inside margins and image sorting is reversible', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-orientation').selectOption('portrait');
  await page.getByTestId('image-margin').selectOption('48');
  await page.getByTestId('image-sizing').selectOption('cover');
  await expect(page.getByTestId('image-sizing-hint')).toContainText('cropped');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'image10.png', mimeType: 'image/png', buffer: await picture(page, 500, 90) },
    { name: 'image2.png', mimeType: 'image/png', buffer: await picture(page, 80, 180) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-batch-actions')).toBeVisible();
  await page.getByRole('button', { name: 'Sort images by filename' }).click();
  await expect(page.getByTestId('page-tile').first().locator('.tile-info')).toContainText('image2.png');
  await page.getByRole('button', { name: 'Reverse image order' }).click();
  await expect(page.getByTestId('page-tile').first().locator('.tile-info')).toContainText('image10.png');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile').first().locator('.tile-info')).toContainText('image2.png');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const download = await event;
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  expect(pdf.getPageCount()).toBe(2);
  for (const p of pdf.getPages()) {
    expect(p.getWidth()).toBe(612);
    expect(p.getHeight()).toBe(792);
    const contents = pdf.context.lookup(p.node.Contents());
    expect(contents).toBeTruthy();
  }
});

test('fit-to-image uses full image and disables cropping choice', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-sizing')).toBeDisabled();
  await expect(page.getByTestId('image-sizing-hint')).toContainText('full original');
});
