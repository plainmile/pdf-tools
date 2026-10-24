import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFDict, PDFName } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixturePdf(label = 'Hello PDF world', count = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < count; n++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(label + ' ' + (n + 1), { x: 30, y: 715, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

async function upload(page, bytes) {
  await page.getByTestId('utility-file-input').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible({ timeout: 20000 });
}

async function generateTextPdfAndDownload(page, timeout = 18000) {
  const downloads = [];
  const track = item => downloads.push(item.suggestedFilename());
  page.on('download', track);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout });
  await expect.poll(() => page.getByTestId('utility-pdf-preview').locator('canvas')
    .evaluate(canvas => canvas.width), { timeout }).toBeGreaterThan(0);
  expect(downloads).toEqual([]);
  page.off('download', track);
  return getDownload(page, () => page.getByTestId('utility-pdf-download').click());
}

async function getDownload(page, action, timeout = 6000) {
  const event = page.waitForEvent('download', { timeout }).catch(async () => {
    const errors = await page.getByRole('alert').allTextContents();
    const messages = await page.getByRole('status').allTextContents();
    throw new Error('No PDF utility download. Alerts: ' + JSON.stringify(errors) + '; Status: ' + JSON.stringify(messages));
  });
  await action();
  const download = await event;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('two-column PDF text extraction has explicit row, left and right orders and preserves old results', async ({ page }) => {
  const source = await PDFDocument.create();
  const pagePdf = source.addPage([600, 800]);
  for (let n=0; n<3; n++) {
    const y=700-n*28;
    pagePdf.drawText('LEFT'+(n+1), { x:40, y, size:12 });
    pagePdf.drawText('RIGHT'+(n+1), { x:340, y, size:12 });
  }
  const bytes = Buffer.from(await source.save());
  await page.goto('/pdf-to-txt/');
  await upload(page, bytes);
  const picker = page.getByTestId('text-reading-order');
  await expect(picker).toHaveValue('rows');
  const rows = (await getDownload(page, () => page.getByTestId('utility-run').click(), 20000)).bytes.toString('utf8');
  expect(rows.indexOf('RIGHT1')).toBeLessThan(rows.indexOf('LEFT2'));
  await picker.selectOption('left-first');
  await expect(page.getByTestId('text-reading-order-stale')).toBeVisible();
  const leftFirst = (await getDownload(page, () => page.getByTestId('utility-run').click(), 20000)).bytes.toString('utf8');
  expect(leftFirst).toContain('LEFT1\nLEFT2\nLEFT3\nRIGHT1\nRIGHT2\nRIGHT3');
  await picker.selectOption('right-first');
  await expect(page.getByTestId('text-reading-order-stale')).toBeVisible();
  const rightFirst = (await getDownload(page, () => page.getByTestId('utility-run').click(), 20000)).bytes.toString('utf8');
  expect(rightFirst).toContain('RIGHT1\nRIGHT2\nRIGHT3\nLEFT1\nLEFT2\nLEFT3');
  await page.goto('/zh/pdf-to-markdown/');
  await page.setViewportSize({width:375,height:812});
  await upload(page,bytes);
  const zhPicker=page.getByTestId('text-reading-order');
  await expect(zhPicker.locator('option')).toHaveCount(3);
  await zhPicker.selectOption('left-first');
  const markdown = (await getDownload(page, () => page.getByTestId('utility-run').click(), 20000)).bytes.toString('utf8');
  expect(markdown.indexOf('LEFT3')).toBeLessThan(markdown.indexOf('RIGHT1'));
  const viewport = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width+2);
});

test('localized image page range downloads named ZIP containing the correct images', async ({ page }) => {
  await page.goto('/zh/pdf-to-images/');
  await upload(page, await fixturePdf('Localized range source', 8));
  await page.getByRole('combobox', { name: '图片格式' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('２－３，５');
  const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect(output.name).toMatch(/fixture-pages-2-3_5\.zip$/);
  const archive = await JSZip.loadAsync(output.bytes);
  expect(Object.keys(archive.files).sort()).toEqual(['page-002.png', 'page-003.png', 'page-005.png']);
  for (const name of Object.keys(archive.files)) {
    const bytes = await archive.files[name].async('uint8array');
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test('custom PDF image order survives ZIP extraction and alphabetical sorting', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Source image pages', 5));
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('3,1,2');
  await expect(page.getByText('order-001', { exact: false })).toBeVisible();
  const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect(output.name).toMatch(/fixture-pages-3_1_2\.zip$/);
  const archive = await JSZip.loadAsync(output.bytes);
  const names = Object.keys(archive.files).sort();
  expect(names).toEqual([
    'order-001-page-003.png', 'order-002-page-001.png', 'order-003-page-002.png',
  ]);
  for (const name of names) {
    const bytes = await archive.files[name].async('uint8array');
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  // An ordinary ascending selection keeps the existing stable image filenames.
  await page.getByTestId('utility-page-ranges').fill('1,3');
  const normal = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  const standardZip = await JSZip.loadAsync(normal.bytes);
  expect(Object.keys(standardZip.files).sort()).toEqual(['page-001.png', 'page-003.png']);
});

test('PDF to image PNG selected pages ZIP has valid images, JPG single page valid JPEG', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf());
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  const multi = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(multi.name).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(multi.bytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['page-001.png', 'page-002.png']);
  const png = await zip.files[names[0]].async('uint8array');
  expect(Array.from(png.slice(0, 8))).toEqual([137,80,78,71,13,10,26,10]);
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('jpg');
  await page.getByTestId('utility-page-ranges').fill('2');
  const single = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(single.name).toMatch(/\.jpg$/);
  expect(Array.from(single.bytes.slice(0, 3))).toEqual([255,216,255]);
});

test('220 DPI PDF-to-PNG export matches real pixel dimensions and keeps safety limit', async ({ page }) => {
  const document = await PDFDocument.create();
  document.addPage([72, 72]).drawRectangle({ x: 8, y: 8, width: 50, height: 50 });
  await page.goto('/pdf-to-images/');
  await upload(page, Buffer.from(await document.save()));
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  const resolution = page.getByRole('combobox', { name: 'Render resolution' });
  await resolution.selectOption({ label: 'Print quality (220 DPI)' });
  await expect(page.getByTestId('image-print-hint')).toContainText('Large pages');
  const printPng = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect(printPng.name).toMatch(/page-001\.png$/);
  expect(printPng.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([printPng.bytes.readUInt32BE(16), printPng.bytes.readUInt32BE(20)]).toEqual([220, 220]);
  await resolution.selectOption('2');
  const normalPng = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect([normalPng.bytes.readUInt32BE(16), normalPng.bytes.readUInt32BE(20)]).toEqual([144, 144]);
  const oversized = await PDFDocument.create();
  oversized.addPage([1800, 1800]);
  await upload(page, Buffer.from(await oversized.save()));
  await resolution.selectOption({ label: 'Print quality (220 DPI)' });
  const downloads = [];
  const track = result => downloads.push(result);
  page.on('download', track);
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('too large to rasterize', { timeout: 15000 });
  expect(downloads).toHaveLength(0);
  page.off('download', track);

  // Very wide but low-area pages must also fail before creating a canvas:
  // 6,100 pt × 80 pt at 220 DPI is under 12 MP but >16,384 px wide.
  const wide = await PDFDocument.create();
  wide.addPage([6100, 80]);
  await upload(page, Buffer.from(await wide.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('too large to rasterize', { timeout: 15000 });
});

test('compression never auto-downloads, blocks a larger PDF, and shows actual byte sizes', async ({ page }) => {
  const small = await fixturePdf('Small page', 1);
  await page.goto('/compress-pdf/');
  await upload(page, small);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-result')).toBeVisible({ timeout: 3000 }).catch(async () => {
    throw new Error('Compression output missing. Alerts: ' + JSON.stringify(await page.getByRole('alert').allTextContents()));
  });
  await expect(page.getByTestId('compression-download')).toBeDisabled();
  await expect(page.getByTestId('compression-preview-action')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Stopped early');
  await expect(page.getByTestId('compression-change-label')).toHaveText('Size increase');
  await expect(page.getByTestId('compression-result')).toContainText('At least');
  await expect(page.getByTestId('compression-change-value')).not.toContainText('-');

  const rawPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 700;
    const ctx = canvas.getContext('2d'); const image = ctx.createImageData(700,700);
    // Deterministic non-compressible PNG; JPEG significantly shrinks this PDF.
    let n = 12345;
    for (let p = 0; p < image.data.length; p += 4) {
      n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
      image.data[p] = n & 255; image.data[p + 1] = (n >>> 8) & 255;
      image.data[p + 2] = (n >>> 16) & 255; image.data[p + 3] = 255;
    }
    ctx.putImageData(image,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const imageDoc = await PDFDocument.create();
  const image = await imageDoc.embedPng(Buffer.from(rawPng, 'base64'));
  imageDoc.addPage([595.28,841.89]).drawImage(image, {x:0,y:0,width:595,height:841});
  const input = Buffer.from(await imageDoc.save());
  await upload(page, input);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  await expect(page.getByTestId('compression-change-label')).toHaveText('Saved');
  // Changing compression level must NOT discard an expensive undownloaded
  // output; it remains clearly labelled as a previous result.
  await page.getByRole('combobox', { name: 'Compression level' }).selectOption('clearer');
  await expect(page.getByTestId('compression-result-stale')).toContainText('previous result');
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  await page.getByTestId('compression-preview-action').click();
  await expect(page.getByTestId('compression-preview')).toBeVisible();
  await expect.poll(() => page.getByTestId('compression-preview').locator('canvas').evaluate(canvas => canvas.width), { timeout: 15000 }).toBeGreaterThan(0);
  await page.getByTestId('compression-preview-action').click();
  await expect(page.getByTestId('compression-preview')).toHaveCount(0);
  await expect(page.getByTestId('compression-change-value')).not.toContainText('-');
  const compressed = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect(compressed.bytes.byteLength).toBeLessThan(input.byteLength);
  expect((await PDFDocument.load(compressed.bytes)).getPageCount()).toBe(1);
  // Regenerating with the new setting replaces only after successful work.
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-result-stale')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  const clearer = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect(clearer.bytes.length).toBeLessThan(input.length);
  expect((await PDFDocument.load(clearer.bytes)).getPageCount()).toBe(1);
});

test('unsuccessful compression retry keeps an undownloaded earlier, genuinely smaller PDF', async ({ page }) => {
  test.setTimeout(70000);
  await page.goto('/compress-pdf/');
  // Source JPEG is small at low quality. Downsampled compact recompression
  // saves bytes, while clearer 1.5x high-quality rasterization is larger.
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 760; canvas.height = 980;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(canvas.width, canvas.height);
    let seed = 97531;
    for (let i = 0; i < image.data.length; i += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      image.data[i] = seed & 255;
      image.data[i + 1] = (seed >>> 8) & 255;
      image.data[i + 2] = (seed >>> 16) & 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/jpeg', .37).split(',')[1];
  });
  const doc = await PDFDocument.create();
  const embedded = await doc.embedJpg(Buffer.from(base64, 'base64'));
  doc.addPage([595, 842]).drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  const original = Buffer.from(await doc.save());
  await upload(page, original);
  await page.getByRole('combobox', { name: 'Compression level' }).selectOption('compact');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled({ timeout: 30000 });
  await expect(page.getByTestId('compression-change-label')).toHaveText('Saved');

  // Leave the successful result UNDOWLOADED and retry with a level that
  // cannot beat the original; previous code erased these bytes on no savings.
  await page.getByRole('combobox', { name: 'Compression level' }).selectOption('clearer');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-retry-kept')).toContainText('previous successful result', { timeout: 30000 });
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  await expect(page.getByTestId('compression-change-label')).toHaveText('Saved');
  const stillThere = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect(stillThere.bytes.length).toBeLessThan(original.length);
  expect((await PDFDocument.load(stillThere.bytes)).getPageCount()).toBe(1);
});

test('Windows-reserved source names produce safe TXT and Markdown downloads', async ({ page }) => {
  const pdf = await fixturePdf('Filename compatibility', 1);
  for (const [route, name, expected] of [
    ['/pdf-to-txt/', 'CON.pdf', 'plainmile-CON.txt'],
    ['/pdf-to-markdown/', 'nul.pdf', 'plainmile-nul.md'],
    ['/pdf-to-txt/', 'NUL.tar.pdf', 'plainmile-NUL.tar.txt'],
    ['/pdf-to-markdown/', 'COM¹.pdf', 'plainmile-COM¹.md'],
  ]) {
    await page.goto(route);
    await page.getByTestId('utility-file-input').setInputFiles({
      name, mimeType: 'application/pdf', buffer: pdf,
    });
    await expect(page.getByTestId('utility-file-summary')).toContainText(name);
    const output = await getDownload(page, () => page.getByTestId('utility-run').click());
    expect(output.name).toBe(expected);
    expect(output.bytes.toString('utf8')).toContain('Filename compatibility');
  }
});

test('complete PDF text can be downloaded again without reprocessing (TXT and Chinese Markdown)', async ({ page }) => {
  const pdf = await fixturePdf('Retained complete text', 2);
  for (const [route, ext, label] of [
    ['/pdf-to-txt/', '.txt', 'Download again'],
    ['/zh/pdf-to-markdown/', '.md', '再次下载'],
  ]) {
    await page.goto(route);
    await upload(page, pdf);
    const first = await getDownload(page, () => page.getByTestId('utility-run').click());
    expect(first.name.endsWith(ext)).toBe(true);
    const repeatButton = page.getByTestId('complete-text-download');
    await expect(repeatButton).toBeVisible();
    await expect(repeatButton).toContainText(label);
    await expect(page.getByTestId('partial-text-result')).toHaveCount(0);
    const second = await getDownload(page, () => repeatButton.click());
    expect(second.name).toBe(first.name);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.bytes.toString('utf8')).toContain('Retained complete text');
  }
});

test('PDF to TXT and Markdown extract actual text, reject empty scanned pages', async ({ page }) => {
  const pdf = await fixturePdf('Hello searchable PlainMile');
  for (const [path, extension] of [['/pdf-to-txt/', 'txt'], ['/pdf-to-markdown/', 'md']]) {
    await page.goto(path);
    await upload(page, pdf);
    const downloaded = await getDownload(page, () => page.getByTestId('utility-run').click());
    expect(downloaded.name).toMatch(new RegExp('\\.' + extension + '$'));
    expect(downloaded.bytes.toString('utf8')).toContain('Hello searchable PlainMile');
  }
  const empty = await PDFDocument.create(); empty.addPage([400,400]);
  await page.goto('/pdf-to-txt/');
  await upload(page, Buffer.from(await empty.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('No selectable text');
});

test('UTF-16 LE TXT import preserves text through real PDF and TXT downloads', async ({ page }) => {
  const value = 'Pay period: 2026-10-01 to 2026-10-15\nHours paid: 40';
  const binary = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'windows-unicode.txt', mimeType: 'text/plain', buffer: binary,
  });
  await expect(page.getByTestId('utility-text')).toHaveValue(value);
  const generated = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(generated.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain('Hours paid: 40');
  expect(extracted.bytes.toString('utf8')).toContain('Pay period: 2026-10-01 to 2026-10-15');
});

test('UTF-16 BE Markdown imports Chinese correctly; malformed text preserves old PDF', async ({ page }) => {
  const content = '# Chapter 1\nReport 中文';
  const le = Buffer.from(content, 'utf16le');
  const be = Buffer.from(le);
  for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'unicode.md', mimeType: 'text/markdown',
    buffer: Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
  });
  await expect(page.getByTestId('utility-text')).toHaveValue(content);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  // Bad re-import must never discard the successfully generated PDF.
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]),
  });
  await expect(page.getByTestId('utility-replace-confirm')).toBeVisible();
  await page.getByTestId('utility-replace-accept').click();
  await expect(page.getByRole('alert')).toContainText('not valid UTF-8');
  await expect(page.getByTestId('utility-text')).toHaveValue(content);
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  const downloaded = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(downloaded.bytes)).getPageCount()).toBe(1);
});

