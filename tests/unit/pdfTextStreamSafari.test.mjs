import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdfTextContent } from '../../src/lib/pdfUtilities.mjs';

test('Safari-style ReadableStream without Symbol.asyncIterator still extracts all PDF.js text chunks', async () => {
  const chunks = [
    { lang: 'en', styles: { F1: { fontFamily: 'Sans' } }, items: [{ str: 'Hello', width: 23 }] },
    { lang: null, styles: { F2: { fontFamily: 'Serif' } }, items: [{ str: ' Safari', width: 36 }] },
  ];
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    },
  });
  // Shipping Safari lacks the ReadableStream async-iterator hook required
  // by PDF.js's page.getTextContent(). getReader() works in this environment.
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined, configurable: true });
  assert.equal(typeof stream[Symbol.asyncIterator], 'undefined');
  let calledGetTextContent = false;
  const text = await readPdfTextContent({
    streamTextContent: () => stream,
    getTextContent() { calledGetTextContent = true; throw new Error('Safari unsupported iterator'); },
  });
  assert.equal(calledGetTextContent, false);
  assert.equal(text.lang, 'en');
  assert.deepEqual(text.items.map(item => item.str), ['Hello', ' Safari']);
  assert.deepEqual(Object.keys(text.styles).sort(), ['F1', 'F2']);
});

test('a stalled PDF text stream cancels promptly and releases its reader', async () => {
  const controller = new AbortController();
  let cancelReason = null;
  const stream = new ReadableStream({
    cancel(reason) { cancelReason = reason; },
  });
  const task = readPdfTextContent({ streamTextContent: () => stream }, controller.signal);
  controller.abort();
  await assert.rejects(task, /Processing cancelled/);
  assert.equal(cancelReason, 'Processing cancelled.');
});

test('PDF stream reader errors are propagated instead of producing incomplete successful text', async () => {
  const stream = new ReadableStream({
    start(controller) { controller.error(new Error('Invalid PDF text chunk')); },
  });
  await assert.rejects(readPdfTextContent({ streamTextContent: () => stream }), /Invalid PDF text chunk/);
});
