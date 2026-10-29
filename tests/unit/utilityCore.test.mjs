import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes, compressionStats, requestedPages, normalizeText, decodeImportedText, parseTextBlocks, stripMarkdownInline, wrapTextLines,
  textContentToLines, textContentToReadingOrderLines, linesToReadableText, hasMinimalSelectableText, hasSparseTextScanRisk, textLinesFromFormAnnotations, summarizeTextCoverage, textFitsUtf8Budget, sanitizeFilename, workspaceFilenameStem, bookmarkSplitPartFilenames,
  UTILITY_LIMITS, IMAGE_PRINT_DPI, IMAGE_PRINT_SCALE, validatedImageScale, enforceRasterViewport, rasterCanvasSideLimit, enforceUtilityPdfLimits, enforceImageBatchLimit, imagePageBatch, batchIndexFromCustomPages, imagePageSelectionLabel, imagePageFilename, imageExportFilenames, enforceImageBatchBytes, enforceCompressionImageBytes, checkCancelled, translateUtilityError, validateNumberingPlan, decimalPageInteger,
} from '../../src/lib/utilityCore.mjs';


test('numbering plan preflight matches 1-99999 output bounds before any PDF parse', () => {
  assert.equal(validateNumberingPlan('1', '1', 1), null);
  assert.equal(validateNumberingPlan('201', '1', 320), null);
  assert.equal(validateNumberingPlan('99680', '1', 320), null); // ends at 99999
  assert.equal(validateNumberingPlan('99681', '1', 320), 'overflow');
  assert.equal(validateNumberingPlan('99999', '5', 5), null); // only the last page numbered
  assert.equal(validateNumberingPlan('99999', '4', 5), 'overflow');
  assert.equal(validateNumberingPlan('99999', '1', 2), 'overflow');
  for (const invalid of ['', '0', '-1', '1.5', '1.0', '2e0', '1e2', '0x10', '+2', '100000', 'abc']) {
    assert.equal(validateNumberingPlan(invalid, '1', 5), 'start', invalid);
  }
  for (const invalid of ['', '0', '-1', '1.5', '1.0', '2e0', '1e0', '0x1', '6', '99999', 'abc']) {
    assert.equal(validateNumberingPlan('1', invalid, 5), 'first', invalid);
  }
  assert.equal(validateNumberingPlan('1', '1', 0), 'first');
  assert.equal(validateNumberingPlan('0002', '0001', 5), null);
  assert.equal(decimalPageInteger('002'), 2);
  assert.equal(decimalPageInteger('1e2'), null);
  assert.equal(decimalPageInteger('2.0'), null);
  assert.equal(decimalPageInteger('0x10'), null);

});

test('bookmark ZIP names are opt-in-safe, unique, Unicode-aware and never filesystem paths', () => {
  const ranges = [
    { start: 1, end: 2 }, { start: 3, end: 4 },
    { start: 5, end: 6 }, { start: 7, end: 8 },
    { start: 9, end: 10 },
  ];
  const names = bookmarkSplitPartFilenames(ranges, [
    { page: 3, title: '../../Chapter: One' },
    { page: 5, title: 'CON' },
    { page: 7, title: '../../Chapter: One' },
    { page: 9, title: '中文 / 第一节' },
  ]);
  assert.deepEqual(names, [
    'part-01-pages-1-2.pdf',
    'part-02-Chapter-One-pages-3-4.pdf',
    'part-03-plainmile-CON-pages-5-6.pdf',
    'part-04-Chapter-One-pages-7-8.pdf',
    'part-05-中文-第一节-pages-9-10.pdf',
  ]);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every(name => !name.includes('/') && !name.includes('\\\\') && !name.includes('..')));
  assert.deepEqual(bookmarkSplitPartFilenames([{ start: 1, end: 2 }], [{ page: 1, title: '../' }]),
    ['part-01-pages-1-2.pdf']);
  assert.throws(() => bookmarkSplitPartFilenames([{ start: 3, end: 2 }], []));
  assert.throws(() => bookmarkSplitPartFilenames(Array.from({ length: 51 }, (_, i) => ({ start: i + 1, end: i + 1 })), []));
});