test('TXT to PDF yields selectable text after real download and re-import', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Hello selectable world');
  const latin = await generateTextPdfAndDownload(page);
  const pdf = await PDFDocument.load(latin.bytes);
  expect(pdf.getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, latin.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain('Hello selectable world');
});

test('mixed English and Chinese TXT rasterizes only the CJK page and preserves searchable English pages', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/txt-to-pdf/');
  // At 11 pt / 1.55 line height, 43 short lines occupy one A4 page.
  // One CJK section in the middle must not rasterize the two English pages.
  const input = [
    ...Array.from({ length: 43 }, (_, i) => 'English opening page row ' + (i + 1)),
    ...Array.from({ length: 43 }, (_, i) => '中文中间页 ' + (i + 1)),
    ...Array.from({ length: 43 }, (_, i) => 'Searchable final page row ' + (i + 1)),
  ].join('\n');
  await page.getByTestId('utility-text').fill(input);
  const result = await generateTextPdfAndDownload(page, 30000);
  const doc = await PDFDocument.load(result.bytes);
  expect(doc.getPageCount()).toBe(3);
  const imageCounts = doc.getPages().map(pdfPage => {
    const ref = pdfPage.node.Resources();
    const resources = ref && doc.context.lookup(ref, PDFDict);
    const objects = resources?.get(PDFName.of('XObject'));
    return objects ? doc.context.lookup(objects, PDFDict).keys().length : 0;
  });
  expect(imageCounts).toEqual([0, 1, 0]);
  await expect(page.getByRole('status')).toContainText('1 of 3 pages contain unsupported characters');
  await expect(page.getByRole('status')).toContainText('other 2 pages retain selectable text');

  // Check actual PDF text with the site's own converter; the CJK page has no
  // hidden fake searchable layer, but both untouched English pages do.
  await page.goto('/pdf-to-txt/');
  await upload(page, result.bytes);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-extraction-warning')).toContainText('1 of 3 pages have no selectable text');
  const extracted = await getDownload(page, () => page.getByTestId('partial-text-download').click());
  const text = extracted.bytes.toString('utf8');
  expect(text).toContain('English opening page row 1');
  expect(text).toContain('Searchable final page row 43');
  expect(text).not.toContain('中文中间页');
});

