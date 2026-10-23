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
  await page.getByTestId('compression-preview-action').click();
  await expect(page.getByTestId('compression-preview')).toBeVisible();
  await expect.poll(() => page.getByTestId('compression-preview').locator('canvas').evaluate(canvas => canvas.width), { timeout: 15000 }).toBeGreaterThan(0);
  await page.getByTestId('compression-preview-action').click();
  await expect(page.getByTestId('compression-preview')).toHaveCount(0);
  await expect(page.getByTestId('compression-change-value')).not.toContainText('-');
  const compressed = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect(compressed.bytes.byteLength).toBeLessThan(input.byteLength);
  expect((await PDFDocument.load(compressed.bytes)).getPageCount()).toBe(1);
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
  await expect(page.getByTestId('utility-next-step')).toContainText('Continue with another PDF tool');
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


test('text conversion previews PDF before download, clears stale preview on edits', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  const downloads = [];
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.getByTestId('utility-text').fill('First version for preview');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible();
  await expect.poll(() => page.getByTestId('utility-pdf-preview').locator('canvas')
    .evaluate(canvas => canvas.width)).toBeGreaterThan(0);
  expect(downloads).toEqual([]);
  await page.getByTestId('utility-text').fill('Second version');
  await expect(page.getByTestId('text-pdf-result')).toHaveCount(0);
  const updated = await generateTextPdfAndDownload(page);
  expect(updated.name).toBe('plainmile-text-plain.pdf');
  const generated = await PDFDocument.load(updated.bytes);
  expect(generated.getPageCount()).toBe(1);
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

test('changing Markdown after rendering invalidates the old PDF and download', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# Original document');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('utility-pdf-download')).toBeVisible();
  await page.getByTestId('utility-text').fill('# Changed document');
  await expect(page.getByTestId('utility-pdf-download')).toHaveCount(0);
  const result = await generateTextPdfAndDownload(page);
  await page.goto('/pdf-to-txt/');
  await upload(page, result.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain('Changed document');
});
