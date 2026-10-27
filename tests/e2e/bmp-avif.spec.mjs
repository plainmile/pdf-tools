import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

// Locally generated, 9x7 RGB red/green static AVIF fixture (no network).
// Encoded with libavif; PDF export must actually contain the decoded pixels.
const AVIF_BASE64 = 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAANQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAACQAAAAcAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAPW1kYXQSAAoIGAyjNEBDQaEyJxTHh4ZlAgggnlVAAADLqtUprV8YScAKQg6O4/UNdK4pmP7BYE7WQA==';

function makeBmp(width = 4, height = 3) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = 54 + y * stride + x * 3;
    bytes[at] = 15; bytes[at + 1] = y * 20; bytes[at + 2] = x * 50;
  }
  return bytes;
}
async function downloadPdf(page, name = 'Export PDF') {
  const request = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const download = await request;
  return PDFDocument.load(await readFile(await download.path()));
}
function imageSize(pdf, pageIndex) {
  const page = pdf.getPage(pageIndex);
  const resourceRef = page.node.Resources();
  const resources = pdf.context.lookup(resourceRef, PDFDict);
  const objects = pdf.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  const images = objects.keys().map(key => pdf.context.lookup(objects.get(key)));
  return images.filter(x => x.dict).map(x => {
    const w = x.dict.get(PDFName.of('Width'));
    const h = x.dict.get(PDFName.of('Height'));
    return { width: w.asNumber(), height: h.asNumber() };
  });
}

test('real BMP and genuine static AVIF combine in PDF, preserve raster pixels and survive paper reflow', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'red-blue.bmp', mimeType: 'image/bmp', buffer: makeBmp() },
    { name: 'small-still.avif', mimeType: 'image/avif', buffer: Buffer.from(AVIF_BASE64, 'base64') },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('2');
  const a4 = await downloadPdf(page);
  expect(a4.getPageCount()).toBe(2);
  expect(a4.getPages().map(p => Math.round(p.getWidth()))).toEqual([595, 595]);
  expect(imageSize(a4, 0)).toEqual(expect.arrayContaining([{ width: 4, height: 3 }]));
  expect(imageSize(a4, 1)).toEqual(expect.arrayContaining([{ width: 9, height: 7 }]));

  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-orientation').selectOption('landscape');
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const letter = await downloadPdf(page);
  expect(letter.getPages().map(p => p.getSize())).toEqual([
    { width: 792, height: 612 }, { width: 792, height: 612 },
  ]);
  expect(imageSize(letter, 0)).toEqual(expect.arrayContaining([{ width: 4, height: 3 }]));
  expect(imageSize(letter, 1)).toEqual(expect.arrayContaining([{ width: 9, height: 7 }]));
});

test('Chinese mobile interface safely imports BMP and still AVIF', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/image-to-pdf/');
  await expect(page.locator('.drop-limits')).toContainText('静态 AVIF');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'bitmap.bmp', mimeType: 'image/x-ms-bmp', buffer: makeBmp() },
    { name: 'modern.avif', mimeType: 'image/avif', buffer: Buffer.from(AVIF_BASE64, 'base64') },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const pdf = await downloadPdf(page, '导出 PDF');
  expect(pdf.getPageCount()).toBe(2);
  expect(imageSize(pdf, 0)).toEqual(expect.arrayContaining([{ width: 4, height: 3 }]));
  expect(imageSize(pdf, 1)).toEqual(expect.arrayContaining([{ width: 9, height: 7 }]));
});

