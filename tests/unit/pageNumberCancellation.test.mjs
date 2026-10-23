import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { addPageNumbers } from '../../src/lib/pdfUtilities.mjs';

test('page numbering yields to event loop and honors a user cancellation mid-document', async () => {
  const input = await PDFDocument.create();
  for (let i = 0; i < 40; i++) input.addPage([595.28, 841.89]);
  const bytes = new Uint8Array(await input.save());
  const controller = new AbortController();
  let progress = 0;
  await assert.rejects(
    addPageNumbers({ bytes }, { start: 11, position: 'bottom-center', fontSize: 12, signal: controller.signal }, (done) => {
      progress = done;
      // An actual user Cancel click is queued as another event loop task.
      // A loop that never yields will wrongly finish the entire file first.
      if (done === 1) setTimeout(() => controller.abort(), 0);
    }),
    /Processing cancelled/,
  );
  assert.ok(progress >= 1 && progress < 40, 'no completed 40-page output after Cancel');
});
