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
