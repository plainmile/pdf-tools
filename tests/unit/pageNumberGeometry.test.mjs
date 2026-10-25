import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageNumberPlacement } from '../../src/lib/pageNumberGeometry.mjs';

function toVisual(crop, rotation, x, y) {
  const u = x - crop.x, v = y - crop.y;
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 90) return { x: v, y: crop.width - u };
  if (angle === 180) return { x: crop.width - u, y: crop.height - v };
  if (angle === 270) return { x: crop.height - v, y: u };
  return { x: u, y: v };
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-7, String(actual) + ' != ' + String(expected));
}

test('all rotations leave page numbers visually upright and in the requested corner', () => {
  const crop = { x: 27, y: 35, width: 420, height: 600 };
  for (const rotation of [0, 90, 180, 270, -90, 450]) {
    for (const position of ['bottom-center', 'bottom-right', 'top-right']) {
      const textWidth = 37, fontSize = 12;
      const p = pageNumberPlacement(crop, rotation, textWidth, fontSize, position);
      const start = toVisual(crop, rotation, p.x, p.y);
      near(start.x, p.visibleX);
      near(start.y, p.visibleY);
      const rad = p.rotation * Math.PI / 180;
      const finish = toVisual(crop, rotation,
        p.x + textWidth * Math.cos(rad), p.y + textWidth * Math.sin(rad));
      near(finish.x - start.x, textWidth);
      near(finish.y - start.y, 0);
      near(p.rotation, ((rotation % 360) + 360) % 360);
      near(p.visualWidth, p.rotation % 180 ? crop.height : crop.width);
      near(p.visualHeight, p.rotation % 180 ? crop.width : crop.height);
      if (position === 'bottom-center') near(p.visibleX, (p.visualWidth - textWidth) / 2);
      else near(p.visibleX, p.visualWidth - 28 - textWidth);
      near(p.visibleY, position === 'top-right' ? p.visualHeight - fontSize - 22 : 24);
    }
  }
});

test('reject tiny or invalid pages rather than drawing invisible page numbers', () => {
  const crop = { x: 0, y: 0, width: 70, height: 60 };
  assert.throws(() => pageNumberPlacement(crop, 0, 38, 12), /too small/);
  assert.throws(() => pageNumberPlacement(crop, 90, 10, 16), /too small/);
  assert.throws(() => pageNumberPlacement({ x: 0, y: 0, width: -1, height: 400 }, 0, 12, 12), /Invalid PDF/);
  assert.throws(() => pageNumberPlacement({ x: 0, y: 0, width: 500, height: 500 }, 30, 12, 12), /Unsupported/);
});

test('all six numbering positions and three margins remain inside rotated/cropped pages', () => {
  const crop = { x: 18, y: 42, width: 440, height: 620 };
  for (const rotation of [0, 90, 180, 270]) {
    for (const margin of [12, 24, 40]) {
      for (const position of ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']) {
        const textWidth = 39, fontSize = 12;
        const p = pageNumberPlacement(crop, rotation, textWidth, fontSize, position, margin);
        const start = toVisual(crop, rotation, p.x, p.y);
        near(start.x, p.visibleX);
        near(start.y, p.visibleY);
        const rad = p.rotation * Math.PI / 180;
        const end = toVisual(crop, rotation,
          p.x + textWidth * Math.cos(rad), p.y + textWidth * Math.sin(rad));
        near(end.x - start.x, textWidth);
        near(end.y, start.y);
        const expectedX = position.endsWith('left') ? margin + 4
          : position.endsWith('right') ? p.visualWidth - (margin + 4) - textWidth
            : (p.visualWidth - textWidth) / 2;
        const expectedY = position.startsWith('top')
          ? p.visualHeight - fontSize - (margin - 2) : margin;
        near(p.visibleX, expectedX);
        near(p.visibleY, expectedY);
        assert.ok(p.visibleX >= margin, 'must remain inside left safe inset');
        assert.ok(p.visibleX + textWidth <= p.visualWidth - margin, 'must remain inside right safe inset');
        assert.ok(p.visibleY >= 0 && p.visibleY + fontSize <= p.visualHeight, 'must remain on the page vertically');
      }
    }
  }
});

test('reject margins that cannot fit or would place numbers outside the crop', () => {
  const page = { x: 0, y: 0, width: 100, height: 100 };
  assert.throws(() => pageNumberPlacement(page, 0, 30, 12, 'bottom-right', 40), /too small/);
  assert.throws(() => pageNumberPlacement(page, 90, 30, 12, 'top-left', 40), /too small/);
  assert.throws(() => pageNumberPlacement(page, 0, 10, 12, 'bottom-left', 0), /margin/);
  assert.throws(() => pageNumberPlacement(page, 0, 10, 12, 'bottom-left', 73), /margin/);
  assert.throws(() => pageNumberPlacement(page, 0, 10, 12, 'bottom-left', NaN), /Invalid PDF/);
});
