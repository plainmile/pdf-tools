import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePdfPageLayout, IMAGE_PDF_LAYOUT_DEFAULT, sameImagePdfLayout } from '../../src/lib/imagePdfLayout.mjs';

function near(a, b) { assert.ok(Math.abs(a - b) < 0.02, String(a) + ' != ' + String(b)); }

test('old image PDF defaults remain A4 portrait with 30 pt margins', () => {
  assert.deepEqual(IMAGE_PDF_LAYOUT_DEFAULT, { paper: 'a4', orientation: 'portrait', margin: 30, imageSizing: 'contain' });
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

  const forcedPortrait = imagePdfPageLayout(1600, 900, { paper: 'fit', orientation: 'portrait', margin: 48 });
  // Fit is an image-shaped page even when a caller tries to force Portrait.
  assert.ok(forcedPortrait.width > forcedPortrait.height);
  near(forcedPortrait.image.x, 48);
  near(forcedPortrait.image.y, 48);
  const forcedLandscape = imagePdfPageLayout(900, 1600, { paper: 'fit', orientation: 'landscape', margin: 12 });
  assert.ok(forcedLandscape.width < forcedLandscape.height);
  near(forcedLandscape.image.x, 12);
  near(forcedLandscape.image.y, 12);
  const huge = imagePdfPageLayout(33000, 25000, { paper: 'fit', orientation: 'auto', margin: 12 });
  assert.ok(Math.max(huge.width, huge.height) <= 14400);
});

test('invalid settings cannot silently make a clipped or invalid PDF', () => {
  for (const bad of [{ paper: 'tabloid' }, { orientation: 'upside-down' }, { margin: 1000 }, { margin: -1 }, { imageSizing: 'stretch' }]) {
    assert.throws(() => imagePdfPageLayout(400, 600, bad), /Unsupported/);
  }
  assert.throws(() => imagePdfPageLayout(0, 600), /Invalid image/);
  assert.throws(() => imagePdfPageLayout(NaN, 600), /Invalid image/);
});

test('contain never crops while cover fills and clips to the printable margin', () => {
  const contained = imagePdfPageLayout(1200, 300, { paper: 'letter', orientation: 'portrait', margin: 48 });
  const covered = imagePdfPageLayout(1200, 300, { paper: 'letter', orientation: 'portrait', margin: 48, imageSizing: 'cover' });
  assert.equal(contained.clip, null);
  assert.ok(contained.image.x >= 48 && contained.image.y >= 48);
  assert.deepEqual(covered.clip, { x: 48, y: 48, width: 516, height: 696 });
  assert.ok(covered.image.x < 48);
  near(covered.image.height, 696);
  const fit = imagePdfPageLayout(1200, 300, { paper: 'fit', margin: 12, imageSizing: 'cover' });
  assert.equal(fit.clip, null);
  near(fit.image.x, 12);
  near(fit.image.y, 12);
});

test('undo can reactivate a photo with older applied settings', () => {
  const oldA4 = { ...IMAGE_PDF_LAYOUT_DEFAULT };
  const letter = { ...oldA4, paper: 'letter', margin: 12 };
  assert.equal(sameImagePdfLayout(oldA4, oldA4), true);
  assert.equal(sameImagePdfLayout(oldA4, { ...oldA4 }), true);
  assert.equal(sameImagePdfLayout(oldA4, letter), false);
  assert.equal(sameImagePdfLayout(null, letter), false);
  assert.equal(sameImagePdfLayout({ ...letter, imageSizing: 'cover' }, letter), false);
});