test('CJK text PDF is rendered near the top of the page, not upside-down at the bottom', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('中文第一行比较长：检查书写顺序和位置\n第二行文字');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 30000 });
  const canvas = page.getByTestId('utility-pdf-preview').locator('canvas');
  const ink = () => canvas.evaluate(element => {
    const { width, height } = element;
    if (!width || !height) return { top: 0, bottom: 0 };
    const pixels = element.getContext('2d').getImageData(0, 0, width, height).data;
    let top = 0, bottom = 0;
    // Count actual dark pixels in the rendered PDF, not the JSX success text.
    // A4 text starts at PDF Y~796, corresponding to CANVAS top Y~46.
    for (let y = Math.floor(height * .04); y < Math.floor(height * .96); y++) {
      const upper = y < height * .30, lower = y > height * .70;
      if (!upper && !lower) continue;
      for (let x = 14; x < width - 14; x++) {
        const offset = (y * width + x) * 4;
        // Unrendered HTML canvas pixels are transparent black (RGBA 0,0,0,0).
        // Count only opaque rendered PDF ink, not yet-to-be-painted rows.
        if (pixels[offset + 3] >= 200 && pixels[offset] < 190 && pixels[offset + 1] < 190 && pixels[offset + 2] < 190) {
          if (upper) top++;
          if (lower) bottom++;
        }
      }
    }
    return { top, bottom };
  });
  await expect.poll(async () => (await ink()).top, { timeout: 30000 }).toBeGreaterThan(50);
  const bands = await ink();
  expect(bands.bottom).toBeLessThan(5);
  const output = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(1);
});

test('Chinese Markdown to PDF produces a real local raster image page', async ({ page }) => {
  // CJK page rendering runs browser fonts, canvas and PDF.js preview before
  // download. Give this heavier workflow its own budget on public CI runners.
  test.setTimeout(60000);
  await page.goto('/zh/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# 中文标题\n\n- 第一项\n- 第二项');
  const cjk = await generateTextPdfAndDownload(page);
  const result = await PDFDocument.load(cjk.bytes);
  expect(result.getPageCount()).toBe(1);
  const resources = result.context.lookup(result.getPage(0).node.Resources(), PDFDict);
  expect(result.context.lookup(resources.get(PDFName.of('XObject')), PDFDict).keys().length).toBeGreaterThan(0);
  await expect(page.getByRole('status')).toContainText('无法选择和搜索文字');
});

test('numbered PDF stores the requested starting numbers as selectable text', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf());
  await page.getByTestId('number-start').fill('7');
  await page.getByRole('combobox', { name: 'Position' }).selectOption('top-right');
  const downloaded = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect((await PDFDocument.load(downloaded.bytes)).getPageCount()).toBe(2);
  await page.goto('/pdf-to-txt/');
  await upload(page, downloaded.bytes);
  const text = (await getDownload(page, () => page.getByTestId('utility-run').click())).bytes.toString('utf8');
  expect(text).toMatch(/\b7\b/);
  expect(text).toMatch(/\b8\b/);
});

test('numbered PDF skips cover and contents so page 3 starts at printed 1', async ({ page }) => {
  const original = await PDFDocument.create();
  const font = await original.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 5; index++) {
    const sheet = original.addPage([595.28, 841.89]);
    if (index === 0) sheet.drawText('COVER WITHOUT NUMBER', { x: 40, y: 700, font, size: 14 });
    if (index === 1) sheet.drawText('CONTENTS WITHOUT NUMBER', { x: 40, y: 700, font, size: 14 });
  }
  await page.goto('/add-page-numbers/');
  await upload(page, Buffer.from(await original.save()));
  await expect(page.getByTestId('number-first-pdf-page')).toHaveValue('1');
  await expect(page.getByTestId('number-first-page-hint')).toContainText('stay unnumbered');
  await page.getByTestId('number-first-pdf-page').fill('3');
  await page.getByTestId('number-start').fill('1');
  const numbered = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
  expect((await PDFDocument.load(numbered.bytes)).getPageCount()).toBe(5);
  await page.goto('/pdf-to-txt/');
  await upload(page, numbered.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
  const parts = extracted.bytes.toString('utf8').trim().split(/\n\s*\n/).map(s => s.trim());
  expect(parts).toEqual(['COVER WITHOUT NUMBER', 'CONTENTS WITHOUT NUMBER', '1', '2', '3']);
});

test('new shorter PDF resets stale page-number start while valid settings survive replacement', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf('Long file', 5));
  await page.getByTestId('number-first-pdf-page').fill('5');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'short.pdf', mimeType: 'application/pdf', buffer: await fixturePdf('Short file', 2),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('short.pdf');
  await expect(page.getByTestId('number-first-pdf-page')).toHaveValue('1');
  await expect(page.getByRole('status')).toContainText('reset to PDF page 1');
  const numbered = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
  expect((await PDFDocument.load(numbered.bytes)).getPageCount()).toBe(2);
  await page.getByTestId('number-first-pdf-page').fill('2');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'longer.pdf', mimeType: 'application/pdf', buffer: await fixturePdf('Longer file', 4),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('longer.pdf');
  await expect(page.getByTestId('number-first-pdf-page')).toHaveValue('2');
});

