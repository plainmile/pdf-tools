import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function source(widths) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < widths.length; i++) {
    const page = doc.addPage([widths[i], 600]);
    page.drawText('CROSS-BROWSER ' + String(i + 1), { x: 25, y: 500 });
  }
  return Buffer.from(await doc.save());
}
async function take(page, action, timeout = 30000) {
  const pending = page.waitForEvent('download', { timeout });
  await action();
  const item = await pending;
  return { filename: item.suggestedFilename(), bytes: await readFile(await item.path()) };
}

async function diagnosticState(page) {
  return page.evaluate(() => ({
    url: location.href,
    errors: [...document.querySelectorAll('.notice-error')].map(x=>x.textContent.trim()),
    statuses: [...document.querySelectorAll('[role="status"]')].map(x=>x.textContent.trim().slice(0,250)),
    warnings: [...document.querySelectorAll('[data-testid="text-extraction-warning"]')].map(x=>x.textContent.trim()),
    result: [...document.querySelectorAll('[data-testid$="-text-result"]')].map(x=>x.dataset.testid),
    preview: document.querySelector('#utility-preview')?.value?.slice(0,220) || '',
    buttonDisabled: document.querySelector('[data-testid="utility-run"]')?.disabled,
    fileSummary: document.querySelector('[data-testid="utility-file-summary"]')?.textContent || '',
  })).catch(error => ({ unavailable: String(error) }));
}

test('Firefox/WebKit: full PDF edit and split preserves page widths, no rasterized blank pages', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: await source([328,349]) },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: await source([381]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByTestId('reverse-all-pages').click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByTestId('visual-split-panel').locator('summary').click();
  await page.locator('[data-testid="visual-split-cut"][data-after-page="1"]').click();
  const archive = await take(page, () => page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click());
  const zip = await JSZip.loadAsync(archive.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['part-01-pages-1-1.pdf','part-02-pages-2-3.pdf']);
  const first = await PDFDocument.load(await zip.file('part-01-pages-1-1.pdf').async('uint8array'));
  const next = await PDFDocument.load(await zip.file('part-02-pages-2-3.pdf').async('uint8array'));
  expect([...first.getPages(), ...next.getPages()].map(pg => pg.getWidth())).toEqual([381,349,328]);
});

test('Firefox/WebKit: interactive form text remains visible in TXT, with an explicit review download', async ({ page }) => {
  const pdf = await PDFDocument.create();
  const pg = pdf.addPage([430,630]);
  pg.drawText('Applicant questionnaire', {x:33,y:580});
  const f = pdf.getForm().createTextField('person.name');
  f.setText('FRIENDLY-PRIVATE-FORM');
  f.addToPage(pg,{x:45,y:450,width:250,height:26});
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'application.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save()),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible({timeout:25000});
  const auto = [];
  page.on('download', d=>auto.push(d.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  try {
    await expect(page.getByTestId('form-text-result')).toBeVisible();
  } catch (error) {
    throw new Error('Form-field regression diagnostic: ' +
      JSON.stringify({ page: await diagnosticState(page), autoDownloads: auto }) + '; ' + error.message);
  }
  expect(auto).toEqual([]);
  const out = await take(page, () => page.getByTestId('form-text-download').click());
  expect(out.bytes.toString('utf8')).toContain('person.name: FRIENDLY-PRIVATE-FORM');
});

test('Safari without ReadableStream async iteration still exports real selectable PDF text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
      configurable: true, value: undefined,
    });
  });
  await page.goto('/pdf-to-txt/');
  const pdf = await source([375, 395]);
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'no-stream-iterator.pdf', mimeType: 'application/pdf', buffer: pdf,
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  const result = await take(page, () => page.getByTestId('utility-run').click());
  const text = result.bytes.toString('utf8');
  expect(text).toContain('CROSS-BROWSER 1');
  expect(text).toContain('CROSS-BROWSER 2');
});

test('Firefox/WebKit: cancelled local file reading releases controls and preserves source PDF', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({name:'original.pdf',mimeType:'application/pdf',buffer:await source([392])});
  await expect(page.getByTestId('utility-file-summary')).toContainText('original.pdf');
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function(file) {
      if (file.name === 'never.pdf') return;
      return read.call(this, file);
    };
  });
  await page.getByTestId('utility-file-input').setInputFiles({name:'never.pdf',mimeType:'application/pdf',buffer:await source([500])});
  await expect(page.getByTestId('utility-load-cancel')).toBeVisible();
  await page.getByTestId('utility-load-cancel').click();
  await expect(page.getByTestId('utility-load-cancel')).toHaveCount(0);
  await expect(page.getByTestId('utility-file-summary')).toContainText('original.pdf');
  let downloaded;
  try {
    downloaded = await take(page, () => page.getByTestId('utility-run').click());
  } catch (error) {
    throw new Error('Post-cancel text conversion diagnostic: ' +
      JSON.stringify(await diagnosticState(page)) + '; ' + error.message);
  }
  expect(downloaded.bytes.toString('utf8')).toContain('CROSS-BROWSER 1');
});

test('Firefox/WebKit: 112-page source exports final page as an actual PNG', async ({ page }) => {
  test.setTimeout(55000);
  await page.goto('/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name:'large.pdf', mimeType:'application/pdf', buffer:await source(Array.from({length:112}, (_,i)=>300+i)),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('112', {timeout:25000});
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('112');
  const image = await take(page, () => page.getByTestId('utility-run').click(),45000);
  expect(image.filename).toContain('page-112.png');
  expect(image.bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(image.bytes.readUInt32BE(16)).toBeGreaterThan(0);
});

test('Firefox/WebKit: 320px split UI remains usable and keeps manually typed partial ranges', async ({ page }) => {
  await page.setViewportSize({width:320,height:720});
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({name:'mobile.pdf',mimeType:'application/pdf',buffer:await source([301,302,303,304])});
  // This route starts on Split, so the Organize page cards are intentionally hidden.
  await expect(page.locator('.file-count')).toContainText('4 页');
  await page.getByRole('textbox', { name: '页码范围' }).fill('2-3');
  await page.getByTestId('visual-split-panel').locator('summary').click();
  await page.locator('[data-testid="visual-split-cut"][data-after-page="1"]').click();
  await expect(page.getByTestId('visual-split-confirm')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '页码范围' })).toHaveValue('2-3');
  await page.getByTestId('visual-split-keep').click();
  await expect(page.getByTestId('visual-split-confirm')).toHaveCount(0);
  const sizes = await page.evaluate(() => ({document:document.documentElement.scrollWidth, viewport:document.documentElement.clientWidth}));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 2);
});
