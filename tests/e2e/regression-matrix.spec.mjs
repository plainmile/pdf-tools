import { test, expect } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixture(widths, text = 'REGRESSION') {
  const doc = await PDFDocument.create();
  for (let i = 0; i < widths.length; i++) {
    const pg = doc.addPage([widths[i], 550]);
    pg.drawText(text + ' ' + (i + 1), { x: 35, y: 450, size: 14 });
  }
  return Buffer.from(await doc.save());
}
async function captured(page, run, timeout = 30000) {
  const wait = page.waitForEvent('download', { timeout });
  await run();
  const item = await wait;
  return { name: item.suggestedFilename(), bytes: await readFile(await item.path()) };
}

test('combined six-step document workflow preserves ordering, rotation, undo, redo and ZIP page content', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: await fixture([310, 320, 330]) },
    { name: 'beta.pdf', mimeType: 'application/pdf', buffer: await fixture([410, 420]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await page.getByTestId('reverse-all-pages').click();
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  const whole = await captured(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  const wholeDoc = await PDFDocument.load(whole.bytes);
  expect(wholeDoc.getPages().map(pg => pg.getWidth())).toEqual([420,410,330,320,310]);
  expect(wholeDoc.getPages().map(pg => pg.getRotation().angle)).toEqual([0,90,0,0,0]);

  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByTestId('visual-split-panel').locator('summary').click();
  for (const cut of [2,4]) {
    await page.locator('[data-testid="visual-split-cut"][data-after-page="' + cut + '"]').click();
  }
  const zipOut = await captured(page, () => page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click());
  const archive = await JSZip.loadAsync(zipOut.bytes);
  const names = Object.keys(archive.files).sort();
  expect(names).toEqual(['part-01-pages-1-2.pdf','part-02-pages-3-4.pdf','part-03-pages-5-5.pdf']);
  const allWidths = [], allRotations = [];
  for (const name of names) {
    const part = await PDFDocument.load(await archive.file(name).async('uint8array'));
    allWidths.push(...part.getPages().map(pg => pg.getWidth()));
    allRotations.push(...part.getPages().map(pg => pg.getRotation().angle));
  }
  expect(allWidths).toEqual([420,410,330,320,310]);
  expect(allRotations).toEqual([0,90,0,0,0]);
});

test('a corrupt file later in a multi-file batch cannot import earlier valid files from that batch', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'first.pdf', mimeType: 'application/pdf', buffer: await fixture([355]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles([
    { name: 'should-not-appear.pdf', mimeType: 'application/pdf', buffer: await fixture([477]) },
    { name: 'corrupt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF but looks like one') },
  ]);
  await expect(page.locator('.notice-error')).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const saved = await captured(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  const doc = await PDFDocument.load(saved.bytes);
  expect(doc.getPages().map(pg => pg.getWidth())).toEqual([355]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});

test('exact original PDF bytes survive a failed second import and unmodified export', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.setTitle('REGRESSION EXTERNAL SIGNED-LIKE RECORD');
  const sheet = doc.addPage([416,602]);
  sheet.setRotation(degrees(90));
  sheet.setCropBox(19,31,320,499);
  sheet.drawText('CROP RECORD', { x: 40, y: 460 });
  const field = doc.getForm().createTextField('owner');
  field.setText('ALICE-2026');
  field.addToPage(sheet);
  const original = Buffer.from(await doc.save());
  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name:'protected.pdf', mimeType:'application/pdf', buffer:original });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles({ name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('%%%') });
  await expect(page.locator('.notice-error')).toBeVisible();
  const after = await captured(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(Buffer.from(after.bytes).equals(original)).toBe(true);
});

test('conversion flows do not transmit a raw PDF marker through any HTTP request body', async ({ page }) => {
  const marker = 'PRIVATE-REGRESSION-FILE-ONLY-927364';
  const requests = [];
  page.on('request', req => {
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      requests.push({ url: req.url(), method: req.method(), body: req.postData() || '' });
    }
  });
  const input = await fixture([370,390], marker);
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({ name:'secret.pdf', mimeType:'application/pdf', buffer:input });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  const extracted = await captured(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain(marker);
  expect(requests.some(q => q.body.includes(marker) || q.body.startsWith('%PDF-'))).toBe(false);
});

test('book-page selection error remains atomic across fullwidth Chinese input and a valid retry', async ({ page }) => {
  await page.goto('/zh/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name:'book.pdf',mimeType:'application/pdf',buffer:await fixture(Array.from({length:70},(_,i)=>320+i)),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('70');
  const ranges = page.getByTestId('utility-page-ranges');
  const run = page.getByTestId('utility-run');
  await ranges.fill('６９－７１');
  // Validation is now immediate, so an invalid plan cannot start a render.
  await expect(ranges).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('image-range-error')).toContainText('1 至 70');
  await expect(run).toBeDisabled();
  await expect(page.getByTestId('utility-file-summary')).toContainText('70');
  await ranges.fill('７０');
  await expect(page.getByTestId('image-range-error')).toHaveCount(0);
  await expect(run).toBeEnabled();
  const result = await captured(page, () => run.click());
  expect(result.name).toMatch(/page-070\.(jpg|png)$/);
  expect(result.bytes.length).toBeGreaterThan(100);
});

test('320 px mobile layouts keep file and action controls in view across all conversion routes', async ({ page }) => {
  await page.setViewportSize({width:320,height:720});
  for (const tool of ['pdf-to-images','compress-pdf','pdf-to-txt','pdf-to-markdown','txt-to-pdf','markdown-to-pdf','add-page-numbers']) {
    await page.goto('/zh/' + tool + '/');
    await expect(page.getByTestId('pdf-utility')).toBeVisible();
    await expect(page.getByTestId('utility-run')).toBeVisible();
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.document, tool + ': horizontal overflow').toBeLessThanOrEqual(widths.viewport + 2);
  }
});

test('a corrupt replacement cannot discard an undownloaded generated PDF from editable Markdown', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# Keep this result\n\nImportant text');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await page.getByTestId('utility-file-input').setInputFiles({
    name:'invalid.md',mimeType:'text/markdown',buffer:Buffer.from([0xff,0xfe,0xff]),
  });
  await expect(page.getByTestId('utility-replace-confirm')).toBeVisible();
  await page.getByTestId('utility-replace-accept').click();
  await expect(page.locator('.notice-error')).toBeVisible();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  const saved = await captured(page, () => page.getByTestId('utility-pdf-download').click());
  const document = await PDFDocument.load(saved.bytes);
  expect(document.getPageCount()).toBeGreaterThan(0);
});