test('Chinese mobile PDF numbering validates starting PDF page and last printed number', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/add-page-numbers/');
  await upload(page, await fixturePdf('Chinese numbering control', 5));
  await expect(page.getByTestId('number-first-page-hint')).toContainText('封面');
  await page.getByTestId('number-first-pdf-page').fill('6');
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('开始编号的 PDF 页码超出范围');
  await page.getByTestId('number-first-pdf-page').fill('3');
  await page.getByTestId('number-start').fill('99999');
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('不能超过 99999');
  await page.getByTestId('number-first-pdf-page').fill('5');
  const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
  expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(5);
  const viewport = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 2);
});

test('all new Chinese/English landing routes and footer open-source attribution', async ({ page }) => {
  for (const path of ['pdf-to-images','compress-pdf','pdf-to-txt','pdf-to-markdown','txt-to-pdf','markdown-to-pdf','add-page-numbers']) {
    for (const prefix of ['/', '/zh/']) {
      const response = await page.goto(prefix + path + '/');
      expect(response?.status(), prefix + path).toBe(200);
      await expect(page.getByTestId('pdf-utility')).toBeVisible();
      await expect(page.getByRole('link', { name: /GitHub (source code|开源代码)/ })).toHaveAttribute('href', 'https://github.com/plainmile/pdf-tools');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://pdf.plainmile.com' + prefix + path + '/');
    }
  }
});

test('320-page book extracts its first and last text and preserves all pages when numbering', async ({ page }) => {
  test.setTimeout(120000);
  const book = await fixturePdf('Book chapter', 320);
  await page.goto('/pdf-to-txt/');
  await upload(page, book);
  await expect(page.getByTestId('utility-file-summary')).toContainText('320');
  await expect(page.getByTestId('large-document-note')).toBeVisible();
  const textFile = await getDownload(page, () => page.getByTestId('utility-run').click(), 90000);
  const plain = textFile.bytes.toString('utf8');
  expect(plain).toContain('Book chapter 1');
  expect(plain).toContain('Book chapter 320');

  await page.goto('/add-page-numbers/');
  await upload(page, book);
  await page.getByTestId('number-start').fill('201');
  const numberedFile = await getDownload(page, () => page.getByTestId('utility-run').click(), 90000);
  const numberedPdf = await PDFDocument.load(numberedFile.bytes);
  expect(numberedPdf.getPageCount()).toBe(320);
  await page.goto('/pdf-to-txt/');
  await upload(page, numberedFile.bytes);
  const numbers = (await getDownload(page, () => page.getByTestId('utility-run').click(), 90000)).bytes.toString('utf8');
  expect(numbers).toMatch(/\b201\b/);
  expect(numbers).toMatch(/\b520\b/);
});

test('long PDF image exporter accepts late page range and blocks 61 images per batch', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Page selection book', 320));
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  await page.getByTestId('utility-page-ranges').fill('301-302');
  const downloaded = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  const zip = await JSZip.loadAsync(downloaded.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['page-301.png','page-302.png']);
  await page.getByTestId('utility-page-ranges').fill('1-61');
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('up to 60 pages');
});

test('1000-page PDF image ZIP keeps correct numeric filename order at the last page', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Thousand-page image naming', 1000));
  await expect(page.getByTestId('utility-file-summary')).toContainText('1000');
  await page.getByTestId('utility-page-ranges').fill('999-1000');
  const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  const zip = await JSZip.loadAsync(output.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['page-0999.jpg', 'page-1000.jpg']);
  for (const image of Object.values(zip.files)) {
    const bytes = await image.async('uint8array');
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  }
  await page.getByTestId('utility-page-ranges').fill('1-2');
  const firstBatch = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  const firstZip = await JSZip.loadAsync(firstBatch.bytes);
  expect(Object.keys(firstZip.files).sort()).toEqual(['page-0001.jpg', 'page-0002.jpg']);
});

test('text import accepts more than 1 MB, rejects files larger than 5 MiB', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  const text = Buffer.alloc(1024 * 1024 + 1024, 65);
  await page.getByTestId('utility-file-input').setInputFiles({ name: 'book.txt', mimeType: 'text/plain', buffer: text });
  await expect.poll(async () => (await page.getByTestId('utility-text').inputValue()).length).toBe(text.length);
  const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 65);
  await page.getByTestId('utility-file-input').setInputFiles({ name: 'huge.txt', mimeType: 'text/plain', buffer: tooBig });
  await expect(page.getByRole('alert')).toContainText('supported file');
});

test('rasterizer refuses a giant page before allocating a large canvas', async ({ page }) => {
  const huge = await PDFDocument.create();
  huge.addPage([16000,16000]);
  await page.goto('/pdf-to-images/');
  await upload(page, Buffer.from(await huge.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('too large to rasterize');
});

test('compression has its own 120-page limit rather than blocking all PDF tools at 50', async ({ page }) => {
  await page.goto('/compress-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'long-compression.pdf', mimeType: 'application/pdf',
    buffer: await fixturePdf('large scanner', 121),
  });
  await expect(page.getByRole('alert')).toContainText('120 pages');
  await expect(page.getByTestId('utility-file-summary')).toHaveCount(0);
});


test('dragging a PDF into a converter loads it locally and exports real text', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  const writes = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + request.url()); });
  const bytes = (await fixturePdf('Drag and drop PlainMile')).toString('base64');
  await expect(page.getByTestId('utility-dropzone')).toBeVisible();
  await page.evaluate(base64 => {
    const data = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'local.pdf', { type: 'application/pdf' }));
    const dropzone = document.querySelector('[data-testid="utility-dropzone"]');
    dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, bytes);
  await expect(page.getByTestId('utility-file-summary')).toContainText('local.pdf');
  const text = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(text.bytes.toString('utf8')).toContain('Drag and drop PlainMile');
  expect(writes).toEqual([]);
});

test('TXT drag and drop opens editable text, and Clear empties imported source', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await expect(page.getByTestId('utility-dropzone')).toBeVisible();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Local book text input'], 'chapter.txt', { type: 'text/plain' }));
    const dropzone = document.querySelector('[data-testid="utility-dropzone"]');
    dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId('utility-text')).toHaveValue('Local book text input');
  await expect(page.getByTestId('text-file-summary')).toContainText('chapter.txt');
  const pdf = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
  await page.getByTestId('text-file-summary').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('utility-text')).toHaveValue('');
  await expect(page.getByTestId('utility-run')).toBeDisabled();
});

test('125-page PDF displays safe image batches and exports last five actual pages as ZIP', async ({ page }) => {
  test.setTimeout(70000);
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Batch source', 125));
  const input = page.getByTestId('utility-page-ranges');
  await expect(input).toHaveValue('1-60');
  await expect(page.getByTestId('utility-batch-nav')).toContainText('1 of 3');
  await expect(page.getByTestId('utility-batch-prev')).toBeDisabled();
  await page.getByTestId('utility-batch-next').click();
  await expect(input).toHaveValue('61-120');
  await page.getByTestId('utility-batch-next').click();
  await expect(input).toHaveValue('121-125');
  await expect(page.getByTestId('utility-batch-next')).toBeDisabled();
  const result = await getDownload(page, () => page.getByTestId('utility-run').click(), 45000);
  expect(result.name).toMatch(/pages-121-125\.zip$/);
  const zip = await JSZip.loadAsync(result.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['page-121.jpg', 'page-122.jpg', 'page-123.jpg', 'page-124.jpg', 'page-125.jpg']);
  const last = await zip.files['page-125.jpg'].async('uint8array');
  expect(Array.from(last.slice(0, 3))).toEqual([255, 216, 255]);
  await page.getByTestId('utility-batch-prev').click();
  await expect(input).toHaveValue('61-120');
});

