import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { addPageNumbers } from '../../src/lib/pdfUtilities.mjs';

async function blankPdf(pageCount = 5) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return { bytes: new Uint8Array(await doc.save()), count: pageCount };
}

test('numbering can skip unnumbered cover pages while keeping every PDF page', async () => {
  const pdf = await blankPdf();
  const progress = [];
  const output = await addPageNumbers(pdf, { firstPage: 3, start: 9 }, (done, total) => progress.push([done, total]));
  const result = await PDFDocument.load(output);
  assert.equal(result.getPageCount(), 5);
  assert.deepEqual(progress, [[1,5],[2,5],[3,5],[4,5],[5,5]]);
});

test('first numbered PDF page and final printed number respect document bounds', async () => {
  const pdf = await blankPdf();
  const accepted = await addPageNumbers(pdf, { firstPage: 5, start: 99999 });
  assert.equal((await PDFDocument.load(accepted)).getPageCount(), 5);
  await assert.rejects(addPageNumbers(pdf, { firstPage: 0, start: 1 }), /First PDF page/);
  await assert.rejects(addPageNumbers(pdf, { firstPage: 6, start: 1 }), /First PDF page/);
  await assert.rejects(addPageNumbers(pdf, { firstPage: 1.5, start: 1 }), /First PDF page/);
  await assert.rejects(addPageNumbers(pdf, { firstPage: 4, start: 99999 }), /exceed 99999/);
  await assert.rejects(addPageNumbers(pdf, { firstPage: 3, start: 0 }), /Starting page number/);
});
