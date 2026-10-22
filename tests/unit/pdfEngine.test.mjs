import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTypeFor, isSupportedFile, compressedImageDimensions } from '../../src/lib/pdfEngine.mjs';

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