test('custom image page ranges cannot silently jump to stale 60-page batches', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Custom batch navigation', 320));
  const input = page.getByTestId('utility-page-ranges');
  await expect(input).toHaveValue('1-60');
  await input.fill('301-306');
  await expect(page.getByTestId('utility-batch-nav')).toContainText('Custom page selection');
  await expect(page.getByTestId('utility-batch-next')).toBeDisabled();
  await expect(page.getByTestId('utility-batch-prev')).toBeDisabled();
  await expect(page.getByTestId('utility-batch-custom')).toContainText('Return to batches');
  await page.getByTestId('utility-batch-resume').click();
  await expect(input).toHaveValue('301-320');
  await expect(page.getByTestId('utility-batch-nav')).toContainText('6 of 6');
  await expect(page.getByTestId('utility-batch-next')).toBeDisabled();
  await page.getByTestId('utility-batch-prev').click();
  await expect(input).toHaveValue('241-300');
  await input.fill('400-300');
  await page.getByTestId('utility-batch-resume').click();
  await expect(input).toHaveValue('241-300');
});

test('Chinese custom fullwidth range resumes the containing batch on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/pdf-to-images/');
  await upload(page, await fixturePdf('Chinese custom pages', 125));
  await page.getByTestId('utility-page-ranges').fill('１２１－１２５');
  await expect(page.getByTestId('utility-batch-nav')).toContainText('自定义页码范围');
  await expect(page.getByTestId('utility-batch-next')).toBeDisabled();
  await page.getByTestId('utility-batch-resume').click();
  await expect(page.getByTestId('utility-page-ranges')).toHaveValue('121-125');
  await page.getByTestId('utility-batch-prev').click();
  await expect(page.getByTestId('utility-page-ranges')).toHaveValue('61-120');
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 2);
});

test('Chinese converter on narrow mobile keeps native file chooser and page batches accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/pdf-to-images/');
  await expect(page.getByTestId('utility-dropzone')).toContainText('文件拖到这里');
  await upload(page, await fixturePdf('Chinese batch layout', 61));
  await expect(page.getByTestId('utility-page-ranges')).toHaveValue('1-60');
  await page.getByTestId('utility-batch-next').click();
  await expect(page.getByTestId('utility-page-ranges')).toHaveValue('61-61');
  await expect(page.getByTestId('utility-batch-nav')).toContainText('2 / 2');
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
});

test('failed replacement never silently changes the active PDF and editing state is visible', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await upload(page, await fixturePdf('Still current document'));
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('Previous file remains');
  await expect(page.getByTestId('utility-file-summary')).toContainText('fixture.pdf');
  const output = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(output.bytes.toString('utf8')).toContain('Still current document');

  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('first version'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('sample.txt');
  await page.getByTestId('utility-text').fill('edited version');
  await expect(page.getByTestId('text-file-summary')).toContainText('导入后已修改');
});

test('image conversion exposes cancel and a ZIP packaging stage', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Batch example', 6));
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  const download = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect(download.name).toMatch(/\.zip$/);
  await expect(page.getByTestId('utility-progress')).toContainText('Packaging ZIP');
  await expect(page.getByTestId('utility-next-step')).toContainText('files do not transfer automatically');
  await expect(page.getByTestId('utility-next-step').getByRole('link')).toHaveAttribute('href', '/#all-tools');
});

test('page number tool warns that overlay can overlap content', async ({ page }) => {
  await page.goto('/zh/add-page-numbers/');
  await expect(page.getByTestId('page-overlap-warning')).toContainText('可能遮挡页脚');
});

test('cancel stops long text-to-PDF generation without downloading partial output', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('A long line for cancellation testing. '.repeat(7000));
  const downloads = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByRole('alert')).toContainText('Processing cancelled', { timeout: 15000 });
  await expect(page.getByTestId('utility-cancel')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  expect(downloads).toEqual([]);
});

test('dragging multiple PDFs into a single-file converter explains rejection, preserves source', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await upload(page, await fixturePdf('Original document'));
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['first'], 'first.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File(['second'], 'second.pdf', { type: 'application/pdf' }));
    document.querySelector('[data-testid="utility-dropzone"]').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await expect(page.getByRole('alert')).toContainText('one file at a time');
  await expect(page.getByTestId('utility-file-summary')).toContainText('fixture.pdf');
  const output = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(output.bytes.toString('utf8')).toContain('Original document');
});

test('English prose wraps at whole-word boundaries in actual selectable TXT and Markdown PDFs', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const available = 595.28 - 46 * 2 - 4;
  let prefix = 'W';
  // Force a final word that fits alone but cannot fit on the current line.
  while (font.widthOfTextAtSize(`${prefix} Verification`, 11) < available + 8) prefix += 'W';
  expect(font.widthOfTextAtSize(prefix, 11)).toBeLessThan(available);
  for (const inputRoute of ['/txt-to-pdf/', '/markdown-to-pdf/']) {
    await page.goto(inputRoute);
    await page.getByTestId('utility-text').fill(`${prefix} Verification follows`);
    const generated = await generateTextPdfAndDownload(page);
    expect((await PDFDocument.load(generated.bytes)).getPageCount()).toBe(1);
    await page.goto('/pdf-to-txt/');
    await upload(page, generated.bytes);
    const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
    const text = extracted.bytes.toString('utf8');
    expect(text).toContain(prefix);
    expect(text).toContain('Verification follows');
    expect(text).not.toMatch(/Verifi\n|Ver\nification|Verificat\nion/);
  }
});

test('wide-glyph words and code spacing create readable, bounded PDF pages', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  const code = 'abc   def  ghi  tail';
  const longWord = 'W'.repeat(180) + ' FINISH-MARKER';
  await page.getByTestId('utility-text').fill([
    '# Long document wrapping',
    'Prefix ' + longWord,
    '```js',
    code,
    '        const value = 12;  // aligned',
    '```',
  ].join('\n'));
  const generated = await generateTextPdfAndDownload(page, 25000);
  const output = await PDFDocument.load(generated.bytes);
  expect(output.getPageCount()).toBeGreaterThanOrEqual(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click(), 20000);
  const words = extracted.bytes.toString('utf8');
  expect(words).toContain('FINISH-MARKER');
  expect(words).toContain('const value = 12;');
  expect(words).toContain('tail');
});

test('combined Unicode graphemes generate a real, previewable local PDF without dropping text', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  const phrase = 'Cafe\u0301 \u{1f469}\u{1f3fd}\u200d\u{1f4bb} \u{1f1fa}\u{1f1f3}';
  await page.getByTestId('utility-text').fill('# Unicode page\n' + phrase + '\n' + phrase.repeat(20));
  const result = await generateTextPdfAndDownload(page, 30000);
  const doc = await PDFDocument.load(result.bytes);
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  const first = doc.getPage(0);
  const refs = first.node.Resources();
  const resources = refs && doc.context.lookup(refs, PDFDict);
  const images = resources?.get(PDFName.of('XObject'));
  expect(images ? doc.context.lookup(images, PDFDict).keys().length : 0).toBeGreaterThan(0);
});

test('English Markdown quotes, rules and numbered steps produce searchable PDF text', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# Weekly report\n\n> Important notice\n\n---\n\n1. First step\n2) Second step');
  const result = await generateTextPdfAndDownload(page);
  await expect(page.getByRole('status')).toContainText('Output text is selectable');
  await page.goto('/pdf-to-txt/');
  await upload(page, result.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = extracted.bytes.toString('utf8');
  expect(text).toContain('Important notice');
  expect(text).toContain('1. First step');
  expect(text).toContain('2. Second step');
});

test('Markdown links and nested code fences survive real PDF download and text extraction', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill([
    'Read [Docs](https://example.com/a_(b)).',
    'Open [Manual](./guide.md "Read me").',
    '![Diagram](https://example.com/chart.png)',
    '````js',
    '```',
    'const answer = 42;',
    '````',
    'Body after code fence',
  ].join('\n'));
  const generated = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(generated.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const output = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = output.bytes.toString('utf8');
  for (const snippet of [
    'Docs (https://example.com/a_(b))',
    'Manual (./guide.md)',
    'Diagram (https://example.com/chart.png)',
    'const answer = 42;',
    'Body after code fence',
  ]) expect(text).toContain(snippet);
});

