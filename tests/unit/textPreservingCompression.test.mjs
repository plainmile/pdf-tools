import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compressPdfStructure } from '../../src/lib/pdfUtilities.mjs';

async function source() {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 18; i++) {
    pdf.addPage([595, 842]).drawText('Original selectable page ' + (i + 1), {
      x: 60, y: 700, size: 14, font,
    });
  }
  const field = pdf.getForm().createTextField('account');
  field.setText('ABC');
  field.addToPage(pdf.getPage(0), { x: 60, y: 600, width: 150, height: 30 });
  const bytes = new Uint8Array(await pdf.save({ useObjectStreams: false }));
  return { bytes, count: 18, size: bytes.length };
}

test('PDF structure optimizer reduces a non-object-stream PDF while keeping pages, editable forms and default metadata absent', async () => {
  const input = await source();
  const progress = [];
  const result = await compressPdfStructure(input, {}, (done, total) => progress.push([done,total]));
  assert.equal(result.stats.original, input.bytes.length);
  assert.equal(result.stats.smaller, true);
  assert.ok(result.bytes?.length < input.bytes.length);
  assert.deepEqual(progress, [[18,18]]);
  const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
  assert.equal(output.getPageCount(), 18);
  assert.equal(output.getForm().getTextField('account').getText(), 'ABC');
  assert.equal(output.getProducer(), undefined);
  assert.equal(output.getCreator(), undefined);
  assert.equal(Buffer.from(input.bytes).equals(Buffer.from(result.bytes)), false);
});

test('structure optimizer rejects cancelled operation and never reports inflated results as savings', async () => {
  const input = await source();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(compressPdfStructure(input, { signal: controller.signal }), /Processing cancelled/);
  const once = await compressPdfStructure(input);
  const small = { bytes: once.bytes, count: input.count, size: once.bytes.length };
  const next = await compressPdfStructure(small);
  assert.equal(next.stats.original, small.size);
  assert.equal(next.stats.smaller, next.stats.candidate < small.size);
  if (!next.stats.smaller) assert.equal(next.bytes, null);
  else assert.ok(next.bytes.length < small.size);
});


test('cancel promptly rejects a stalled PDF parsing promise without returning output', async () => {
  const input = await source();
  const originalLoad = PDFDocument.load;
  const controller = new AbortController();
  let loadStarted = false;
  const progress = [];
  try {
    PDFDocument.load = () => {
      loadStarted = true;
      return new Promise(() => {}); // The third-party parse never settles.
    };
    const pending = compressPdfStructure(input, { signal: controller.signal },
      (done, total) => progress.push([done, total]));
    assert.equal(loadStarted, true);
    controller.abort();
    await assert.rejects(pending, /Processing cancelled/);
    assert.deepEqual(progress, []);
  } finally {
    PDFDocument.load = originalLoad;
  }
});

test('cancel promptly rejects a stalled PDF object serialization and ignores late output', async () => {
  const input = await source();
  const originalLoad = PDFDocument.load;
  const controller = new AbortController();
  const progress = [];
  let saveStarted = false;
  try {
    PDFDocument.load = async () => ({
      getPageCount: () => input.count,
      save: () => {
        saveStarted = true;
        return new Promise(() => {}); // Simulate an unresponsive async save.
      },
    });
    const pending = compressPdfStructure(input, { signal: controller.signal },
      (done, total) => progress.push([done, total]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saveStarted, true);
    controller.abort();
    await assert.rejects(pending, /Processing cancelled/);
    assert.deepEqual(progress, []);
  } finally {
    PDFDocument.load = originalLoad;
  }
});
