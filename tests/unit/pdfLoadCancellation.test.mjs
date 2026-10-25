import test from 'node:test';
import assert from 'node:assert/strict';
import { abortableWait, readFileArrayBuffer } from '../../src/lib/pdfUtilities.mjs';

test('cancellation releases a hung PDF worker promise without waiting for it', async () => {
  const controller = new AbortController();
  const neverResolves = new Promise(() => {});
  const operation = abortableWait(neverResolves, controller.signal);
  controller.abort();
  await assert.rejects(operation, /Processing cancelled/);
  await assert.rejects(abortableWait(neverResolves, controller.signal), /Processing cancelled/);
});

test('abortable worker wait still returns real results and errors normally', async () => {
  const controller = new AbortController();
  assert.equal(await abortableWait(Promise.resolve(3), controller.signal), 3);
  await assert.rejects(abortableWait(Promise.reject(new Error('Invalid PDF')), controller.signal), /Invalid PDF/);
  assert.equal(await abortableWait(Promise.resolve('ok')), 'ok');
});

test('FileReader input can be cancelled before bytes finish, then a new input succeeds', async () => {
  const previousReader = globalThis.FileReader;
  class ControlledFileReader {
    static LOADING = 1;
    static last = null;
    constructor() { this.readyState = 0; ControlledFileReader.last = this; }
    readAsArrayBuffer(file) { this.readyState = 1; this.file = file; }
    abort() { this.aborted = true; this.readyState = 2; this.onabort?.(); }
  }
  globalThis.FileReader = ControlledFileReader;
  try {
    const cancelledController = new AbortController();
    const cancelled = readFileArrayBuffer({ name: 'slow.pdf' }, cancelledController.signal);
    const pendingReader = ControlledFileReader.last;
    assert.equal(pendingReader.readyState, ControlledFileReader.LOADING);
    cancelledController.abort();
    await assert.rejects(cancelled, /Processing cancelled/);
    assert.equal(pendingReader.aborted, true);

    const readyController = new AbortController();
    const ready = readFileArrayBuffer({ name: 'valid.pdf' }, readyController.signal);
    const readyReader = ControlledFileReader.last;
    readyReader.result = Uint8Array.from([37, 80, 68, 70]).buffer;
    readyReader.onload();
    assert.deepEqual(new Uint8Array(await ready), Uint8Array.of(37, 80, 68, 70));
  } finally {
    if (previousReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousReader;
  }
});