test('malformed repeated Markdown links do not freeze browser-side PDF conversion', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  const malformed = '[broken]('.repeat(2000);
  await page.getByTestId('utility-text').fill(malformed + '\n' + '[Valid](https://example.com/ok)');
  const output = await generateTextPdfAndDownload(page, 30000);
  const doc = await PDFDocument.load(output.bytes);
  expect(doc.getPageCount()).toBeGreaterThan(0);
  await page.goto('/pdf-to-txt/');
  await upload(page, output.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click(), 20000);
  expect(extracted.bytes.toString('utf8')).toContain('Valid (https://example.com/ok)');
});

test('unclosed HTML comments do not stall real Markdown-to-PDF and TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  const malformed = '<!--'.repeat(1500);
  await page.getByTestId('utility-text').fill(malformed + '\nAfter comments: **SAFE END**');
  const generated = await generateTextPdfAndDownload(page, 30000);
  const pdf = await PDFDocument.load(generated.bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 20000);
  expect(output.bytes.toString('utf8')).toContain('After comments: SAFE END');
});

test('repeated malformed emphasis never stalls export or drops following text', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('*a '.repeat(2500) + '\nAfter markers: **Safe** and `code*x`');
  const result = await generateTextPdfAndDownload(page, 30000);
  expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(0);
  await page.goto('/pdf-to-txt/');
  await upload(page, result.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click(), 20000);
  expect(extracted.bytes.toString('utf8')).toContain('After markers: Safe and code*x');
});

test('Markdown technical comparisons survive an actual PDF download and TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('Logic: a < 3 && b > 2\nBounds: x <= 40 && y >= 8\n**Safe** <strong>HTML</strong> text');
  const generated = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(generated.bytes)).getPageCount()).toBe(1);

  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = extracted.bytes.toString('utf8');
  expect(text).toContain('a < 3 && b > 2');
  expect(text).toContain('x <= 40 && y >= 8');
  expect(text).toContain('Safe HTML text');
});

test('Markdown technical identifiers and arithmetic survive actual PDF and TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill(
    '# Technical user_id\nIdentifiers: batch_run_2026 and c_d\nMath: a*b + x**2 + 4 * 5\nEmphasis: **bold** and *italic*',
  );
  const created = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(created.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, created.bytes);
  const result = await getDownload(page, () => page.getByTestId('utility-run').click());
  const extracted = result.bytes.toString('utf8');
  expect(extracted).toContain('Technical user_id');
  expect(extracted).toContain('batch_run_2026 and c_d');
  expect(extracted).toContain('a*b + x**2 + 4 * 5');
  expect(extracted).toContain('Emphasis: bold and italic');
});

test('multiple unspaced exponents and underscores survive real Markdown-to-PDF and TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill(
    'Powers: x**2 and y**3; fields: a__2 and b__5\nMultiply: 2*3*4\nStyle: **bold** and *italic*',
  );
  const created = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(created.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, created.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = extracted.bytes.toString('utf8');
  expect(text).toContain('x**2 and y**3');
  expect(text).toContain('a__2 and b__5');
  expect(text).toContain('Multiply: 2*3*4');
  expect(text).toContain('Style: bold and italic');
});

test('technical Markdown generics, placeholders and tight comparisons survive actual PDF-to-TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill(
    '# Types: List<T>\nGeneric: Map<string, number>\nPlaceholder: <username>\nComparison: a<b && c>d\nCode: x<y&&z>q\nHTML: <strong>bold</strong>',
  );
  const generated = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(generated.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, generated.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = extracted.bytes.toString('utf8');
  for (const preserved of ['Types: List<T>', 'Map<string, number>', '<username>', 'a<b && c>d', 'x<y&&z>q', 'HTML: bold']) {
    expect(text).toContain(preserved);
  }
});

test('Markdown inline-code HTML and URL text survive downloaded PDF and TXT round-trip', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill(
    'Tag: `<strong>`\nScript: `<script>alert(1)</script>`\nCode link: `[docs](https://example.com)`\nEmphasis: **bold `x*y`**',
  );
  const created = await generateTextPdfAndDownload(page);
  expect((await PDFDocument.load(created.bytes)).getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, created.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  const text = extracted.bytes.toString('utf8');
  for (const expected of ['Tag: <strong>', 'Script: <script>alert(1)</script>',
    'Code link: [docs](https://example.com)', 'Emphasis: bold x*y']) {
    expect(text).toContain(expected);
  }
});
test('page numbering on rotated cropped PDFs preserves page rotations and searchable digits', async ({ page }) => {
  const { degrees } = await import('pdf-lib');
  const input = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const p = input.addPage([595.28, 841.89]);
    p.setCropBox(21, 37, 510, 700);
    p.setRotation(degrees(angle));
  }
  const original = Buffer.from(await input.save());
  for (const position of ['bottom-center', 'bottom-right', 'top-right']) {
    await page.goto('/add-page-numbers/');
    await upload(page, original);
    await page.getByTestId('number-start').fill('41');
    await page.getByRole('combobox', { name: 'Position' }).selectOption(position);
    const output = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
    const numbered = await PDFDocument.load(output.bytes);
    expect(numbered.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 180, 270]);
    for (const p of numbered.getPages()) {
      expect(p.getCropBox()).toMatchObject({ x: 21, y: 37, width: 510, height: 700 });
    }
    await page.goto('/pdf-to-txt/');
    await upload(page, output.bytes);
    const extracted = await getDownload(page, () => page.getByTestId('utility-run').click(), 15000);
    expect(extracted.bytes.toString('utf8')).toMatch(/\b41\b/);
    expect(extracted.bytes.toString('utf8')).toMatch(/\b44\b/);
  }
});

test('numbering rejects too-small pages and page labels over 99999 in Chinese', async ({ page }) => {
  await page.goto('/zh/add-page-numbers/');
  const tiny = await PDFDocument.create();
  tiny.addPage([50, 50]);
  await upload(page, Buffer.from(await tiny.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('页面尺寸太小');
  const longer = await PDFDocument.create();
  longer.addPage([595, 842]); longer.addPage([595, 842]);
  await upload(page, Buffer.from(await longer.save()));
  await page.getByTestId('number-start').fill('99999');
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('不能超过 99999');
});

test('changing any page numbering setting removes stale finished-result messaging', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf('New page number workflow', 2));
  const run = () => page.getByTestId('utility-run').click();
  await getDownload(page, run);
  await expect(page.getByRole('status')).toContainText('Ready to download');
  await expect(page.getByTestId('utility-next-step')).toBeVisible();

  await page.getByTestId('number-start').fill('41');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('utility-next-step')).toHaveCount(0);

  await getDownload(page, run);
  await expect(page.getByRole('status')).toContainText('Ready to download');
  await page.getByRole('combobox', { name: 'Position' }).selectOption('top-right');
  await expect(page.getByRole('status')).toHaveCount(0);

  await getDownload(page, run);
  await expect(page.getByRole('status')).toContainText('Ready to download');
  await page.getByRole('combobox', { name: 'Font size' }).selectOption('16');
  await expect(page.getByRole('status')).toHaveCount(0);

  const numbered = await getDownload(page, run);
  await page.goto('/pdf-to-txt/');
  await upload(page, numbered.bytes);
  const text = await getDownload(page, run);
  expect(text.bytes.toString('utf8')).toMatch(/\b41\b/);
  expect(text.bytes.toString('utf8')).toMatch(/\b42\b/);
});

test('Chinese compression honestly calls larger raster PDFs an increase, never a saving', async ({ page }) => {
  await page.goto('/zh/compress-pdf/');
  await upload(page, await fixturePdf('Small text report', 1));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-result')).toBeVisible();
  await expect(page.getByTestId('compression-download')).toBeDisabled();
  await expect(page.getByTestId('compression-change-label')).toHaveText('体积增加');
  await expect(page.getByRole('status')).toContainText('提前停止');
  await expect(page.getByTestId('compression-change-value')).not.toContainText('-');
});