test('UTF-8 text edit budget rejects whole oversize pastes without silently clipping code units', () => {
  assert.equal(textFitsUtf8Budget('a'.repeat(10), 10), true);
  assert.equal(textFitsUtf8Budget('a'.repeat(11), 10), false);
  assert.equal(textFitsUtf8Budget('中文', 6), true);
  assert.equal(textFitsUtf8Budget('中文', 5), false);
  assert.equal(textFitsUtf8Budget('😀😀', 8), true);
  assert.equal(textFitsUtf8Budget('😀😀', 7), false);
  assert.equal(textFitsUtf8Budget('', 0), true);
  assert.equal(textFitsUtf8Budget('abc', -1), false);
});

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
  assert.deepEqual(requestedPages('2-,1,4-', 4), [2, 3, 4, 1]);
  assert.deepEqual(requestedPages('４－', 4), [4]);
  assert.throws(() => requestedPages('4-2', 4), /reversed/);
  assert.throws(() => requestedPages('100', 4), /outside/);
});
test('TXT and Markdown line wrapping keeps whole words when they fit and splits only oversized tokens', () => {
  const wrap = (text, width, options = {}) => [...wrapTextLines(text, width, () => 1, options)];
  assert.deepEqual(wrap('foo bar baz', 7), ['foo bar', 'baz']);
  assert.deepEqual(wrap('hello brave world', 9), ['hello', 'brave', 'world']);
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrap('ABC verylongtoken', 7), ['ABC', 'verylon', 'gtoken']);
  assert.deepEqual(wrap('one     two   three', 8), ['one', 'two', 'three']);
  assert.deepEqual(wrap('中文测试没有空格', 3), ['中文测', '试没有', '空格']);
  // Code remains monospaced and may wrap at any character, never silently
  // losing the initial indentation or replacing symbols with Markdown syntax.
  assert.deepEqual(wrap('      let x = 1;', 7, { preserveWords: false }),
    ['      l', 'et x = ', '1;']);
});

test('variable-width words fall back to a hard wrap before overflowing PDF margins', () => {
  const measure = (char) => char === 'Q' ? 4 : char === ' ' ? 0 : 1;
  const rows = [...wrapTextLines('a QQQ', 10, measure)];
  // Previously the word-boundary branch retained QQ, then appended a third
  // 4-unit glyph without rechecking, producing a 12-unit line in a 10-unit box.
  assert.deepEqual(rows, ['a', 'QQ', 'Q']);
  for (const row of rows) {
    const width = [...row].reduce((sum, char) => sum + measure(char), 0);
    assert.ok(width <= 10, 'wrapped line must remain within its measured width');
  }
});

test('Unicode wrapping keeps combining accents, emoji modifiers, ZWJ sequences and flags intact', () => {
  const emoji = '\u{1f469}\u{1f3fd}\u200d\u{1f4bb}';
  const accented = 'e\u0301';
  const flag = '\u{1f1fa}\u{1f1f3}';
  const input = 'A' + emoji + accented + flag + 'B';
  const measure = cluster => cluster === emoji || cluster === flag ? 2 : 1;
  const codeRows = [...wrapTextLines(input, 2, measure, { preserveWords: false })];
  assert.deepEqual(codeRows, ['A', emoji, accented, flag, 'B']);
  assert.equal(codeRows.join(''), input);
  assert.ok(codeRows.every(line => [...line].length === 1 || line === emoji || line === accented || line === flag));
  const proseRows = [...wrapTextLines('A ' + emoji + 'B', 3, measure)];
  assert.deepEqual(proseRows, ['A', emoji + 'B']);
  // After a word-boundary reflow, recalculate widths by whole grapheme,
  // not by the individual code points of the retained suffix.
  assert.deepEqual([...wrapTextLines('a ' + emoji + emoji + 'z', 3, measure)], ['a', emoji, emoji + 'z']);
});

test('fenced-code wrapping does not erase spaces that fall on a line boundary', () => {
  const input = 'abc   def  ghi';
  const rows = [...wrapTextLines(input, 4, () => 1, { preserveWords: false })];
  assert.equal(rows.join(''), input); // Exact code spacing survives wrapping.
  assert.ok(rows.every(row => row.length <= 4));
  const indentation = '        const value = 12;  // aligned';
  const parts = [...wrapTextLines(indentation, 7, () => 1, { preserveWords: false })];
  assert.equal(parts.join(''), indentation);
  assert.ok(parts.every(part => part.length <= 7));
});

