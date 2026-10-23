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
  await expect(page.getByText('静态 AVIF')).toBeVisible();
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
