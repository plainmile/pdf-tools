import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { composePdf } from '../../src/lib/pdfEngine.mjs';
import { addPageNumbers } from '../../src/lib/pdfUtilities.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function enteredPhase(phase) {
  // Never silently hang this test when implementation changes which phase runs.
  await Promise.race([
    phase.promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Export did not reach the stalled phase.')), 5000);
      timer.unref?.();
    }),
  ]);
}

async function sourceFixture() {
  const source = await PDFDocument.create({ updateMetadata: false });
  source.addPage([301, 410]);
  return new Uint8Array(await source.save());
}

const refs = [{ id: 'page-a', sourceId: 'original', pageIndex: 0, rotation: 0 }];
const asSources = bytes => [{ id: 'original', bytes, pageCount: 1, isImage: false }];

test('workspace export Cancel interrupts a hung source PDF parser and leaves retry usable', async () => {
  const bytes = await sourceFixture();
  const oldLoad = PDFDocument.load;
  const started = deferred();
  const controller = new AbortController();
  try {
    PDFDocument.load = () => { started.resolve(); return new Promise(() => {}); };
    const task = composePdf(asSources(bytes), refs, {
      signal: controller.signal, cancelMessage: 'PDF export cancelled.',
    });
    await enteredPhase(started);
    controller.abort();
    await assert.rejects(task, /PDF export cancelled/);
  } finally { PDFDocument.load = oldLoad; }
  const good = await composePdf(asSources(bytes), refs);
  assert.equal((await PDFDocument.load(good)).getPage(0).getWidth(), 301);
});

test('workspace split Cancel interrupts a hung PDF serializer without a partial file', async () => {
  const bytes = await sourceFixture();
  const oldSave = PDFDocument.prototype.save;
  const started = deferred();
  const controller = new AbortController();
  try {
    PDFDocument.prototype.save = function () {
      started.resolve();
      return new Promise(() => {}); // Third-party saver never settles.
    };
    const task = composePdf(asSources(bytes), refs, { signal: controller.signal });
    await enteredPhase(started);
    controller.abort();
    await assert.rejects(task, /Split cancelled/);
  } finally { PDFDocument.prototype.save = oldSave; }
  const good = await composePdf(asSources(bytes), refs);
  assert.equal((await PDFDocument.load(good)).getPageCount(), 1);
});

test('page numbering Cancel interrupts a stalled PDF load and restores retry', async () => {
  const bytes = await sourceFixture();
  const oldLoad = PDFDocument.load;
  const started = deferred();
  const controller = new AbortController();
  try {
    PDFDocument.load = () => { started.resolve(); return new Promise(() => {}); };
    const task = addPageNumbers({ bytes }, { signal: controller.signal, start: 10 });
    await enteredPhase(started);
    controller.abort();
    await assert.rejects(task, /Processing cancelled/);
  } finally { PDFDocument.load = oldLoad; }
  const good = await addPageNumbers({ bytes }, { start: 10 });
  assert.equal((await PDFDocument.load(good)).getPageCount(), 1);
});

test('page numbering Cancel interrupts PDF save after all pages are numbered', async () => {
  const bytes = await sourceFixture();
  const oldSave = PDFDocument.prototype.save;
  const started = deferred();
  const controller = new AbortController();
  try {
    PDFDocument.prototype.save = function () {
      started.resolve();
      return new Promise(() => {});
    };
    const task = addPageNumbers({ bytes }, { signal: controller.signal, start: 10 });
    await enteredPhase(started);
    controller.abort();
    await assert.rejects(task, /Processing cancelled/);
  } finally { PDFDocument.prototype.save = oldSave; }
  const good = await addPageNumbers({ bytes }, { start: 10 });
  assert.equal((await PDFDocument.load(good)).getPageCount(), 1);
});