test('basic Markdown headings and list semantics without inserting remote HTML', () => {
  const blocks = parseTextBlocks('# Hello **PlainMile**\r\n- Item with [link](https://example.com)\n```js\nconst x = 1\n```', true);
  assert.equal(blocks[0].text, 'Hello PlainMile');
  assert.equal(blocks[0].kind, 'heading');
  assert.equal(blocks[1].text, '• Item with link (https://example.com)');
  assert.equal(blocks.at(-1).kind, 'code');
  assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc');
});
test('Markdown links preserve targets with nested parentheses and optional titles', () => {
  assert.equal(stripMarkdownInline('[docs](https://example.com/docs)'), 'docs (https://example.com/docs)');
  assert.equal(stripMarkdownInline('[Function](https://en.wikipedia.org/wiki/Function_(mathematics))'),
    'Function (https://en.wikipedia.org/wiki/Function_(mathematics))');
  assert.equal(stripMarkdownInline('[Guide](./guide.md "Read me")'), 'Guide (./guide.md)');
  assert.equal(stripMarkdownInline('![Diagram](https://example.com/image_(2).png)'),
    'Diagram (https://example.com/image_(2).png)');
  assert.equal(stripMarkdownInline('[https://example.com](https://example.com)'), 'https://example.com');
  assert.equal(stripMarkdownInline('Broken [link](https://example.com/a_(b)'),
    'Broken [link](https://example.com/a_(b)');
  assert.equal(stripMarkdownInline('Literal `[docs](https://example.com)` stays literal'),
    'Literal [docs](https://example.com) stays literal');
});

test('many unclosed Markdown links do not trigger quadratic rescanning or lose later valid links', () => {
  const malformed = '[broken]('.repeat(12000);
  const input = malformed + '\n' + '[Valid](https://example.com/a_(b))';
  const start = performance.now();
  const result = stripMarkdownInline(input);
  const elapsed = performance.now() - start;
  assert.equal(result, malformed + '\n' + 'Valid (https://example.com/a_(b))');
  // A legitimate sub-50 KB editor input must finish well within a few seconds
  // even on a shared CI runner. Previously each failed opener rescanned the
  // entire remaining line, causing ~288 million redundant character visits.
  assert.ok(elapsed < 1800, `Malformed Markdown parsing took ${Math.round(elapsed)} ms`);
});

test('unclosed emphasis markers parse quickly without losing scientific notation', () => {
  const malformed = '*a '.repeat(12000);
  const start = performance.now();
  const result = stripMarkdownInline(malformed + '\nThen **bold** and _italic_ remain valid.');
  const elapsed = performance.now() - start;
  assert.equal(result, malformed + '\nThen bold and italic remain valid.');
  // Previously roughly quadratic: 8,000 fragments took multiple seconds.
  assert.ok(elapsed < 1800, 'Unclosed emphasis parsing took ' + Math.round(elapsed) + ' ms');
  const technical = 'user_id x**2 and y**3, 2*3*4; nested: ***word***.';
  assert.equal(stripMarkdownInline(technical), 'user_id x**2 and y**3, 2*3*4; nested: *word*.');
  assert.equal(stripMarkdownInline('**Bold** and ~~removed~~ then `literal *x*`'),
    'Bold and removed then literal *x*');
});

test('malformed HTML comments parse near-linearly, without losing literal source text', () => {
  const malformed = '<!--'.repeat(12000);
  const source = malformed + '\nFooter: **visible** and <strong>safe</strong> and `literal *text*`';
  const start = performance.now();
  const converted = stripMarkdownInline(source);
  const elapsed = performance.now() - start;
  assert.equal(converted, malformed + '\nFooter: visible and safe and literal *text*');
  // Previously the global lazy HTML-comment regex repeatedly scanned each
  // remaining opener (quadratic). 48 KB of pasted text took multiple seconds.
  assert.ok(elapsed < 1800, 'Malformed HTML comments took ' + Math.round(elapsed) + ' ms');
  assert.equal(stripMarkdownInline('Before <!-- hidden\non another line --> after <b>ok</b>'),
    'Before  after ok');
  assert.equal(stripMarkdownInline('Before <!-- unfinished <b>keep</b>'),
    'Before <!-- unfinished keep');
  assert.equal(stripMarkdownInline('alpha <!-- one --> beta <!-- two --> gamma'),
    'alpha  beta  gamma');
  // Unknown HTML-like tags can contain comment-looking quoted attributes.
  // Preserve them exactly instead of stripping the attribute's contents.
  assert.equal(stripMarkdownInline('<Widget title="<!-- keep -->">hello</Widget>'),
    '<Widget title="<!-- keep -->">hello</Widget>');
  assert.equal(stripMarkdownInline('<strong title="<!-- irrelevant -->">bold</strong>'),
    'bold');
});

test('Markdown code fences preserve trailing spaces and whitespace-only lines before PDF wrapping', () => {
  const input = [
    '```js',
    'const config = 1;   ',
    '    ',
    '',
    '  return config;  ',
    '```',
    'Normal prose trailing spaces    ',
  ].join('\n');
  const blocks = parseTextBlocks(input, true);
  assert.deepEqual(blocks.map(block => [block.kind, block.text]), [
    ['code', 'const config = 1;   '],
    ['code', '    '],
    ['code', ''],
    ['code', '  return config;  '],
    ['paragraph', 'Normal prose trailing spaces'],
  ]);
  const first = [...wrapTextLines(blocks[0].text, 8, () => 1, { preserveWords: false })];
  assert.equal(first.join(''), blocks[0].text);
  const spaces = [...wrapTextLines(blocks[1].text, 8, () => 1, { preserveWords: false })];
  assert.equal(spaces.join(''), '    ');
});

