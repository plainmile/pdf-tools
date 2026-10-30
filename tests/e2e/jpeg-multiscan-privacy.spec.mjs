import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

// Synthetic 8x8 RGB progressive JPEG, 10 SOS scans, generated locally.
// No user files, external requests, EXIF or brand assets in the base fixture.
const PROGRESSIVE_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAVAQEBAAAAAAAAAAAAAAAAAAABA//aAAwDAQACEAMQAAABjFH/xAAWEAADAAAAAAAAAAAAAAAAAAAABAX/2gAIAQEAAQUCTmn/xAAaEQAABwAAAAAAAAAAAAAAAAAAAQMEBRMh/9oACAEDAQE/AY9+tSWj/8QAGBEAAgMAAAAAAAAAAAAAAAAAAAECAxH/2gAIAQIBAT8Brk8P/8QAFhAAAwAAAAAAAAAAAAAAAAAAAAEh/9oACAEBAAY/AlD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IU//2gAMAwEAAgADAAAAEA//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EFn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EA//xAAVEAEBAAAAAAAAAAAAAAAAAAAA8f/aAAgBAQABPxCY/9k=';
const SECRET = 'SYNTHETIC_GPS_PRIVATE_MARKER_7319';

function app1(value) {
  const payload = Buffer.from(value, 'ascii');
  const total = payload.length + 2;
  return Buffer.from([0xff, 0xe1, total >>> 8, total & 0xff, ...payload]);
}

function progressiveWithLatePrivateMetadata() {
  const source = Buffer.from(PROGRESSIVE_JPEG_BASE64, 'base64');
  const first = source.indexOf(Buffer.from([0xff, 0xda]));
  const second = source.indexOf(Buffer.from([0xff, 0xda]), first + 2);
  if (first < 0 || second <= first) throw new Error('Invalid test fixture: not a multi-scan JPEG.');
  // APP1 between scans is legal JPEG structure. The old stripper stopped
  // at the first SOS and copied this private marker into the PDF verbatim.
  return Buffer.concat([source.subarray(0, second), app1(SECRET), source.subarray(second)]);
}

async function embeddedJpegs(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(1);
  const page = pdf.getPage(0);
  const resources = pdf.context.lookup(page.node.Resources(), PDFDict);
  const xobjects = pdf.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
  const images = xobjects.keys().map(key => pdf.context.lookup(xobjects.get(key)))
    .filter(stream => stream?.dict?.get(PDFName.of('Filter'))?.toString().includes('DCTDecode'));
  expect(images).toHaveLength(1);
  return images.map(image => ({
    data: Buffer.from(image.getContents()),
    width: image.dict.get(PDFName.of('Width')).asNumber(),
    height: image.dict.get(PDFName.of('Height')).asNumber(),
  }));
}

test('progressive JPG imported on Chinese mobile strips late private metadata, including after paper reflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'progressive.jpg', mimeType: 'image/jpeg',
    buffer: progressiveWithLatePrivateMetadata(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  for (const paper of ['a4', 'letter']) {
    if (paper === 'letter') {
      await page.getByTestId('image-paper').selectOption('letter');
      await page.getByTestId('image-layout-apply').click();
      await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
    }
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 PDF' }).click();
    const bytes = await readFile(await (await downloadEvent).path());
    const images = await embeddedJpegs(bytes);
    expect(images[0].width).toBe(8);
    expect(images[0].height).toBe(8);
    expect(images[0].data.includes(Buffer.from(SECRET))).toBe(false);
    expect(images[0].data.includes(Buffer.from([0xff, 0xda]))).toBe(true);
    expect((await PDFDocument.load(bytes)).getPage(0).getWidth()).toBe(
      paper === 'letter' ? 612 : 595.28,
    );
  }
});
