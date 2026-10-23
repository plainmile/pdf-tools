import { test, expect } from '@playwright/test';
import { PDFDocument, PDFArray, PDFName } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
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

function pageOperators(pdf, page) {
  const contents = page.node.Contents();
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  return entries.map(ref => {
    const stream = pdf.context.lookup(ref);
    if (!stream?.getContents) return '';
    const bytes = stream.getContents();
    const compressed = stream.dict?.get(PDFName.of('Filter'))?.toString().includes('FlateDecode');
    return Buffer.from(compressed ? inflateSync(bytes) : bytes).toString('latin1');
  }).join('\n');
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
    // Check the actual generated PDF drawing commands rather than just the page count.
    const operators = pageOperators(pdf, p);
    expect(operators).toMatch(/\bW\s+n\b/);
    expect(operators).toMatch(/\bDo\b/);
  }
});

test('fit-to-image uses full image and disables cropping choice', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('image-sizing').selectOption('cover');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-sizing')).toBeDisabled();
  await expect(page.getByTestId('image-sizing')).toHaveValue('contain');
  await page.getByTestId('image-paper').selectOption('a4');
  await expect(page.getByTestId('image-sizing')).toHaveValue('contain');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-sizing-hint')).toContainText('full original');
});

test('a removed photo must not leave a stale paper state while original PDF pages remain', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles([
    { name: 'old-photo.png', mimeType: 'image/png', buffer: await picture(page, 150, 75) },
    { name: 'retained.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) },
  ]);
  await expect(page.getByTestId('workspace-document-caution')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-margin').selectOption('12');
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  await page.getByTestId('file-input').setInputFiles({
    name: 'fresh-photo.png', mimeType: 'image/png', buffer: await picture(page, 250, 80),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const pdf = await PDFDocument.load(await readFile(await (await event).path()));
  expect(pdf.getPages().map(p => Math.round(p.getWidth()))).toEqual([300, 612]);
});

test('photo-only import should not show irrelevant interactive-form and signature warnings', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'plain-photo.png', mimeType: 'image/png', buffer: await picture(page, 190, 100),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('workspace-document-caution')).toHaveCount(0);
});

test('undo after reimport reactivates old paper settings and blocks mixed-layout export', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles([
    { name: 'original-photo.png', mimeType: 'image/png', buffer: await picture(page, 140, 100) },
    { name: 'keep-original-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-margin').selectOption('12');
  await page.getByTestId('file-input').setInputFiles({
    name: 'new-letter-photo.png', mimeType: 'image/png', buffer: await picture(page, 155, 105),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  // Undo new import, then undo prior photo deletion: older A4 page is back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const output = await PDFDocument.load(await readFile(await (await download).path()));
  expect(output.getPages().map(p => Math.round(p.getWidth()))).toEqual([612, 300]);
});