test('Markdown code fences respect marker type, opening length and closing-line syntax', () => {
  const blocks = parseTextBlocks([
    '````js',
    '```',
    '# code content, not a heading',
    '```not a closing fence',
    '````',
    'Plain after a four-tick fence',
    '~~~python',
    'print("tildes")',
    '```',
    '~~~',
    '# Markdown heading again',
  ].join('\n'), true);
  assert.deepEqual(blocks.map(block => block.kind),
    ['code', 'code', 'code', 'paragraph', 'code', 'code', 'heading']);
  assert.equal(blocks[0].text, '```');
  assert.equal(blocks[1].text, '# code content, not a heading');
  assert.equal(blocks[2].text, '```not a closing fence');
  assert.equal(blocks[3].text, 'Plain after a four-tick fence');
  assert.equal(blocks[6].text, 'Markdown heading again');
  const unfinished = parseTextBlocks('```js\nconst x = 1;\n```not closed\nconst y = 2;', true);
  assert.deepEqual(unfinished.map(block => block.kind), ['code', 'code', 'code']);
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
    'See docs (https://example.com) and marked text');
  const headings = parseTextBlocks('# Technical user_id\nResult: a*b + x**2 and c_d', true);
  assert.equal(headings[0].text, 'Technical user_id');
  assert.equal(headings[1].text, 'Result: a*b + x**2 and c_d');
});

