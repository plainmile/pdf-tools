import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegExifOrientation, orientedJpegSize, jpegPdfPlacement } from '../../src/lib/jpegExif.mjs';

function exifSegment(orientation, endian = 'II') {
  const payload = new Uint8Array(32);
  payload.set([69, 120, 105, 102, 0, 0], 0);
  const little = endian === 'II';
  payload.set(little ? [73, 73] : [77, 77], 6);
  const dv = new DataView(payload.buffer);
  dv.setUint16(8, 42, little);
  dv.setUint32(10, 8, little);
  dv.setUint16(14, 1, little);
  dv.setUint16(16, 0x0112, little);
  dv.setUint16(18, 3, little);
  dv.setUint32(20, 1, little);
  dv.setUint16(24, orientation, little);
  dv.setUint32(28, 0, little);
  return Uint8Array.from([0xff, 0xe1, 0, 34, ...payload]);
}

function jpegWithSegments(...segments) {
  return Uint8Array.from([0xff, 0xd8, ...segments.flatMap(s => [...s]), 0xff, 0xda, 0, 2]);
}

test('reads every EXIF Orientation from little- and big-endian JPEG APP1 segments', () => {
  for (const endian of ['II', 'MM']) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      assert.equal(jpegExifOrientation(jpegWithSegments(exifSegment(orientation, endian))), orientation);
    }
  }
});

test('skips unrelated APP1 and APP0; ignores corrupt, truncated and out-of-range metadata', () => {
  const unknownApp1 = Uint8Array.from([0xff, 0xe1, 0, 6, 88, 77, 80, 0]);
  const app0 = Uint8Array.from([0xff, 0xe0, 0, 4, 0, 0]);
  assert.equal(jpegExifOrientation(jpegWithSegments(app0, unknownApp1, exifSegment(6))), 6);
  assert.equal(jpegExifOrientation(jpegWithSegments(exifSegment(0))), 1);
  assert.equal(jpegExifOrientation(jpegWithSegments(exifSegment(9))), 1);
  assert.equal(jpegExifOrientation(jpegWithSegments(Uint8Array.from([0xff, 0xe1, 0, 80, 1]))), 1);
  const badOffset = exifSegment(8);
  new DataView(badOffset.buffer).setUint32(14, 0xffffff00, true);
  assert.equal(jpegExifOrientation(jpegWithSegments(badOffset)), 1);
  const badCount = exifSegment(7);
  new DataView(badCount.buffer).setUint16(18, 9999, true);
  assert.equal(jpegExifOrientation(jpegWithSegments(badCount)), 1);
  assert.equal(jpegExifOrientation(Uint8Array.from([1, 2, 3])), 1);
  assert.equal(jpegExifOrientation(jpegWithSegments()), 1);
});

test('EXIF Orientation transforms original corner colors into the specified visual grid', () => {
  const expected = {
    1: 'RGBY', 2: 'GRYB', 3: 'YBGR', 4: 'BYRG',
    5: 'RBGY', 6: 'BRYG', 7: 'YGBR', 8: 'GYRB',
  };
  const rect = { x: 30, y: 45, width: 170, height: 260 };
  const rawCorners = [
    { color: 'R', u: 0, v: 1 }, { color: 'G', u: 1, v: 1 },
    { color: 'B', u: 0, v: 0 }, { color: 'Y', u: 1, v: 0 },
  ];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const p = jpegPdfPlacement(rect, orientation);
    const rad = p.angle * Math.PI / 180;
    const slots = Array(4);
    for (const { color, u, v } of rawCorners) {
      const px = p.x + Math.cos(rad) * p.width * u - Math.sin(rad) * p.height * v;
      const py = p.y + Math.sin(rad) * p.width * u + Math.cos(rad) * p.height * v;
      const col = (px - rect.x) / rect.width > 0.5 ? 1 : 0;
      const row = (rect.y + rect.height - py) / rect.height > 0.5 ? 1 : 0;
      slots[row * 2 + col] = color;
    }
    assert.equal(slots.join(''), expected[orientation], 'Orientation ' + orientation);
    const size = orientedJpegSize(240, 160, orientation);
    assert.deepEqual(size, orientation >= 5
      ? { width: 160, height: 240 } : { width: 240, height: 160 });
  }
  assert.throws(() => jpegPdfPlacement(rect, 0), /Invalid JPEG/);
});
