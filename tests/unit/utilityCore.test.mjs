import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes, compressionStats, requestedPages, normalizeText, decodeImportedText, parseTextBlocks, stripMarkdownInline,
  textContentToLines, linesToReadableText, summarizeTextCoverage, sanitizeFilename, workspaceFilenameStem,
  UTILITY_LIMITS, IMAGE_PRINT_DPI, IMAGE_PRINT_SCALE, validatedImageScale, enforceRasterViewport, enforceUtilityPdfLimits, enforceImageBatchLimit, imagePageBatch, batchIndexFromCustomPages, imagePageSelectionLabel, enforceImageBatchBytes, enforceCompressionImageBytes, checkCancelled, translateUtilityError,
} from '../../src/lib/utilityCore.mjs';

test('text importer decodes UTF-8 and BOM-marked Windows UTF-16 without data loss', () => {
  const sample = 'Report 2026: Café and 中文';
  const utf8 = new TextEncoder().encode(sample);
  const bomUtf8 = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
  const le = Buffer.from(sample, 'utf16le');
  const be = Buffer.from(le);
  for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
  assert.equal(decodeImportedText(utf8), sample);
  assert.equal(decodeImportedText(bomUtf8), sample);
  assert.equal(decodeImportedText(Uint8Array.from([0xff, 0xfe, ...le])), sample);
  assert.equal(decodeImportedText(Uint8Array.from([0xfe, 0xff, ...be])), sample);
  assert.throws(() => decodeImportedText(Uint8Array.of(0xc3, 0x28)), /Text encoding/);
  assert.throws(() => decodeImportedText(Uint8Array.of(0x41, 0x00, 0x42, 0x00)), /Text encoding/);
  assert.throws(() => decodeImportedText(Uint8Array.of(0xff, 0xfe, 0, 0, 0x41, 0, 0, 0)), /Text encoding/);
  assert.throws(() => decodeImportedText(Uint8Array.of(0xc3, 0x28), 'zh'), /文本编码无法识别/);
});

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
test('Markdown PDF parser preserves comparison operators instead of mistaking them for HTML', () => {
  const blocks = parseTextBlocks(
    '# Report\nLogic: a < 3 && b > 2\nBounds: x <= 40 && y >= 8\nCode: \`value < 5 && size > 1\`\nSafe <strong>bold</strong> <!-- hidden --> text',
    true,
  );
  assert.deepEqual(blocks.map(({ kind }) => kind), ['heading', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal(blocks[1].text, 'Logic: a < 3 && b > 2');
  assert.equal(blocks[2].text, 'Bounds: x <= 40 && y >= 8');
  assert.equal(blocks[3].text, 'Code: value < 5 && size > 1');
  assert.equal(blocks[4].text, 'Safe bold  text');
});

test('Markdown inline formatting preserves identifiers, arithmetic and unmatched markers', () => {
  const literal = 'user_id, batch_run_2026, a*b, x**2, C*x, a_b_c, 4 * 5, and a lone * or _';
  assert.equal(stripMarkdownInline(literal), literal);
  assert.equal(stripMarkdownInline('**bold**, *italic*, _em_, __strong__, ~~old~~, and \`code_var\`'),
    'bold, italic, em, strong, old, and code_var');
  assert.equal(stripMarkdownInline('See [docs](https://example.com) and <strong>marked</strong> text'),
    'See docs and marked text');
  const headings = parseTextBlocks('# Technical user_id\nResult: a*b + x**2 and c_d', true);
  assert.equal(headings[0].text, 'Technical user_id');
  assert.equal(headings[1].text, 'Result: a*b + x**2 and c_d');
});

test('Markdown parser preserves generics, placeholders and comparisons without spaces', () => {
  const literal = 'Generics: List<T> and Map<string, number>; template <username>; x<y&&z>q; a<b && c>d';
  assert.equal(stripMarkdownInline(literal), literal);
  assert.equal(
    stripMarkdownInline('HTML: <strong>bold</strong>, <span class="note">visible</span>, <br/> and <!-- secret -->text'),
    'HTML: bold, visible,  and text',
  );
  const blocks = parseTextBlocks('# Types: List<T>\nArgument: <username>\nCheck: a<b && c>d', true);
  assert.equal(blocks[0].text, 'Types: List<T>');
  assert.equal(blocks[1].text, 'Argument: <username>');
  assert.equal(blocks[2].text, 'Check: a<b && c>d');
});

test('inline Markdown code preserves literal HTML tags, URL text and arithmetic', () => {
  const input = 'Use `<strong>` and `<script>alert(1)</script>` literally; `[docs](https://example.com)` is code. Outside <strong>bold</strong>.';
  assert.equal(stripMarkdownInline(input),
    'Use <strong> and <script>alert(1)</script> literally; [docs](https://example.com) is code. Outside bold.');
  assert.equal(stripMarkdownInline('**bold `x*y`** with _emphasis_ and `<input>`'),
    'bold x*y with emphasis and <input>');
  const blocks = parseTextBlocks('# Using `<a>` tags\nExample: `<div class="x">` and `[link](https://plainmile.com)`', true);
  assert.equal(blocks[0].text, 'Using <a> tags');
  assert.equal(blocks[1].text, 'Example: <div class="x"> and [link](https://plainmile.com)');
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
test('partial PDF text extraction reports exactly the pages without selectable text', () => {
  const allText = [{ text: 'A', fontSize: 12 }];
  assert.deepEqual(summarizeTextCoverage([allText, [], allText, []]), {
    total: 4, withText: 2, missingPages: [2, 4],
  });
  assert.deepEqual(summarizeTextCoverage([allText, allText]), {
    total: 2, withText: 2, missingPages: [],
  });
  assert.deepEqual(summarizeTextCoverage([[], []]), {
    total: 2, withText: 0, missingPages: [1, 2],
  });
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

test('220 DPI image export scale is exact and untrusted scales fall back safely', () => {
  assert.equal(IMAGE_PRINT_DPI, 220);
  assert.equal(IMAGE_PRINT_SCALE * 72, 220);
  assert.equal(validatedImageScale(IMAGE_PRINT_SCALE), IMAGE_PRINT_SCALE);
  assert.equal(validatedImageScale(1), 1);
  assert.equal(validatedImageScale(1.5), 1.5);
  assert.equal(validatedImageScale(2), 2);
  assert.equal(validatedImageScale(500), 1.5);
  assert.equal(validatedImageScale(3), 1.5);
});

test('image rasterizer rejects extreme aspect ratios before allocating browser canvas', () => {
  assert.equal(enforceRasterViewport({ width: 4000, height: 2000 }), true);
  assert.equal(enforceRasterViewport({ width: 16384, height: 200 }), true);
  assert.throws(() => enforceRasterViewport({ width: 17000, height: 300 }), /too large to rasterize/);
  assert.throws(() => enforceRasterViewport({ width: 300, height: 17000 }), /too large to rasterize/);
  assert.throws(() => enforceRasterViewport({ width: 4000, height: 4000 }), /too large to rasterize/);
  assert.throws(() => enforceRasterViewport({ width: NaN, height: 10 }), /too large to rasterize/);
});

test('image conversion selects any 60 pages from a 500-page book, not only first 60', () => {
  const selected = requestedPages('301-360', 500);
  assert.equal(selected.length, 60);
  assert.equal(selected[0], 301);
  assert.equal(selected.at(-1), 360);
  assert.equal(enforceImageBatchLimit(selected.length), true);
  assert.throws(() => enforceImageBatchLimit(requestedPages('1-61', 500).length), /60 pages/);
});

test('PDF image ZIP filename labels preserve localized and nonconsecutive output-page identities', () => {
  assert.equal(imagePageSelectionLabel('３０１－３０６', 500), '301-306');
  assert.equal(imagePageSelectionLabel('２－３，５、７', 10), '2-3_5_7');
  assert.equal(imagePageSelectionLabel('3,1', 20), '3_1');
  assert.equal(imagePageSelectionLabel('', 10), '');
  const longList = Array.from({ length: 60 }, (_, n) => n * 2 + 1).join(',');
  const label = imagePageSelectionLabel(longList, 125);
  assert.match(label, /^selection-first1-last119-60pages$/);
  assert.throws(() => imagePageSelectionLabel('4-1', 5), /reversed/);
});

test('image batch suggestions cover the entire book without overlapping or exceeding 60 pages', () => {
  assert.deepEqual(imagePageBatch(2), { start: 1, end: 2, total: 1, range: '1-2' });
  assert.deepEqual(imagePageBatch(60), { start: 1, end: 60, total: 1, range: '1-60' });
  assert.deepEqual(imagePageBatch(61), { start: 1, end: 60, total: 2, range: '1-60' });
  assert.deepEqual(imagePageBatch(61, 1), { start: 61, end: 61, total: 2, range: '61-61' });
  assert.deepEqual(imagePageBatch(320, 5), { start: 301, end: 320, total: 6, range: '301-320' });
  assert.throws(() => imagePageBatch(0), /Invalid/);
  assert.throws(() => imagePageBatch(1001), /Invalid/);
  assert.throws(() => imagePageBatch(100, -1), /outside/);
  assert.throws(() => imagePageBatch(100, 2), /outside/);
});

test('custom image range returns to the nearest standard page batch rather than stale first batch', () => {
  assert.equal(batchIndexFromCustomPages('301-306', 500, 0), 5);
  assert.equal(batchIndexFromCustomPages('１２１－１２５', 125, 0), 2);
  assert.equal(batchIndexFromCustomPages('61,1', 125, 0), 1);
  assert.equal(batchIndexFromCustomPages('99-1', 320, 3), 3);
  assert.equal(batchIndexFromCustomPages('1000', 320, 2), 2);
  assert.equal(batchIndexFromCustomPages('1-320', 320, 4), 4);
  assert.throws(() => batchIndexFromCustomPages('301', 0, 0), /Invalid/);
});

test('batch output budget and cancellation prevent oversized downloads', () => {
  assert.equal(enforceImageBatchBytes(1024, 2048), 3072);
  assert.throws(() => enforceImageBatchBytes(64 * 1024 * 1024, 1), /64 MB/);
  assert.throws(() => enforceImageBatchBytes(64 * 1024 * 1024, 1, 'zh'), /64 MB/);
  const c = new AbortController();
  checkCancelled(c.signal);
  c.abort();
  assert.throws(() => checkCancelled(c.signal), /cancelled/);
  assert.match(translateUtilityError(new Error('This page is too large to rasterize safely.'), 'zh'), /页面尺寸/);
  assert.match(translateUtilityError(new Error('Processing cancelled.'), 'zh'), /取消/);
  assert.match(translateUtilityError(new Error('PDF 文件大小须在 1 字节至 100 MB 之间。'), 'zh'), /100 MB/);
  assert.match(translateUtilityError(new Error('PDF 最多支持 1000 页。'), 'zh'), /1000 页/);
});

test('English Markdown quotes, rules and numbered lists preserve searchable ASCII text', () => {
  const blocks = parseTextBlocks('# Report\n> Important\n---\n1. First\n2) Second', true);
  assert.deepEqual(blocks.map(({ kind }) => kind), ['heading','quote','rule','list','list']);
  assert.equal(blocks[1].text, '> Important');
  assert.equal(blocks[2].text, '--------------------');
  assert.equal(blocks[3].text, '1. First');
  assert.equal(blocks[4].text, '2. Second');
});

test('60 separate image pages are valid while 61 separate ranges still fail safely', () => {
  const sixty = Array.from({ length: 60 }, (_, index) => index * 2 + 1);
  assert.deepEqual(requestedPages(sixty.join(', '), 200), sixty);
  const sixtyOne = Array.from({ length: 61 }, (_, index) => index * 2 + 1);
  assert.throws(() => requestedPages(sixtyOne.join(', '), 200), /maximum of 60 ranges/);
});

test('raster compression keeps a separate cumulative 96 MB JPEG safety budget', () => {
  const max = UTILITY_LIMITS.maxCompressionImageBytes;
  assert.equal(max, 96 * 1024 * 1024);
  assert.equal(enforceCompressionImageBytes(24, 12), 36);
  assert.equal(enforceCompressionImageBytes(max - 1, 1), max);
  assert.throws(() => enforceCompressionImageBytes(max, 1), /96 MB/);
  assert.throws(() => enforceCompressionImageBytes(-1, 1), /96 MB/);
  assert.throws(() => enforceCompressionImageBytes(1, NaN, 'zh'), /96 MB/);
  assert.match(translateUtilityError(new Error('Compressed image data exceeds the 96 MB safety limit.'), 'zh'), /96 MB/);
});

test('custom PDF download stems are Unicode-safe, path-safe and optional', () => {
  assert.equal(workspaceFilenameStem('', 'plainmile-2-files'), 'plainmile-2-files');
  assert.equal(workspaceFilenameStem('  My report 2026.PDF  '), 'My-report-2026');
  assert.equal(workspaceFilenameStem('../../Client Review.pdf'), 'Client-Review');
  assert.equal(workspaceFilenameStem('客户报告.pdf'), '客户报告');
  assert.equal(workspaceFilenameStem('ＡＢＣ－２０２６.pdf'), 'ABC-2026');
  assert.equal(workspaceFilenameStem('??...///', 'unchanged'), 'unchanged');
  assert.equal(workspaceFilenameStem('CON.pdf'), 'plainmile-CON');
  assert.ok(workspaceFilenameStem('A'.repeat(200)).length <= 70);
});