test('adjacent exponent operators never become an accidental Markdown emphasis pair', () => {
  const literal = 'Powers: x**2 and y**3; fields: a__2 and b__5; multiply: 2*3*4';
  assert.equal(stripMarkdownInline(literal), literal);
  const mixed = 'Math x**2 and y**3, then **bold** and *italic* plus __strong__ and ~~old~~';
  assert.equal(stripMarkdownInline(mixed),
    'Math x**2 and y**3, then bold and italic plus strong and old');
  assert.equal(parseTextBlocks('# x**2 and y**3\nValue: a__2 and b__5', true)[0].text, 'x**2 and y**3');
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

test('Markdown inline-code markers remain bounded with saturated private-use Unicode', () => {
  const privateUse = Array.from({ length: 0x1900 }, (_, index) =>
    String.fromCharCode(0xe000 + index)).join('');
  const large = 'A'.repeat(160_000) + privateUse + ' Use `<script>` literally.';
  assert.equal(stripMarkdownInline(large), large.replace('`<script>`', '<script>'));

  // All individual UTF-16 code units are present; a missing adjacent pair
  // must be chosen without looping forever or losing a later inline example.
  let allCodeUnits = '';
  for (let code = 0; code < 65536; code += 128) {
    allCodeUnits += String.fromCharCode(...Array.from({ length: 128 }, (_, offset) => code + offset)) + '\n';
  }
  const output = stripMarkdownInline(allCodeUnits + '\nExample: `<strong>`.');
  assert.ok(output.endsWith('\nExample: <strong>.'));
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
test('explicit multi-column text order keeps each column together and handles rotation', () => {
  const content = { items: [
    { str: 'L1', transform: [1,0,0,12,40,700], height:12, width:18 },
    { str: 'R1', transform: [1,0,0,12,345,700], height:12, width:18 },
    { str: 'L2', transform: [1,0,0,12,40,675], height:12, width:18 },
    { str: 'R2', transform: [1,0,0,12,345,675], height:12, width:18 },
  ] };
  const viewport = { width:600, convertToViewportPoint:(x,y)=>[x,800-y] };
  assert.deepEqual(textContentToReadingOrderLines(content, 'rows').map(x=>x.text), ['L1 R1','L2 R2']);
  assert.deepEqual(textContentToReadingOrderLines(content, 'left-first', viewport).map(x=>x.text), ['L1','L2','R1','R2']);
  assert.deepEqual(textContentToReadingOrderLines(content, 'right-first', viewport).map(x=>x.text), ['R1','R2','L1','L2']);
  const rotated = { items: [
    { str:'L1', transform:[1,0,0,12,600,100], height:12, width:18 },
    { str:'R1', transform:[1,0,0,12,600,500], height:12, width:18 },
    { str:'L2', transform:[1,0,0,12,630,100], height:12, width:18 },
    { str:'R2', transform:[1,0,0,12,630,500], height:12, width:18 },
  ] };
  const rotatedViewport = { width:800, convertToViewportPoint:(x,y)=>[y,x] };
  assert.deepEqual(textContentToReadingOrderLines(rotated,'left-first',rotatedViewport).map(x=>x.text),
    ['L1','L2','R1','R2']); // Split the rotated VISUAL X, not PDF user-space X.
  assert.throws(()=>textContentToReadingOrderLines(content,'unknown',viewport),/Unsupported/);
  assert.throws(()=>textContentToReadingOrderLines(content,'left-first',null),/viewport/);
});

test('rows follow visible lines for PDF pages rotated 90 and 180 degrees', () => {
  // In /Rotate 90 the raw PDF Y axis becomes visible X, while raw X
  // becomes the vertical reading order. A raw PDF Y sort mistakenly merges
  // both visible rows by column.
  const rotated90 = { items: [
    { str: 'BOTTOM_RIGHT', transform: [0,12,-12,0,140,520], width: 100, height: 12 },
    { str: 'TOP_LEFT', transform: [0,12,-12,0,100,100], width: 75, height: 12 },
    { str: 'BOTTOM_LEFT', transform: [0,12,-12,0,140,100], width: 100, height: 12 },
    { str: 'TOP_RIGHT', transform: [0,12,-12,0,100,520], width: 90, height: 12 },
  ] };
  const viewport90 = { width: 800, convertToViewportPoint: (x,y) => [y,x] };
  assert.deepEqual(textContentToReadingOrderLines(rotated90, 'rows', viewport90).map(line => line.text),
    ['TOP_LEFT TOP_RIGHT', 'BOTTOM_LEFT BOTTOM_RIGHT']);
  assert.notDeepEqual(textContentToReadingOrderLines(rotated90, 'rows').map(line => line.text),
    ['TOP_LEFT TOP_RIGHT', 'BOTTOM_LEFT BOTTOM_RIGHT']);
  // 180-degree PDFs invert the original X/Y axes: visible top/left
  // are no longer at the highest raw Y and lowest raw X.
  const rotated180 = { items: [
    { str: 'BOTTOM_RIGHT', transform: [-12,0,0,-12,80,500], width: 100, height: 12 },
    { str: 'TOP_LEFT', transform: [-12,0,0,-12,500,100], width: 80, height: 12 },
    { str: 'BOTTOM_LEFT', transform: [-12,0,0,-12,500,500], width: 100, height: 12 },
    { str: 'TOP_RIGHT', transform: [-12,0,0,-12,80,100], width: 90, height: 12 },
  ] };
  const viewport180 = { width: 600, convertToViewportPoint: (x,y) => [600-x,y] };
  assert.deepEqual(textContentToReadingOrderLines(rotated180, 'rows', viewport180).map(line => line.text),
    ['TOP_LEFT TOP_RIGHT', 'BOTTOM_LEFT BOTTOM_RIGHT']);
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
test('indexed PDF row grouping preserves first-match baseline tolerance and original text exactly', () => {
  // Reference behavior before spatial indexing; comparisons include row font
  // growth, ambiguous first-match ties, sparse coordinates and malformed items.
  function reference(items) {
    const rows = [];
    for (const item of items.filter(part => typeof part.str === 'string' && part.str.trim())) {
      const x = Number(item.transform?.[4] ?? 0);
      const y = Number(item.transform?.[5] ?? 0);
      const fontSize = Math.max(6, Number(item.height) || Math.abs(Number(item.transform?.[3])) || 11);
      let row = rows.find(part => Math.abs(part.y - y) <= Math.max(2, Math.min(part.fontSize, fontSize) * .25));
      if (!row) { row = { y, fontSize, items: [] }; rows.push(row); }
      row.items.push({ x, width: Number(item.width) || 0, str: item.str, fontSize });
      row.fontSize = Math.max(row.fontSize, fontSize);
    }
    return rows.sort((a, b) => b.y - a.y).map(row => {
      let text = '', previousEnd = null;
      for (const part of row.items.sort((a, b) => a.x - b.x)) {
        if (previousEnd !== null && part.x - previousEnd > Math.max(2, part.fontSize * .2) && !/\s$/.test(text)) text += ' ';
        text += part.str;
        previousEnd = Math.max(previousEnd ?? part.x, part.x + part.width);
      }
      return { text: text.trim(), fontSize: row.fontSize };
    }).filter(row => row.text);
  }
  let state = 20261025;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let run = 0; run < 18; run++) {
    const items = Array.from({ length: 720 }, (_, index) => {
      const y = Math.floor(random() * 125) * 7 + (random() - .5) * 7;
      const x = Math.floor(random() * 20) * 19;
      const height = 6 + Math.floor(random() * 9) * 4;
      return { str: 'token-' + index, transform: [1, 0, 0, height, x, y], width: index % 17 + 6, height };
    });
    items.push(
      { str: 'nonnumeric', transform: [0, 0, 0, 11, 20, NaN], width: 5, height: 11 },
      { str: 'very-large-y', transform: [0, 0, 0, 11, 20, 1e30], width: 5, height: 11 },
      { str: 'very-large-font', transform: [0, 0, 0, 11, 20, 400], width: 5, height: 1e9 },
    );
    assert.deepEqual(textContentToLines({ items }), reference(items), 'row grouping run ' + run);
  }
});

test('dense positioned PDF text groups quickly without dropping lines', () => {
  // Formerly each new vertical row rescanned all previous rows. Make enough
  // distinct baselines for the pathological O(n^2) behavior to be observable.
  const items = [];
  for (let row = 11000; row >= 1; row--) {
    items.push({ str: 'A', transform: [1, 0, 0, 11, 10, row * 16], width: 8, height: 11 });
    items.push({ str: 'B', transform: [1, 0, 0, 11, 42, row * 16], width: 8, height: 11 });
  }
  const start = performance.now();
  const result = textContentToLines({ items });
  const elapsed = performance.now() - start;
  assert.equal(result.length, 11000);
  assert.equal(result[0].text, 'A B');
  assert.equal(result.at(-1).text, 'A B');
  assert.ok(elapsed < 1800, 'Dense text row grouping took ' + Math.round(elapsed) + ' ms');
});

test('visible PDF form annotation text/choices append meaningful values, not checkbox guesses', () => {
  const values = [
    { fieldType: 'Tx', fieldName: 'applicant.name', fieldValue: 'Alice' },
    { fieldType: 'Ch', fieldName: 'selection', fieldValue: ['Blue', 'Green'] },
    { fieldType: 'Tx', fieldName: 'applicant.name', fieldValue: 'Alice' },
    { fieldType: 'Tx', fieldName: 'empty', fieldValue: '   ' },
    { fieldType: 'Btn', fieldName: 'consent', fieldValue: 'Yes' },
    { fieldType: 'Sig', fieldName: 'signature', fieldValue: 'signed' },
    null,
  ];
  assert.deepEqual(textLinesFromFormAnnotations(values), [
    { text: 'applicant.name: Alice', fontSize: 12 },
    { text: 'selection: Blue, Green', fontSize: 12 },
  ]);
  assert.deepEqual(textLinesFromFormAnnotations(null), []);
  assert.deepEqual(textLinesFromFormAnnotations([{ fieldType: 'Tx', fieldValue: 'Fallback' }]), [
    { text: 'Form field: Fallback', fontSize: 12 },
  ]);
});

test('coverage distinguishes truly empty pages from image-backed pages with only a number', () => {
  const pageNumber = [{ text: '  Page 1 ', fontSize: 12 }];
  const realText = [{ text: 'Readable body text on this PDF page', fontSize: 12 }];
  assert.deepEqual(summarizeTextCoverage([pageNumber, [], realText, []], [1, 3]), {
    total: 4, withText: 2, missingPages: [2, 4], suspectPages: [1],
  });
  assert.deepEqual(summarizeTextCoverage([pageNumber, pageNumber]), {
    total: 2, withText: 2, missingPages: [], suspectPages: [],
  });
  assert.deepEqual(summarizeTextCoverage([[], []]), {
    total: 2, withText: 0, missingPages: [1, 2], suspectPages: [],
  });
  assert.deepEqual(summarizeTextCoverage([realText], [1]), {
    total: 1, withText: 1, missingPages: [], suspectPages: [],
  });
  assert.equal(hasMinimalSelectableText([{ text: '1' }]), true);
  assert.equal(hasMinimalSelectableText([{ text: '第 2 页' }]), true);
  assert.equal(hasMinimalSelectableText([{ text: 'Text '.repeat(30) }]), false);
  assert.equal(hasMinimalSelectableText([]), false);
});

test('scan risk considers short headers and longer page-labelled footers without flagging real body text', () => {
  const footer = [{ text: 'Confidential archive / Page 21 of 240', fontSize: 9 }];
  const short = [{ text: 'Private report 2026-10-25', fontSize: 9 }];
  const actual = [{ text: 'A complete searchable paragraph of document text, rather than only a small footer.', fontSize: 12 }];
  assert.equal(hasMinimalSelectableText(footer), false);
  assert.equal(hasSparseTextScanRisk(footer), true);
  assert.equal(hasSparseTextScanRisk(short), true);
  assert.equal(hasSparseTextScanRisk(actual), false);
  assert.equal(hasSparseTextScanRisk([]), false);
  assert.equal(hasSparseTextScanRisk(Array.from({length: 4}, () => ({ text:'2026' }))), false);
  assert.deepEqual(summarizeTextCoverage([footer, short, actual], [1,2,3]), {
    total: 3, withText: 3, missingPages: [], suspectPages: [1,2],
  });
  assert.deepEqual(summarizeTextCoverage([footer], []), {
    total: 1, withText: 1, missingPages: [], suspectPages: [],
  });
});

test('generated download filename removes unsafe path characters and Windows device names', () => {
  assert.equal(sanitizeFilename('../secret\n local.pdf'), 'secret-local');
  // Dotfiles must not silently become hidden downloads on Unix systems.
  assert.equal(sanitizeFilename('.private.pdf'), 'private');
  assert.equal(sanitizeFilename('...scan.PDF'), 'scan');
  // NFKC keeps Chinese/fullwidth names legible rather than producing
  // ".PDF"-like fragments and duplicate extensions.
  assert.equal(sanitizeFilename('报告．ＰＤＦ'), '报告');
  assert.equal(sanitizeFilename('ＡＢＣ－２０２６.pdf'), 'ABC-2026');
  assert.equal(sanitizeFilename('report' + '.'.repeat(20) + '.pdf'), 'report');
  assert.equal(sanitizeFilename('a'.repeat(69) + '.long.pdf'), 'a'.repeat(69));
  for (const reserved of ['CON.pdf', 'prn.md', 'AUX.txt', 'NUL', 'COM1.PDF', 'lpt9.pdf', 'CON..pdf',
    'NUL.tar.gz', 'CON.report.pdf', 'COM¹.pdf', 'COM².doc', 'COM³.pdf', 'LPT¹.txt', 'LPT².md', 'LPT³.archive.pdf']) {
    assert.match(sanitizeFilename(reserved), /^plainmile-/i, reserved);
  }
  for (const safe of ['CONTRACT.pdf', 'COM10.pdf', 'LPT0.pdf', 'NUL2.pdf', 'Personal.pdf']) {
    assert.doesNotMatch(sanitizeFilename(safe), /^plainmile-/i, safe);
  }
  assert.equal(sanitizeFilename('...'), 'document');
  for (const reserved of ['NUL.tar.gz', 'CON.report.pdf', 'COM¹.pdf', 'LPT².notes.pdf']) {
    assert.match(workspaceFilenameStem(reserved), /^plainmile-/i, reserved);
  }
  for (const safe of ['COM10.pdf', 'COM¹extra.pdf', 'CONTRACT.pdf', 'LPT²Report.pdf']) {
    assert.doesNotMatch(workspaceFilenameStem(safe), /^plainmile-/i, safe);
  }
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
  assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count: 121 }, 'compress-pdf'),
    error => /120 pages/.test(error.message) && /both text-preserving and JPEG modes/.test(error.message));
  assert.equal(enforceUtilityPdfLimits({ size: 2000, count: 120 }, 'compress-pdf'), true);
  assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count: 121 }, 'compress-pdf', 'zh'),
    error => /120 页/.test(error.message) && /包括保留文字与 JPEG 图片化模式/.test(error.message));
  // A 601-1,000-page source cannot be passed to the separate 600-page Split PDF workspace.
  for (const count of [121, 600]) {
    assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count }, 'compress-pdf'),
      error => /our Split PDF tool/.test(error.message) && /600 pages/.test(error.message));
    assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count }, 'compress-pdf', 'zh'),
      error => /本站拆分 PDF 工具/.test(error.message) && /600 页/.test(error.message));
  }
  for (const count of [601, 1000]) {
    assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count }, 'compress-pdf'),
      error => /another local PDF application/.test(error.message) && /600 pages/.test(error.message));
    assert.throws(() => enforceUtilityPdfLimits({ size: 2000, count }, 'compress-pdf', 'zh'),
      error => /其他本地 PDF 软件/.test(error.message) && /600 页/.test(error.message));
  }
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