test('text conversion retains old PDF for download after edits and only replaces it on successful regeneration', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  const downloads = [];
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.getByTestId('utility-text').fill('First version for preview');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect.poll(() => page.getByTestId('utility-pdf-preview').locator('canvas')
    .evaluate(canvas => canvas.width)).toBeGreaterThan(0);
  expect(downloads).toEqual([]);

  await page.getByTestId('utility-text').fill('Second version with new edits');
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect(page.getByTestId('text-result-stale')).toContainText('previous text');
  const previous = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(previous.bytes)).getPageCount()).toBe(1);
  // The old download does not save the newly edited draft. Native navigation
  // must still warn before this unsaved text is discarded.
  const nativeGuard = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect.poll(nativeGuard).toBe(true);

  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-result-stale')).toHaveCount(0);
  const updated = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  await expect.poll(nativeGuard).toBe(false);
  expect(updated.name).toBe('plainmile-text-plain.pdf');
  expect((await PDFDocument.load(updated.bytes)).getPageCount()).toBe(1);
  expect(Buffer.compare(previous.bytes, updated.bytes)).not.toBe(0);

  // Verify the actual saved bytes rather than only checking a browser label.
  for (const [pdfBytes, expected, excluded] of [
    [previous.bytes, 'First version for preview', 'Second version'],
    [updated.bytes, 'Second version with new edits', 'First version'],
  ]) {
    await page.goto('/pdf-to-txt/');
    await upload(page, pdfBytes);
    const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
    const body = extracted.bytes.toString('utf8');
    expect(body).toContain(expected);
    expect(body).not.toContain(excluded);
  }
});

test('imported TXT filenames are retained; Chinese text PDF offers preview and explicit download', async ({ page }) => {
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'report 2026.txt', mimeType: 'text/plain', buffer: Buffer.from('Simple text preview'),
  });
  const pdf = await generateTextPdfAndDownload(page);
  expect(pdf.name).toBe('report-2026-plain.pdf');
  await expect(page.getByTestId('utility-pdf-preview')).toContainText('第 1 页预览');
});

test('Markdown edits keep the previous PDF, and regenerated PDF contains only the updated text', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# Original document');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-pdf-download')).toBeVisible();
  await page.getByTestId('utility-text').fill('# Changed document');
  await expect(page.getByTestId('text-result-stale')).toContainText('previous text');
  const old = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(old.bytes)).getPageCount()).toBe(1);

  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-result-stale')).toHaveCount(0);
  const result = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  await page.goto('/pdf-to-txt/');
  await upload(page, result.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain('Changed document');
  expect(extracted.bytes.toString('utf8')).not.toContain('Original document');
});

test('Chinese mobile text editing warns about stale generated PDF without losing its download', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Chinese-route original PDF');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await page.getByTestId('utility-text').fill('Chinese-route newer draft');
  await expect(page.getByTestId('text-result-stale')).toContainText('修改前的文字');
  const old = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(old.bytes)).getPageCount()).toBe(1);
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 2);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-result-stale')).toHaveCount(0);
  const newer = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(newer.bytes)).getPageCount()).toBe(1);
  expect(Buffer.compare(old.bytes, newer.bytes)).not.toBe(0);
});

test('follow-up link is honest about file handoff and leads to the full tool catalog', async ({ page }) => {
  for (const [route, catalog, message] of [
    ['/txt-to-pdf/', '/#all-tools', 'files do not transfer automatically'],
    ['/zh/txt-to-pdf/', '/zh/#all-tools', '文件不会自动带入'],
  ]) {
    await page.goto(route);
    await page.getByTestId('utility-text').fill('Hello, this is a synthetic test.');
    await page.getByTestId('utility-run').click();
    const action = page.getByTestId('utility-next-step').getByRole('link');
    await expect(action).toContainText(message);
    await expect(action).toHaveAttribute('href', catalog);
  }
});


test('large page numbering can be cancelled from the browser without a partial download', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf('Long numbered report', 700));
  const downloads = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByRole('alert')).toContainText(/cancelled/i, { timeout: 30000 });
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  expect(downloads).toHaveLength(0);
});


test('invalid replacement keeps previously generated undownloaded text PDF', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'kept.txt', mimeType: 'text/plain', buffer: Buffer.from('Original saved draft'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('kept.txt');
  const downloads = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  expect(downloads).toHaveLength(0);

  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not text'),
  });
  await expect(page.getByRole('alert')).toContainText('Previous file remains: kept.txt');
  await expect(page.getByTestId('text-file-summary')).toContainText('kept.txt');
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect(page.getByTestId('utility-pdf-download')).toBeEnabled();
  expect(downloads).toHaveLength(0);
  const result = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(result.name).toBe('kept-plain.pdf');

  // An invalid replacement also must not erase an already-extracted preview.
  await page.goto('/pdf-to-txt/');
  await upload(page, await fixturePdf('Retained extracted text', 1));
  await getDownload(page, () => page.getByTestId('utility-run').click());
  await expect(page.getByRole('textbox', { name: 'Extracted text preview' })).toHaveValue(/Retained extracted text/);
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('corrupt pdf'),
  });
  await expect(page.getByRole('alert')).toContainText('Previous file remains: fixture.pdf');
  await expect(page.getByRole('textbox', { name: 'Extracted text preview' })).toHaveValue(/Retained extracted text/);
});

test('two same-tick file drops cannot replace an in-flight converter input', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await expect(page.getByTestId('utility-dropzone')).toBeVisible();
  const first = (await fixturePdf('First document', 1)).toString('base64');
  const second = (await fixturePdf('Second document', 2)).toString('base64');
  await page.evaluate(({first, second}) => {
    const dropzone = document.querySelector('[data-testid="utility-dropzone"]');
    for (const [name, base64] of [['first.pdf', first], ['second.pdf', second]]) {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: 'application/pdf' }));
      dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, { first, second });
  await expect(page.getByTestId('utility-file-summary')).toContainText('first.pdf', { timeout: 30000 });
  await expect(page.getByTestId('utility-file-summary')).toContainText('1 page');
  const result = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
  expect(result.name).toMatch(/first-page-001\.jpg$/);
  expect(Array.from(result.bytes.slice(0, 3))).toEqual([255, 216, 255]);
});

test('two same-turn converter Run clicks produce one real PDF download', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf('One job', 320));
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.evaluate(() => {
    const run = document.querySelector('[data-testid="utility-run"]');
    for (let n = 0; n < 2; n++) run.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  // Wait for the single result; short browser timing must not make a
  // successful fast conversion fail merely because the busy state was brief.
  await expect(page.getByRole('status')).toContainText('Ready', { timeout: 70000 });
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  await expect.poll(() => downloads.length, { timeout: 10000 }).toBe(1);
  const file = downloads[0];
  expect(file.suggestedFilename()).toBe('fixture-numbered.pdf');
  const numbered = await PDFDocument.load(await readFile(await file.path()));
  expect(numbered.getPageCount()).toBe(320);
});

test('PDF to image parameters cannot change during active conversion', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf('Image batch controls', 45));
  await page.getByTestId('utility-page-ranges').fill('1-40');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-cancel')).toBeVisible();
  await expect(page.getByTestId('utility-page-ranges')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Image format' })).toBeDisabled();
  for (const control of await page.locator('.utility-options select').all()) await expect(control).toBeDisabled();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByTestId('utility-run')).toBeEnabled({ timeout: 40000 });
});