test('malformed BMP and spoofed AVIF do not delete an already loaded PDF', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'valid.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles({
    name: 'fake.avif', mimeType: 'image/avif', buffer: Buffer.from('not an AVIF'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles({
    name: 'bad.bmp', mimeType: 'image/bmp', buffer: Buffer.from('not a BMP'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page);
  expect(output.getPageCount()).toBe(1);
});

test('failed BMP canvas encoding frees backing pixels, keeps original PDF, and permits retry', async ({ page }) => {
  await page.addInitScript(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    window.__failNextBmpEncoding = false;
    window.__failedBmpCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, format, quality) {
      if (window.__failNextBmpEncoding && this.width === 4 && this.height === 3 &&
          format === 'image/png') {
        window.__failNextBmpEncoding = false;
        window.__failedBmpCanvas = this;
        queueMicrotask(() => callback(null));
        return;
      }
      return originalToBlob.call(this, callback, format, quality);
    };
  });
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'original.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.evaluate(() => { window.__failNextBmpEncoding = true; });
  await page.getByTestId('file-input').setInputFiles({
    name: 'failed-encode.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByRole('alert')).toContainText('image could not be converted to PDF');
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  expect(await page.evaluate(() => ({
    intercepted: Boolean(window.__failedBmpCanvas),
    width: window.__failedBmpCanvas?.width,
    height: window.__failedBmpCanvas?.height,
  }))).toEqual({ intercepted: true, width: 1, height: 1 });

  // The first valid document can still be exported after an encoding error.
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(1);
  expect(imageSize(pdf, 0)).toContainEqual({ width: 4, height: 3 });

  await page.getByTestId('file-input').setInputFiles({
    name: 'retry.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const recovered = await downloadPdf(page);
  expect(recovered.getPageCount()).toBe(2);
});

test('stalled BMP encoder can be cancelled without losing existing PDF pages or retry ability', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__stallNextPhotoImport = false;
    window.__stalledPhotoCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, mime, quality) {
      if (window.__stallNextPhotoImport && mime === 'image/png' &&
          this.width === 4 && this.height === 3) {
        window.__stallNextPhotoImport = false;
        window.__stalledPhotoCanvas = this;
        return; // Browser PNG encoder never invokes the callback.
      }
      return original.call(this, callback, mime, quality);
    };
  });
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'keep-this.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.evaluate(() => { window.__stallNextPhotoImport = true; });
  await page.getByTestId('file-input').setInputFiles({
    name: 'stalled-import.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__stalledPhotoCanvas))).toBe(true);
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.getByTestId('workspace-import-cancel').click();
  await expect(page.getByTestId('workspace-import-progress')).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  expect(await page.evaluate(() => ({
    width: window.__stalledPhotoCanvas?.width,
    height: window.__stalledPhotoCanvas?.height,
  }))).toEqual({ width: 1, height: 1 });

  await page.getByTestId('file-input').setInputFiles({
    name: 'successful-retry.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const exported = await downloadPdf(page);
  expect(exported.getPageCount()).toBe(2);
  expect(imageSize(exported, 0)).toContainEqual({ width: 4, height: 3 });
  expect(imageSize(exported, 1)).toContainEqual({ width: 4, height: 3 });
});

test('cancel a stalled BMP decoder, release its late bitmap and retry without losing pages', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeDecode = window.createImageBitmap;
    window.__holdBmpDecode = false;
    window.__decodedButHeld = null;
    window.__resolveHeldBitmap = null;
    window.createImageBitmap = async function (...args) {
      const bitmap = await nativeDecode.apply(this, args);
      if (window.__holdBmpDecode && args[0] instanceof Blob && args[0].type === 'image/bmp') {
        window.__holdBmpDecode = false;
        window.__decodedButHeld = bitmap;
        return new Promise(resolve => { window.__resolveHeldBitmap = () => resolve(bitmap); });
      }
      return bitmap;
    };
  });
  await page.goto('/image-to-pdf/');
  const original = await PDFDocument.create();
  original.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'original.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from(await original.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.evaluate(() => { window.__holdBmpDecode = true; });
  await page.getByTestId('file-input').setInputFiles({
    name: 'decode-stalled.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__resolveHeldBitmap))).toBe(true);
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.getByTestId('workspace-import-cancel').click();
  await expect(page.getByTestId('workspace-import-progress')).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  // Even though the aborted async operation has returned to the UI, the
  // browser may resolve the old decoder later. That late bitmap must close.
  await page.evaluate(() => window.__resolveHeldBitmap());
  await expect.poll(() => page.evaluate(() => window.__decodedButHeld?.width)).toBe(0);

  await page.getByTestId('file-input').setInputFiles({
    name: 'decode-retry.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const exported = await downloadPdf(page);
  expect(exported.getPageCount()).toBe(2);
  expect(imageSize(exported, 1)).toContainEqual({ width: 4, height: 3 });
});

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}
function animatedPngFixture() {
  // A genuine two-frame 1x1 APNG: acTL, fcTL, original IDAT, fcTL, fdAT.
  const still = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9kAAAAASUVORK5CYII=', 'base64');
  const idatOffset = 33;
  const idatSize = still.readUInt32BE(idatOffset);
  const idatEnd = idatOffset + 12 + idatSize;
  const idatData = still.subarray(idatOffset + 8, idatOffset + 8 + idatSize);
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const frame = sequence => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(1, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  };
  const nextFrame = Buffer.alloc(4 + idatData.length);
  nextFrame.writeUInt32BE(2, 0);
  idatData.copy(nextFrame, 4);
  return Buffer.concat([
    still.subarray(0, idatOffset), pngChunk('acTL', animation), frame(0),
    still.subarray(idatOffset, idatEnd), frame(1), pngChunk('fdAT', nextFrame),
    still.subarray(idatEnd),
  ]);
}

test('animated PNG is rejected in Chinese and leaves the previously imported page exportable', async ({ page }) => {
  await page.goto('/zh/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'stable.bmp', mimeType: 'image/bmp', buffer: makeBmp(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles({
    name: 'animated.png', mimeType: 'image/png', buffer: animatedPngFixture(),
  });
  await expect(page.getByRole('alert')).toContainText('不支持动态 PNG');
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, '导出 PDF');
  expect(output.getPageCount()).toBe(1);
  expect(imageSize(output, 0)).toEqual(expect.arrayContaining([{ width: 4, height: 3 }]));
});

test('animated AVIF and WebP reject instead of silently exporting only the first frame', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const animation = Buffer.from(AVIF_BASE64, 'base64');
  animation.write('avis', 8);
  await page.getByTestId('file-input').setInputFiles({
    name: 'animated.avif', mimeType: 'image/avif', buffer: animation,
  });
  await expect(page.getByRole('alert')).toContainText('Animated AVIF is not supported');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);

  const webp = Buffer.alloc(30);
  webp.write('RIFF'); webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUInt32LE(10, 16);
  webp[20] = 0x02;
  await page.getByTestId('file-input').setInputFiles({
    name: 'animated.webp', mimeType: 'image/webp', buffer: webp,
  });
  await expect(page.getByRole('alert')).toContainText('Animated WebP is not supported');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});