test('iOS and desktop-style iPadOS use the safer 4096-pixel canvas bound', () => {
  assert.equal(rasterCanvasSideLimit('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 4096);
  assert.equal(rasterCanvasSideLimit('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 4096);
  assert.equal(rasterCanvasSideLimit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5), 4096);
  assert.equal(rasterCanvasSideLimit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0), 16384);
  assert.equal(rasterCanvasSideLimit('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 16384);
  assert.throws(() => enforceRasterViewport({ width: 4500, height: 300 }, 4096), /too large to rasterize/);
  assert.equal(enforceRasterViewport({ width: 3900, height: 300 }, 4096), true);
});

test('image conversion selects any 60 pages from a 500-page book, not only first 60', () => {
  const selected = requestedPages('301-360', 500);
  assert.equal(selected.length, 60);
  assert.equal(selected[0], 301);
  assert.equal(selected.at(-1), 360);
  assert.equal(enforceImageBatchLimit(selected.length), true);
  assert.throws(() => enforceImageBatchLimit(requestedPages('1-61', 500).length), /60 pages/);
  assert.deepEqual(requestedPages('441-', 500), Array.from({ length: 60 }, (_, i) => 441 + i));
  assert.throws(() => enforceImageBatchLimit(requestedPages('440-', 500).length), /60 pages/);
});

test('PDF image ZIP filename labels preserve localized and nonconsecutive output-page identities', () => {
  assert.equal(imagePageSelectionLabel('３０１－３０６', 500), '301-306');
  assert.equal(imagePageSelectionLabel('２－３，５、７', 10), '2-3_5_7');
  assert.equal(imagePageSelectionLabel('3,1', 20), '3_1');
  assert.equal(imagePageSelectionLabel('5-', 8), '5-8');
  assert.equal(imagePageSelectionLabel('３－，１－２', 5), '3-5_1-2');
  assert.equal(imagePageSelectionLabel('5-,5-', 8), '5-8');
  // ZIP names describe what was actually rendered, not duplicated input.
  assert.equal(imagePageSelectionLabel('1-3,2-4', 8), '1-3_4');
  assert.equal(imagePageSelectionLabel('3,1-2,3', 8), '3_1-2');
  assert.equal(imagePageSelectionLabel('1-3,1-3', 8), '1-3');
  assert.equal(imagePageSelectionLabel('２－３，３－４', 8), '2-3_4');
  assert.equal(imagePageSelectionLabel('1,3,1-5', 8), '1_3_2_4-5');
  assert.equal(imagePageSelectionLabel('', 10), '');
  const longList = Array.from({ length: 60 }, (_, n) => n * 2 + 1).join(',');
  const label = imagePageSelectionLabel(longList, 125);
  assert.match(label, /^selection-first1-last119-60pages$/);
  assert.throws(() => imagePageSelectionLabel('4-1', 5), /reversed/);
});

test('PDF image filenames preserve lexicographic page order on a 1000-page book', () => {
  assert.equal(imagePageFilename(1, 999, 'png'), 'page-001.png');
  assert.equal(imagePageFilename(999, 999, 'jpg'), 'page-999.jpg');
  assert.equal(imagePageFilename(1, 1000, 'png'), 'page-0001.png');
  assert.equal(imagePageFilename(999, 1000, 'jpg'), 'page-0999.jpg');
  assert.equal(imagePageFilename(1000, 1000, 'jpg'), 'page-1000.jpg');
  const generated = [1, 2, 99, 100, 999, 1000].map(n => imagePageFilename(n, 1000));
  assert.deepEqual([...generated].sort(), generated);
  assert.throws(() => imagePageFilename(1001, 1000), /Invalid PDF image/);
  assert.throws(() => imagePageFilename(1, 1001), /Invalid PDF image/);
  assert.throws(() => imagePageFilename(1, 10, 'exe'), /Invalid PDF image/);
});

test('ZIP image filenames preserve custom non-ascending page order when sorted by filename', () => {
  assert.deepEqual(imageExportFilenames([3, 1], 8, 'png'),
    ['order-001-page-003.png', 'order-002-page-001.png']);
  assert.deepEqual(imageExportFilenames([5, 2, 7], 8, 'jpg'),
    ['order-001-page-005.jpg', 'order-002-page-002.jpg', 'order-003-page-007.jpg']);
  assert.deepEqual(imageExportFilenames([301, 300, 1000], 1000, 'jpg'),
    ['order-001-page-0301.jpg', 'order-002-page-0300.jpg', 'order-003-page-1000.jpg']);
  const names = imageExportFilenames([3, 1, 2], 3);
  assert.deepEqual([...names].sort(), names);
  // Existing standard ascending exports and single-image downloads are unchanged.
  assert.deepEqual(imageExportFilenames([1, 3, 5], 8, 'png'),
    ['page-001.png', 'page-003.png', 'page-005.png']);
  assert.deepEqual(imageExportFilenames([1000], 1000), ['page-1000.jpg']);
  assert.throws(() => imageExportFilenames([2, 2], 4), /Invalid PDF image page selection/);
  assert.throws(() => imageExportFilenames([], 4), /Invalid PDF image page selection/);
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
  assert.equal(workspaceFilenameStem('A'.repeat(69) + '.part'), 'A'.repeat(69));
  assert.equal(workspaceFilenameStem('报告．ＰＤＦ'), '报告');
});
