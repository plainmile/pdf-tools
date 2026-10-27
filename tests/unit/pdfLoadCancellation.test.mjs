import test from 'node:test';
import assert from 'node:assert/strict';
import { abortableWait, readFileArrayBuffer } from '../../src/lib/pdfUtilities.mjs';
import { readSourceFile } from '../../src/lib/pdfEngine.mjs';
import { PDFDocument } from 'pdf-lib';

test('cancellation releases a hung PDF worker promise without waiting for it', async () => {
  const controller = new AbortController();
  const neverResolves = new Promise(() => {});
  const operation = abortableWait(neverResolves, controller.signal);
  controller.abort();
  await assert.rejects(operation, /Processing cancelled/);
  assert.throws(() => abortableWait(neverResolves, controller.signal), /Processing cancelled/);
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

test('workspace PDF import can cancel a third-party parser that never resolves', async () => {
  const oldReader = globalThis.FileReader;
  const oldLoad = PDFDocument.load;
  let parserStarted = false;
  class ImmediateFileReader {
    static LOADING = 1;
    readyState = 0;
    readAsArrayBuffer() {
      this.readyState = 1;
      queueMicrotask(() => {
        if (this.readyState !== 1) return;
        this.result = Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55).buffer;
        this.readyState = 2;
        this.onload?.();
      });
    }
    abort() { this.readyState = 2; this.onabort?.(); }
  }
  try {
    globalThis.FileReader = ImmediateFileReader;
    PDFDocument.load = () => {
      parserStarted = true;
      return new Promise(() => {}); // Parsing never yields a result.
    };
    const controller = new AbortController();
    const pending = readSourceFile(
      { name: 'stalled.pdf', type: 'application/pdf', size: 8 },
      { signal: controller.signal },
    );
    // Allow FileReader completion and parser startup, then abort during parse.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(parserStarted, true);
    controller.abort();
    await assert.rejects(pending, /Processing cancelled/);
  } finally {
    PDFDocument.load = oldLoad;
    if (oldReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = oldReader;
  }
});
