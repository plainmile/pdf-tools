import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTypeFor, isSupportedFile, compressedImageDimensions, composePdf, temporaryWorkspaceId, createBlankPageSource } from '../../src/lib/pdfEngine.mjs';
import { PDFDocument, degrees } from 'pdf-lib';

test('recognize JPEG/PNG/WebP images even with missing or generic MIME types', () => {
  for (const [name, type] of [['photo.JPG', 'image/jpeg'], ['figure.png', 'image/png'], ['cover.WebP', 'image/webp']]) {
    assert.equal(imageTypeFor({ name, type: '' }), type);
    assert.equal(imageTypeFor({ name, type: 'application/octet-stream' }), type);
    assert.equal(isSupportedFile({ name, type: '' }), true);
  }
  assert.equal(imageTypeFor({ name: 'sample.pdf', type: 'application/pdf' }), null);
  assert.equal(isSupportedFile({ name: 'sample.pdf', type: 'application/pdf' }), true);
  assert.equal(isSupportedFile({ name: 'other.dat', type: '' }), false);
});

test('reject massive PNG before decoding image memory', () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.set([73, 72, 68, 82], 12);
  const view = new DataView(header.buffer);
  view.setUint32(16, 18000);
  view.setUint32(20, 18000);
  const dims = compressedImageDimensions('image/png', header);
  assert.deepEqual(dims, { width: 18000, height: 18000 });
  assert.equal(dims.width * dims.height > 36_000_000, true);
  assert.throws(() => compressedImageDimensions('image/png', new Uint8Array([1,2,3])), /Invalid image header/);
});

test('JPEG progressive and baseline dimensions can be read from SOF markers', () => {
  for (const marker of [0xc0, 0xc2]) {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, marker, 0, 8, 8, 0, 12, 0, 22, 1, 0xff, 0xd9]);
    assert.deepEqual(compressedImageDimensions('image/jpeg', jpeg), { height: 12, width: 22 });
  }
  assert.throws(() => compressedImageDimensions('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff])), /Invalid image header/);
});


function riffWebp(...chunks) {
  const length = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length + (chunk.data.length & 1), 0);
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0); // RIFF
  view.setUint32(4, length - 8, true);
  bytes.set([87, 69, 66, 80], 8); // WEBP
  let offset = 12;
  for (const { tag, data } of chunks) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = tag.charCodeAt(i);
    view.setUint32(offset + 4, data.length, true);
    bytes.set(data, offset + 8);
    offset += 8 + data.length + (data.length & 1);
  }
  return bytes;
}

test('WebP VP8X, VP8L and VP8 headers are bounded before browser image decoding', () => {
  const vp8x = new Uint8Array(10);
  const wide = 10000 - 1, tall = 8500 - 1;
  vp8x.set([wide & 255, (wide >>> 8) & 255, wide >>> 16], 4);
  vp8x.set([tall & 255, (tall >>> 8) & 255, tall >>> 16], 7);
  const extension = riffWebp({ tag: 'VP8X', data: vp8x });
  assert.deepEqual(compressedImageDimensions('image/webp', extension), { width: 10000, height: 8500 });

  const bits = ((899 << 14) | 999) >>> 0;
  const vp8l = new Uint8Array(5);
  vp8l[0] = 0x2f;
  new DataView(vp8l.buffer).setUint32(1, bits, true);
  assert.deepEqual(compressedImageDimensions('image/webp',
    riffWebp({ tag: 'VP8L', data: vp8l })), { width: 1000, height: 900 });

  const vp8 = Uint8Array.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0]);
  assert.deepEqual(compressedImageDimensions('image/webp',
    riffWebp({ tag: 'VP8 ', data: vp8 })), { width: 320, height: 240 });
  assert.deepEqual(compressedImageDimensions('image/webp',
    riffWebp({ tag: 'ICCP', data: Uint8Array.from([1, 2, 3]) }, { tag: 'VP8X', data: vp8x })),
    { width: 10000, height: 8500 });
});

test('WebP preflight refuses malformed, truncated or unsized RIFF headers', () => {
  const valid = riffWebp({ tag: 'VP8X', data: new Uint8Array(10) });
  for (const item of [
    new Uint8Array([1, 2, 3]),
    valid.slice(0, valid.length - 1),
    riffWebp({ tag: 'ZZZZ', data: Uint8Array.from([1, 2]) }),
    riffWebp({ tag: 'VP8L', data: Uint8Array.from([0, 0, 0, 0, 0]) }),
    riffWebp({ tag: 'VP8 ', data: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }),
  ]) {
    assert.throws(() => compressedImageDimensions('image/webp', item), /Invalid image header/);
  }
  const spoof = new Uint8Array(valid);
  new DataView(spoof.buffer).setUint32(16, 0xfffffffe, true);
  assert.throws(() => compressedImageDimensions('image/webp', spoof), /Invalid image header/);
});

