import test from 'node:test';
import assert from 'node:assert/strict';
import { watermarkPagePlacement } from '../../src/lib/watermark.mjs';

function toVisual(crop, rotation, x, y) {
  const u = x - crop.x, v = y - crop.y;
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 90) return [v, crop.width - u];
  if (angle === 180) return [crop.width - u, crop.height - v];
  if (angle === 270) return [crop.height - v, u];
  return [u, v];
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

test('watermark fills visible CropBox upright for all 4 rotations', () => {
  const crop = { x: 21, y: 37, width: 510, height: 700 };
  for (const angle of [0, 90, 180, 270, -90, 450]) {
    const p = watermarkPagePlacement(crop, angle);
    const r = p.rotation * Math.PI / 180;
    const origin = toVisual(crop, angle, p.x, p.y);
    const alongX = toVisual(crop, angle,
      p.x + p.width * Math.cos(r), p.y + p.width * Math.sin(r));
    const alongY = toVisual(crop, angle,
      p.x - p.height * Math.sin(r), p.y + p.height * Math.cos(r));
    near(origin[0], 0); near(origin[1], 0);
    near(alongX[0], p.visualWidth); near(alongX[1], 0);
    near(alongY[0], 0); near(alongY[1], p.visualHeight);
    near(p.visualWidth, angle % 180 === 0 ? crop.width : crop.height);
    near(p.visualHeight, angle % 180 === 0 ? crop.height : crop.width);
  }
});

test('invalid watermark geometries fail safely instead of painting off-page', () => {
  assert.throws(() => watermarkPagePlacement({ x: 0, y: 0, width: 0, height: 300 }, 0), /Invalid/);
  assert.throws(() => watermarkPagePlacement({ x: 0, y: 0, width: 400, height: NaN }, 0), /Invalid/);
  assert.throws(() => watermarkPagePlacement({ x: 0, y: 0, width: 400, height: 600 }, 45), /Unsupported/);
});
