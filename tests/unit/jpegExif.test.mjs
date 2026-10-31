import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegExifOrientation, orientedJpegSize, jpegPdfPlacement, stripJpegPrivateMetadata } from '../../src/lib/jpegExif.mjs';

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

test('strip JPEG EXIF/XMP, IPTC and comments without changing compressed scan bytes', () => {
  const app0 = Uint8Array.from([0xff, 0xe0, 0, 4, 0x4a, 0x46]);
  const app2 = Uint8Array.from([0xff, 0xe2, 0, 5, 0x49, 0x43, 0x43]);
  const app14 = Uint8Array.from([0xff, 0xee, 0, 5, 0x41, 0x44, 0x4f]);
  const exif = exifSegment(6);
  const app13 = Uint8Array.from([0xff, 0xed, 0, 7, 0x50, 0x52, 0x49, 0x56, 0x31]);
  const comment = Uint8Array.from([0xff, 0xfe, 0, 7, 0x47, 0x50, 0x53, 0x21, 0x21]);
  const scan = Uint8Array.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xf0, 0xff, 0, 0x00, 0xff, 0xd9]);
  const withPrivateHeaders = Uint8Array.from([0xff, 0xd8, ...app0, ...exif, ...app2, ...app13, ...comment, ...app14, ...scan]);
  const cleaned = stripJpegPrivateMetadata(withPrivateHeaders);
  assert.equal(jpegExifOrientation(withPrivateHeaders), 6);
  assert.deepEqual(cleaned, Uint8Array.from([0xff, 0xd8, ...app0, ...app2, ...app14, ...scan]));
  assert.equal(jpegExifOrientation(cleaned), 1);
  assert.equal(stripJpegPrivateMetadata(cleaned), cleaned);
});

test('reject malformed headers rather than embedding uninspected private EXIF metadata', () => {
  assert.throws(() => stripJpegPrivateMetadata(Uint8Array.from([1, 2, 3])), /safely removed/);
  assert.throws(() => stripJpegPrivateMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x47, 0x50, 0x53])), /safely removed/);
  assert.throws(() => stripJpegPrivateMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 5, 0x45, 0x58, 0x49])), /safely removed/);
});

test('progressive multi-scan JPEG strips EXIF/IPTC/comments between scans without changing image entropy', () => {
  const segment = (marker, text) => {
    const payload = new TextEncoder().encode(text);
    const size = payload.length + 2;
    return Uint8Array.from([0xff, marker, size >>> 8, size & 0xff, ...payload]);
  };
  const firstScan = Uint8Array.from([
    0xff, 0xda, 0, 2, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,
  ]);
  const secondScan = Uint8Array.from([
    0xff, 0xda, 0, 2, 0x78, 0xff, 0x00, 0x9a, 0xff, 0xd9,
  ]);
  const icc = segment(0xe2, 'ICC safe profile');
  const huffman = segment(0xc4, 'Huffman marker survives');
  const exif = segment(0xe1, 'Private GPS location after first SOS');
  const xmp = segment(0xe1, 'Private XMP after the second scan');
  const iptc = segment(0xed, 'Private IPTC name between scans');
  const comment = segment(0xfe, 'Private JPEG comment after scan');
  const original = Uint8Array.from([
    0xff, 0xd8, ...segment(0xe1, 'GPS before first scan'), ...icc,
    ...firstScan, ...exif, ...huffman, ...iptc, ...comment, ...secondScan,
  ]);
  const expected = Uint8Array.from([
    0xff, 0xd8, ...icc, ...firstScan, ...huffman, ...secondScan,
  ]);
  const cleaned = stripJpegPrivateMetadata(original);
  assert.deepEqual(cleaned, expected);
  assert.equal(stripJpegPrivateMetadata(cleaned), cleaned);
  assert.ok(!new TextDecoder().decode(cleaned).includes('Private'));
  // A late metadata segment must never survive just because it follows SOS.
  const trailingMetadata = Uint8Array.from([...expected, ...xmp]);
  assert.deepEqual(stripJpegPrivateMetadata(trailingMetadata), expected);
});

test('JPEG privacy stripper does not misread marker-looking bytes inside a length-bounded segment', () => {
  const iccWithMarkerBytes = Uint8Array.from([0xff, 0xe2, 0, 6, 0xff, 0xe1, 0xff, 0xed]);
  const original = Uint8Array.from([
    0xff, 0xd8, ...iccWithMarkerBytes, 0xff, 0xda, 0, 2,
    0x31, 0xff, 0x00, 0xe1, 0x32, 0xff, 0xd7, 0x33, 0xff, 0xd9,
  ]);
  assert.equal(stripJpegPrivateMetadata(original), original);
  assert.throws(() => stripJpegPrivateMetadata(original.subarray(0, -2)), /safely removed/);
  // A malformed scan marker with no complete length must fail closed.
  assert.throws(() => stripJpegPrivateMetadata(Uint8Array.from([
    0xff, 0xd8, 0xff, 0xda, 0, 2, 0x11, 0xff, 0xe1, 0, 99,
  ])), /safely removed/);
});
