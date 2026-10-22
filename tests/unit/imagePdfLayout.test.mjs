import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePdfPageLayout, IMAGE_PDF_LAYOUT_DEFAULT } from '../../src/lib/imagePdfLayout.mjs';

function near(a, b) { assert.ok(Math.abs(a - b) < 0.02, String(a) + ' != ' + String(b)); }

test('old image PDF defaults remain A4 portrait with 30 pt margins', () => {
  assert.deepEqual(IMAGE_PDF_LAYOUT_DEFAULT, { paper: 'a4', orientation: 'portrait', margin: 30 });
  const p = imagePdfPageLayout(240, 160);
  near(p.width, 595.28);
  near(p.height, 841.89);
  assert.equal(p.margin, 30);
  near(p.image.width, 535.28);
  near(p.image.x, 30);
  assert.ok(p.image.y > 30);
});

test('A4 and US Letter have correct physical sizes, landscape and automatic orientation', () => {
  const l = imagePdfPageLayout(1600, 900, { paper: 'letter', orientation: 'landscape', margin: 12 });
  assert.deepEqual([l.width, l.height], [792, 612]);
  near(l.image.width, 768);
  const a = imagePdfPageLayout(1000, 1600, { paper: 'a4', orientation: 'auto', margin: 0 });
  near(a.width, 595.28); near(a.height, 841.89);
  const autoLandscape = imagePdfPageLayout(1600, 1000, { paper: 'a4', orientation: 'auto', margin: 30 });
  near(autoLandscape.width, 841.89); near(autoLandscape.height, 595.28);
});

test('fit-to-picture preserves exact proportions and leaves chosen borders', () => {
  const p = imagePdfPageLayout(1600, 900, { paper: 'fit', orientation: 'auto', margin: 0 });
  near(p.width, 1200); near(p.height, 675);
  near(p.image.width, p.width); near(p.image.height, p.height);
  near(p.image.x, 0); near(p.image.y, 0);

  const portrait = imagePdfPageLayout(1600, 900, { paper: 'fit', orientation: 'portrait', margin: 48 });
  assert.ok(portrait.width < portrait.height);
  assert.ok(portrait.image.x >= 48);
  assert.ok(portrait.image.y >= 48);
  const huge = imagePdfPageLayout(33000, 25000, { paper: 'fit', orientation: 'auto', margin: 12 });
  assert.ok(Math.max(huge.width, huge.height) <= 14400);
});

test('invalid settings cannot silently make a clipped or invalid PDF', () => {
  for (const bad of [{ paper: 'tabloid' }, { orientation: 'upside-down' }, { margin: 1000 }, { margin: -1 }]) {
    assert.throws(() => imagePdfPageLayout(400, 600, bad), /Unsupported/);
  }
  assert.throws(() => imagePdfPageLayout(0, 600), /Invalid image/);
  assert.throws(() => imagePdfPageLayout(NaN, 600), /Invalid image/);
});
