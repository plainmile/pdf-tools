import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWatermarkPng } from '../../src/lib/watermark.mjs';

function withCanvas(toBlob) {
  const previous = globalThis.document;
  const ctx = {
    setTransform() {}, translate() {}, rotate() {}, scale() {}, fillText() {},
    measureText() { return { width: 110 }; },
  };
  const canvas = {
    width: 0, height: 0, getContext() { return ctx; },
    toBlob(callback, type) { return toBlob(callback, type); },
  };
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas');
    return canvas;
  } };
  return {
    canvas,
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

test('Cancel releases watermark canvas pixels when toBlob never calls back', async () => {
  const controller = new AbortController();
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const fake = withCanvas(() => { started(); /* stalled native encoder */ });
  try {
    const task = renderWatermarkPng('Local PDF only', 595, 842, controller.signal);
    await entered;
    assert.ok(fake.canvas.width > 0 && fake.canvas.height > 0);
    controller.abort();
    await assert.rejects(task, /Processing cancelled/);
    assert.deepEqual({ width: fake.canvas.width, height: fake.canvas.height }, { width: 0, height: 0 });
  } finally { fake.restore(); }
});

test('Cancel releases watermark canvas pixels when PNG Blob read never resolves', async () => {
  const controller = new AbortController();
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const fake = withCanvas(callback => callback({ arrayBuffer() {
    started();
    return new Promise(() => {}); // Even a completed PNG encode can stall at readback.
  } }));
  try {
    const task = renderWatermarkPng('Local PDF only', 595, 842, controller.signal);
    await entered;
    controller.abort();
    await assert.rejects(task, /Processing cancelled/);
    assert.deepEqual({ width: fake.canvas.width, height: fake.canvas.height }, { width: 0, height: 0 });
  } finally { fake.restore(); }
});

test('successful watermark PNG generation still returns bytes and frees canvas', async () => {
  const fake = withCanvas(callback => callback({
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71, 4, 3, 2, 1]).buffer,
  }));
  try {
    const bytes = await renderWatermarkPng('Source PDF', 595, 842);
    assert.deepEqual(Array.from(bytes), [137, 80, 78, 71, 4, 3, 2, 1]);
    assert.deepEqual({ width: fake.canvas.width, height: fake.canvas.height }, { width: 0, height: 0 });
  } finally { fake.restore(); }
});