test('long PDF export reports real pages and rejects cancellation without returning partial PDF', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 500]);
  const source = { id: 'original', bytes: new Uint8Array(await doc.save()) };
  const pages = Array.from({ length: 12 }, (_, index) =>
    ({ id: String(index), sourceId: 'original', pageIndex: 0, rotation: 0 }));
  const abort = new AbortController();
  const progress = [];
  await assert.rejects(
    composePdf([source], pages, {
      signal: abort.signal,
      cancelMessage: 'PDF export cancelled.',
      onProgress: (done, total) => {
        progress.push([done, total]);
        if (done === 1) abort.abort();
      },
    }),
    /PDF export cancelled/,
  );
  assert.deepEqual(progress, [[1, 12]]);
  const good = await composePdf([source], pages, {
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal((await PDFDocument.load(good)).getPageCount(), 12);
  assert.deepEqual(progress.at(-1), [12, 12]);
});

test('temporary workspace IDs work on HTTP LAN origins without crypto.randomUUID', () => {
  let called = 0;
  const api = {
    getRandomValues(bytes) {
      called++;
      for (let index = 0; index < bytes.length; index++) bytes[index] = (called * 31 + index) & 0xff;
      return bytes;
    },
  };
  const a = temporaryWorkspaceId(api);
  const b = temporaryWorkspaceId(api);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(temporaryWorkspaceId({ randomUUID: () => 'original-api' }), 'original-api');
  assert.throws(() => temporaryWorkspaceId({}), /generate unique page identifiers/);
});

test('page copying must not silently brand or inherit confidential PDF document metadata', async () => {
  const original = await PDFDocument.create();
  original.setTitle('PRIVATE REPORT - INTERNAL');
  original.setCreator('Sensitive source application');
  original.addPage([320, 420]);
  const input = new Uint8Array(await original.save());
  const output = await composePdf([
    { id: 'source', bytes: input },
  ], [{ id: 'page', sourceId: 'source', pageIndex: 0, rotation: 0 }]);
  const generated = await PDFDocument.load(output, { updateMetadata: false });
  assert.equal(generated.getPageCount(), 1);
  assert.equal(generated.getTitle(), undefined);
  assert.equal(generated.getCreator(), undefined);
  assert.equal(generated.getProducer(), undefined);
  const fileBytes = Buffer.from(output).toString('latin1');
  assert.ok(!fileBytes.includes('PlainMile PDF'), 'No hidden project brand in exported document');
});

test('generated blank page follows visible page size/rotation but contains none of the original content or metadata', async () => {
  const original = await PDFDocument.create();
  original.setTitle('CONFIDENTIAL ORIGINAL');
  const page = original.addPage([300, 420]);
  page.setRotation(degrees(90));
  page.drawRectangle({ x: 15, y: 20, width: 100, height: 80 });
  const source = { id: 'src', bytes: new Uint8Array(await original.save()), inputSize: 1200 };
  const blankSource = await createBlankPageSource(source, { sourceId: 'src', pageIndex: 0, rotation: 0 });
  const blank = await PDFDocument.load(blankSource.bytes, { updateMetadata: false });
  assert.equal(blankSource.isGeneratedBlank, true);
  assert.equal(blankSource.isImage, false);
  assert.equal(blank.getPageCount(), 1);
  assert.deepEqual(blank.getPage(0).getSize(), { width: 420, height: 300 });
  assert.equal(blank.getPage(0).getRotation().angle, 0);
  assert.equal(blank.getTitle(), undefined);
  assert.ok(!Buffer.from(blankSource.bytes).includes(Buffer.from('CONFIDENTIAL ORIGINAL')));

  const turned = await createBlankPageSource(source, { sourceId: 'src', pageIndex: 0, rotation: 90 });
  const straight = await PDFDocument.load(turned.bytes);
  assert.deepEqual(straight.getPage(0).getSize(), { width: 300, height: 420 });
  await assert.rejects(createBlankPageSource(source, { sourceId: 'src', pageIndex: 3 }), /no longer exists/);
});
