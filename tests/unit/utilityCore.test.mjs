import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes, compressionStats, requestedPages, normalizeText, parseTextBlocks,
  textContentToLines, linesToReadableText, sanitizeFilename,
  UTILITY_LIMITS, enforceUtilityPdfLimits, enforceImageBatchLimit,
} from '../../src/lib/utilityCore.mjs';

test('compression reports actual savings; a larger result must not count as savings', () => {
  assert.deepEqual(compressionStats(1000, 700), { original: 1000, candidate: 700, bytesSaved: 300, percent: 30, smaller: true });
  assert.deepEqual(compressionStats(1000, 1200), { original: 1000, candidate: 1200, bytesSaved: 0, percent: -20, smaller: false });
  assert.throws(() => compressionStats(0, 100));
  assert.equal(formatBytes(1048576), '1.00 MB');
});
test('image page selection handles ranges and no duplicate pages', () => {
  assert.deepEqual(requestedPages('', 4), [1, 2, 3, 4]);
  assert.deepEqual(requestedPages('2-3,1,2', 4), [2, 3, 1]);
  assert.throws(() => requestedPages('4-2', 4), /reversed/);
  assert.throws(() => requestedPages('100', 4), /outside/);
});
test('basic Markdown headings and list semantics without inserting remote HTML', () => {
  const blocks = parseTextBlocks('# Hello **PlainMile**\r\n- Item with [link](https://example.com)\n```js\nconst x = 1\n```', true);
  assert.equal(blocks[0].text, 'Hello PlainMile');
  assert.equal(blocks[0].kind, 'heading');
  assert.equal(blocks[1].text, '• Item with link');
  assert.equal(blocks.at(-1).kind, 'code');
  assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc');
});
test('PDF positioned text is approximately sorted by vertical position then X', () => {
  const items = [
    { str: 'right', transform: [1,0,0,12, 100, 300], height: 12, width: 25 },
    { str: 'last', transform: [1,0,0,12, 30, 275], height: 12, width: 22 },
    { str: 'left', transform: [1,0,0,12, 20, 300], height: 12, width: 25 },
  ];
  const lines = textContentToLines({items});
  assert.deepEqual(lines.map(x => x.text), ['left right', 'last']);
  assert.equal(linesToReadableText([lines], false), 'left right\nlast');
  assert.match(linesToReadableText([[{text: 'Large title', fontSize: 24},{text: 'Body',fontSize: 12}]], true), /## Large title/);
});
test('generated download filename removes unsafe path characters', () => {
  assert.equal(sanitizeFilename('../secret\n local.pdf'), '..-secret-local');
});

test('book-length text extraction and page numbering accept 500 pages up to 100 MiB', () => {
  const info = { size: 80 * 1024 ** 2, count: 500 };
  assert.equal(enforceUtilityPdfLimits(info, 'pdf-to-txt'), true);
  assert.equal(enforceUtilityPdfLimits(info, 'pdf-to-markdown'), true);
  assert.equal(enforceUtilityPdfLimits(info, 'add-page-numbers'), true);
  assert.equal(enforceUtilityPdfLimits(info, 'pdf-to-images'), true);
  assert.equal(UTILITY_LIMITS.maxPages, 1000);
  assert.equal(UTILITY_LIMITS.maxTextBytes, 5 * 1024 ** 2);
  assert.equal(UTILITY_LIMITS.maxOutputPages, 1000);
});

test('oversized PDFs and 1001-page PDFs fail before expensive rasterization', () => {
  assert.throws(() => enforceUtilityPdfLimits({ size: 100 * 1024 ** 2 + 1, count: 1 }, 'pdf-to-txt'), /100 MB/);
  assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count: 1001 }, 'pdf-to-markdown'), /1,000 pages/);
  assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count: 121 }, 'compress-pdf'), /120 pages/);
  assert.equal(enforceUtilityPdfLimits({ size: 2000, count: 120 }, 'compress-pdf'), true);
  assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count: 121 }, 'compress-pdf', 'zh'), /120 页/);
});

test('image conversion selects any 60 pages from a 500-page book, not only first 60', () => {
  const selected = requestedPages('301-360', 500);
  assert.equal(selected.length, 60);
  assert.equal(selected[0], 301);
  assert.equal(selected.at(-1), 360);
  assert.equal(enforceImageBatchLimit(selected.length), true);
  assert.throws(() => enforceImageBatchLimit(requestedPages('1-61', 500).length), /60 pages/);
});