test('mixed selectable text and genuine scanned-image page warns about omitted text in TXT and Markdown', async ({ page }) => {
  const encodedScan = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 120);
    ctx.fillStyle = 'black'; ctx.font = '28px serif';
    ctx.fillText('SCANNED IMAGE ONLY', 14, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([500, 700]).drawText('Searchable cover', { x: 24, y: 610, font, size: 14 });
  const scan = await doc.embedPng(Buffer.from(encodedScan, 'base64'));
  doc.addPage([500, 700]).drawImage(scan, { x: 20, y: 300, width: 460, height: 170 });
  doc.addPage([500, 700]).drawText('Searchable ending', { x: 24, y: 610, font, size: 14 });
  const bytes = Buffer.from(await doc.save());
  for (const [route, hint, ext] of [
    ['/pdf-to-txt/', '1 of 3 pages', 'txt'],
    ['/zh/pdf-to-markdown/', '共 3 页中有 1 页', 'md'],
  ]) {
    await page.goto(route);
    await upload(page, bytes);
    const downloads = [];
    const onDownload = item => downloads.push(item.suggestedFilename());
    page.on('download', onDownload);
    await page.getByTestId('utility-run').click();
    await expect(page.getByTestId('partial-text-result')).toBeVisible({ timeout: 30000 });
    expect(downloads).toEqual([]);
    const result = await getDownload(page, () => page.getByTestId('partial-text-download').click(), 30000);
    page.off('download', onDownload);
    expect(result.name).toMatch(new RegExp('\\.' + ext + '$'));
    const text = result.bytes.toString('utf8');
    expect(text).toContain('Searchable cover');
    expect(text).toContain('Searchable ending');
    expect(text).not.toContain('SCANNED IMAGE ONLY');
    const warning = page.getByTestId('text-extraction-warning');
    await expect(warning).toContainText(hint);
    await expect(warning).toContainText('2');
  }
});

test('incomplete text result allows repeat downloads without reprocessing', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]).drawText('Partial source report', { x: 25, y: 500 });
  doc.addPage([400, 600]);
  await page.goto('/pdf-to-txt/');
  await upload(page, Buffer.from(await doc.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('partial-text-result')).toBeVisible();
  const first = await getDownload(page, () => page.getByTestId('partial-text-download').click());
  expect(first.bytes.toString('utf8')).toContain('Partial source report');
  await expect(page.getByTestId('partial-text-download')).toBeEnabled();
  const second = await getDownload(page, () => page.getByTestId('partial-text-download').click());
  expect(second.bytes.equals(first.bytes)).toBe(true);
});

test('fully searchable PDF text does not show an incomplete-extraction warning', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  await upload(page, await fixturePdf('Everything searchable', 3));
  const output = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(output.bytes.toString('utf8')).toContain('Everything searchable 3');
  await expect(page.getByTestId('text-extraction-warning')).toHaveCount(0);
});

test('Clear protects an undownloaded generated TXT PDF but not an already downloaded output', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Original draft to keep'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('draft.txt');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  const clear = page.getByTestId('text-file-summary').getByRole('button', { name: 'Clear' });
  await clear.click();
  await expect(page.getByTestId('utility-clear-confirm')).toContainText('not been safely saved');
  await page.getByTestId('utility-clear-keep').click();
  await expect(page.getByTestId('utility-clear-confirm')).toHaveCount(0);
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect(page.getByTestId('utility-text')).toHaveValue('Original draft to keep');
  const result = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  await clear.click();
  await expect(page.getByTestId('utility-clear-confirm')).toHaveCount(0);
  await expect(page.getByTestId('utility-text')).toHaveValue('');
  await expect(page.getByTestId('utility-run')).toBeDisabled();
});

test('Chinese typed-only unsaved draft can be cleared only after explicit confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# 重要草稿\n待保存的内容');
  await page.getByTestId('utility-text-clear').click();
  await expect(page.getByTestId('utility-clear-confirm')).toContainText('尚未妥善保存');
  await page.getByTestId('utility-clear-keep').click();
  await expect(page.getByTestId('utility-text')).toHaveValue(/待保存的内容/);
  await page.getByTestId('utility-text-clear').click();
  await page.getByTestId('utility-clear-confirm-button').click();
  await expect(page.getByTestId('utility-text')).toHaveValue('');
  await expect(page.getByTestId('utility-run')).toBeDisabled();
  const box = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(box.scroll).toBeLessThanOrEqual(box.viewport + 2);
});


test('Chinese text-to-PDF replacement protects edited text and an undownloaded real PDF preview', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'original.txt', mimeType: 'text/plain', buffer: Buffer.from('Original editable report'),
  });
  await expect(page.getByTestId('text-file-summary')).toContainText('original.txt');
  await page.getByTestId('utility-text').fill('Edited important report 2026');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 15000 });

  const replacement = { name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Different replacement text') };
  await page.getByTestId('utility-file-input').setInputFiles(replacement);
  await expect(page.getByTestId('utility-replace-confirm')).toContainText('replacement.txt');
  await expect(page.getByTestId('utility-replace-confirm')).toContainText('尚未下载');
  await expect(page.getByTestId('text-file-summary')).toContainText('original.txt');
  await expect(page.getByTestId('utility-text')).toHaveValue('Edited important report 2026');
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect(page.getByTestId('utility-file-input')).toBeDisabled();
  await expect(page.getByTestId('utility-run')).toBeDisabled();

  await page.getByTestId('utility-replace-keep').click();
  await expect(page.getByTestId('utility-replace-confirm')).toHaveCount(0);
  await expect(page.getByTestId('utility-text')).toHaveValue('Edited important report 2026');
  const oldPdf = await getDownload(page, () => page.getByTestId('utility-pdf-download').click());
  expect((await PDFDocument.load(oldPdf.bytes)).getPageCount()).toBe(1);

  // The user still edited the imported text, even after downloading a PDF.
  // A second replacement must not discard this draft without consent.
  await page.getByTestId('utility-file-input').setInputFiles(replacement);
  await expect(page.getByTestId('utility-replace-confirm')).toBeVisible();
  await page.getByTestId('utility-replace-accept').click();
  await expect(page.getByTestId('text-file-summary')).toContainText('replacement.txt');
  await expect(page.getByTestId('utility-text')).toHaveValue('Different replacement text');
  await expect(page.getByTestId('text-pdf-result')).toHaveCount(0);
  await expect(page.getByTestId('utility-replace-confirm')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
});

test('unsaved compressed PDF survives accidental replacement drop, but a downloaded result does not add friction', async ({ page }) => {
  test.setTimeout(65000);
  await page.goto('/compress-pdf/');
  const rawPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 620; canvas.height = 620;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(620, 620);
    let n = 1234567;
    for (let k = 0; k < image.data.length; k += 4) {
      n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
      image.data[k] = n & 255; image.data[k + 1] = (n >>> 8) & 255;
      image.data[k + 2] = (n >>> 16) & 255; image.data[k + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const source = await PDFDocument.create();
  const image = await source.embedPng(Buffer.from(rawPng, 'base64'));
  source.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  const input = Buffer.from(await source.save());
  await upload(page, input);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled({ timeout: 30000 });

  const nextPdf = (await fixturePdf('Next PDF', 2)).toString('base64');
  async function dropNewPdf() {
    await page.evaluate(base64 => {
      const data = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], 'replacement.pdf', { type: 'application/pdf' }));
      document.querySelector('[data-testid="utility-dropzone"]').dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, nextPdf);
  }
  await dropNewPdf();
  await expect(page.getByTestId('utility-replace-confirm')).toContainText('replacement.pdf');
  await expect(page.getByTestId('utility-file-summary')).toContainText('fixture.pdf');
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  await page.getByTestId('utility-replace-keep').click();
  const old = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect((await PDFDocument.load(old.bytes)).getPageCount()).toBe(1);
  expect(old.bytes.length).toBeLessThan(input.length);

  await dropNewPdf();
  await expect(page.getByTestId('utility-replace-confirm')).toHaveCount(0);
  await expect(page.getByTestId('utility-file-summary')).toContainText('replacement.pdf');
  await expect(page.getByTestId('compression-result')).toHaveCount(0);
  await expect(page.getByTestId('utility-run')).toBeEnabled();
});
