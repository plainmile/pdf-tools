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
    const result = await getDownload(page, () => page.getByTestId('utility-run').click(), 30000);
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
