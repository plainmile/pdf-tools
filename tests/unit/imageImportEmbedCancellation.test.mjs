import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { readSourceFile } from '../../src/lib/pdfEngine.mjs';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9kAAAAASUVORK5CYII=', 'base64',
);

test('Cancel interrupts a never-resolving PNG embed and the next valid import succeeds', async () => {
  const previousReader = globalThis.FileReader;
  const previousEmbed = PDFDocument.prototype.embedPng;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  class ImmediateFileReader {
    static LOADING = 1;
    readyState = 0;
    readAsArrayBuffer(file) {
      this.readyState = 1;
      queueMicrotask(() => {
        if (this.readyState !== 1) return;
        this.readyState = 2;
        this.result = file.bytes.buffer.slice(
          file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
        this.onload?.();
      });
    }
    abort() { this.readyState = 2; this.onabort?.(); }
  }
  const input = { name: 'pixel.png', type: 'image/png', size: onePixelPng.length, bytes: onePixelPng };
  try {
    globalThis.FileReader = ImmediateFileReader;
    PDFDocument.prototype.embedPng = function () {
      started();
      return new Promise(() => {}); // Third-party decoder/embed never resolves.
    };
    const controller = new AbortController();
    const pending = readSourceFile(input, { signal: controller.signal });
    await Promise.race([
      entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error('PNG embed not reached')), 5000)),
    ]);
    controller.abort();
    await assert.rejects(pending, /Processing cancelled/);
  } finally {
    PDFDocument.prototype.embedPng = previousEmbed;
    if (previousReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousReader;
  }
});

test('successful direct PNG imports retain a valid 1-page PDF', async () => {
  const previousReader = globalThis.FileReader;
  class ImmediateFileReader {
    static LOADING = 1;
    readyState = 0;
    readAsArrayBuffer(file) {
      this.readyState = 1;
      queueMicrotask(() => {
        this.readyState = 2;
        this.result = file.bytes.buffer.slice(
          file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
        this.onload?.();
      });
    }
    abort() { this.readyState = 2; this.onabort?.(); }
  }
  try {
    globalThis.FileReader = ImmediateFileReader;
    const imported = await readSourceFile(
      { name: 'pixel.png', type: 'image/png', size: onePixelPng.length, bytes: onePixelPng },
      { signal: new AbortController().signal },
    );
    assert.equal(imported.isImage, true);
    assert.equal(imported.pageCount, 1);
    assert.equal((await PDFDocument.load(imported.bytes)).getPageCount(), 1);
  } finally {
    if (previousReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousReader;
  }
});
