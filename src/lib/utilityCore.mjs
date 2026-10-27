import { parsePageRanges } from './pageOperations.mjs';

const MiB = 1024 * 1024;
// PDF coordinates are expressed as 72 points per inch. Print export uses
// 220 DPI, but the existing per-page 12 MP and per-batch 64 MiB caps still apply.
export const IMAGE_PRINT_DPI = 220;
export const IMAGE_PRINT_SCALE = IMAGE_PRINT_DPI / 72;
export function validatedImageScale(value) {
  // Reject arbitrary scales from callers rather than bypassing pixel budgets.
  return [1, 1.5, 2, IMAGE_PRINT_SCALE].includes(value) ? value : 1.5;
}

export const UTILITY_LIMITS = Object.freeze({
  maxPdfBytes: 100 * MiB,
  maxPages: 1000,
  maxTextBytes: 5 * MiB,
  maxOutputPages: 1000,
  maxRasterTextPages: 300,
  maxImagePagesPerRun: 60,
  // ZIP generation temporarily duplicates buffers. Keep the accumulated images modest.
  maxImageBatchBytes: 64 * MiB,
  maxCompressionPages: 120,
  // JPEG buffers and PDF serialization coexist in browser memory.
  maxCompressionImageBytes: 96 * MiB,
  maxPixelCount: 12_000_000,
  // Conservative cross-browser maximum; a long narrow poster can be below
  // 12 MP but still exceed the canvas width/height supported by Safari.
  maxCanvasSide: 16_384,
  // iPhone/iPad canvas dimensions can be as low as 4,096 px per axis.
  maxIOSCanvasSide: 4_096,
});

/** Avoid silent browser maxLength truncation on pasted TXT or Markdown.
 * UTF-8 can use more bytes than UTF-16 characters, so validate the exact byte
 * budget; ASCII-length and three-byte upper-bound shortcuts stay inexpensive.
 */
export function textFitsUtf8Budget(value, maxBytes = UTILITY_LIMITS.maxTextBytes) {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) return false;
  if (value.length > maxBytes) return false;
  if (value.length * 3 <= maxBytes) return true;
  return new TextEncoder().encode(value).byteLength <= maxBytes;
}

export function rasterCanvasSideLimit(userAgent = '', maxTouchPoints = 0) {
  // iPadOS can advertise a desktop Macintosh UA, but remains touch-based.
  const ios = /\b(?:iPhone|iPad|iPod)\b/i.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && Number(maxTouchPoints) > 1);
  return ios ? UTILITY_LIMITS.maxIOSCanvasSide : UTILITY_LIMITS.maxCanvasSide;
}

export function enforceRasterViewport({ width, height }, maxSide = UTILITY_LIMITS.maxCanvasSide) {
  const pixelsWide = Math.round(width);
  const pixelsHigh = Math.round(height);
  if (![width, height].every(value => Number.isFinite(value) && value > 0) ||
      pixelsWide > maxSide || pixelsHigh > maxSide ||
      pixelsWide * pixelsHigh > UTILITY_LIMITS.maxPixelCount) {
    throw new Error('This page is too large to rasterize safely.');
  }
  return true;
}

export function enforceUtilityPdfLimits({ size, count }, mode, locale = 'en') {
  const zh = locale === 'zh';
  if (!Number.isFinite(size) || size <= 0 || size > UTILITY_LIMITS.maxPdfBytes) {
    throw new Error(zh ? 'PDF 文件大小须在 1 字节至 100 MB 之间。' : 'PDF must be between 1 byte and 100 MB.');
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > UTILITY_LIMITS.maxPages) {
    throw new Error(zh ? 'PDF 最多支持 1000 页。' : 'PDF must have 1 to 1,000 pages.');
  }
  if (mode === 'compress-pdf' && count > UTILITY_LIMITS.maxCompressionPages) {
    // The focused converter accepts 1,000-page PDFs for text extraction, but
    // the separate visual Split PDF workspace itself stops at 600 pages.
    // Do not send a 601-1,000-page user into a tool that cannot open the file.
    const canSplitOnSite = count <= 600;
    throw new Error(zh
      ? 'PDF 压缩每次最多处理 120 页，包括保留文字与 JPEG 图片化模式。' +
        (canSplitOnSite
          ? '本文件可先使用本站拆分 PDF 工具分段（最多支持 600 页，且受文件大小限制），然后逐份压缩。'
          : '本站拆分 PDF 工具最多支持 600 页；请先使用其他本地 PDF 软件拆分此文件，再逐份压缩。')
      : 'PDF compression supports at most 120 pages per run in both text-preserving and JPEG modes. ' +
        (canSplitOnSite
          ? 'Split this PDF into smaller parts with our Split PDF tool (up to 600 pages, subject to file-size limits), then compress each part.'
          : 'Our Split PDF tool also stops at 600 pages. First divide this file with another local PDF application, then compress the smaller parts.'));
  }
  return true;
}
export function enforceImageBatchLimit(count, locale = 'en') {
  if (!Number.isSafeInteger(count) || count < 1 || count > UTILITY_LIMITS.maxImagePagesPerRun) {
    throw new Error(locale === 'zh' ? '一次最多导出 60 张图片，请使用页码范围分批导出。' : 'Export up to 60 pages per batch. Use page ranges for longer PDFs.');
  }
  return true;
}

// Suggest finite batches rather than silently selecting hundreds of pages to rasterize.
// A batch is only a convenience; users can still enter an arbitrary <=60-page range.
export function checkCancelled(signal) {
  if (signal?.aborted) throw new Error('Processing cancelled.');
}

export function enforceCompressionImageBytes(accumulated, next, locale = 'en') {
  if (!Number.isSafeInteger(accumulated) || !Number.isSafeInteger(next) ||
      accumulated < 0 || next < 0 ||
      accumulated + next > UTILITY_LIMITS.maxCompressionImageBytes) {
    throw new Error(locale === 'zh'
      ? '图片化压缩 JPEG 数据超过 96 MB 安全上限，请降低清晰度或拆分 PDF。'
      : 'Compressed image data exceeds the 96 MB safety limit. Lower quality or split the PDF.');
  }
  return accumulated + next;
}

export function enforceImageBatchBytes(accumulated, next, locale = 'en') {
  if (!Number.isFinite(accumulated) || !Number.isFinite(next) || next < 0 || accumulated < 0 ||
      accumulated + next > UTILITY_LIMITS.maxImageBatchBytes) {
    throw new Error(locale === 'zh'
      ? '本批图片超过 64 MB 内存安全上限。请降低清晰度、改用 JPG 或减少每批页数。'
      : 'Image batch exceeds the 64 MB safety limit. Lower resolution, use JPG, or select fewer pages.');
  }
  return accumulated + next;
}

export function translateUtilityError(error, locale = 'en') {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (locale !== 'zh') return message || 'Processing failed. Please try another file.';
  const translations = [
    [/Processing cancelled/i, '处理已取消，没有下载未完成的文件。'],
    [/too large to rasterize/i, '页面尺寸过大，无法安全转换为图片。请降低分辨率。'],
    [/No selectable text/i, '未找到可提取的文字。扫描版 PDF 需要 OCR，本工具不提供 OCR。'],
    [/Starting page number/i, '起始数字必须是 1 至 99999 之间的整数。'],
    [/First PDF page to number/i, '开始编号的 PDF 页码超出范围，请输入 1 至文件总页数。'],
    [/Page numbers cannot exceed 99999/i, '末页页码不能超过 99999，请减小起始页码。'],
    [/Page is too small for page numbers/i, '页面尺寸太小，无法放下该字号的页码。请调小字号或使用较大的页面。'],
    [/Image encoding failed/i, '图片编码失败，请降低分辨率或改用 JPG。'],
    [/Image batch exceeds/i, '本批图片超过 64 MB 安全上限，请减少选定页数。'],
    [/Compressed image data exceeds/i, '图片化压缩 JPEG 数据超过 96 MB 上限，请降低清晰度或拆分 PDF。'],
    [/reversed|outside|range|invalid page/i, '页码范围无效，请检查起始页、结束页和 PDF 总页数。'],
    [/canvas|memory|allocation/i, '设备内存不足或无法创建图片画布，请减少页数或降低清晰度。'],
  ];
  const translated = translations.find(([pattern]) => pattern.test(message));
  if (translated) return translated[1];
  // Keep already-localized, specific limits (e.g. 100 MB / 1,000 pages).
  if (/[\u3400-\u9fff]/.test(message)) return message;
  return '处理失败，请检查文件内容或尝试更小的文件。';
}

export function imagePageBatch(count, batchIndex = 0) {
  if (!Number.isSafeInteger(count) || count < 1 || count > UTILITY_LIMITS.maxPages) {
    throw new Error('Invalid PDF page count.');
  }
  const total = Math.ceil(count / UTILITY_LIMITS.maxImagePagesPerRun);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= total) {
    throw new Error('Page batch is outside the document.');
  }
  const start = batchIndex * UTILITY_LIMITS.maxImagePagesPerRun + 1;
  const end = Math.min(count, start + UTILITY_LIMITS.maxImagePagesPerRun - 1);
  return { start, end, total, range: `${start}-${end}` };
}

/** Resume standard 60-page batches from a user-entered custom selection.
 * Avoid jumping back to a stale batch counter (often pages 61-120) after the
 * user typed e.g. 301-306. Invalid selections fall back to the last batch.
 */
export function batchIndexFromCustomPages(input, pageCount, fallbackIndex = 0) {
  imagePageBatch(pageCount, fallbackIndex); // Validate existing position too.
  try {
    const chosen = requestedPages(input, pageCount);
    if (chosen.length > 0 && chosen.length <= UTILITY_LIMITS.maxImagePagesPerRun) {
      return Math.floor((chosen[0] - 1) / UTILITY_LIMITS.maxImagePagesPerRun);
    }
  } catch { /* Keep the last valid preset for invalid page ranges. */ }
  return fallbackIndex;
}

export const utilitySlugs = Object.freeze([
  'pdf-to-images', 'compress-pdf', 'pdf-to-txt', 'pdf-to-markdown',
  'txt-to-pdf', 'markdown-to-pdf', 'add-page-numbers',
]);
export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid byte count.');
  return value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(2)} MB`;
}
export function compressionStats(original, candidate) {
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(candidate) || candidate <= 0) throw new Error('Invalid file sizes.');
  return { original, candidate, bytesSaved: Math.max(original - candidate, 0), percent: Math.round((1 - candidate / original) * 1000) / 10, smaller: candidate < original };
}
/**
 * Fast, pure preflight for the page-numbering form. The actual PDF export
 * independently validates these same bounds after parsing PDF bytes; keeping
 * this check browser-local prevents a long book from starting an impossible
 * conversion and preserves an existing generated preview.
 *
 * Returns a reason code instead of a translated string for bilingual UI.
 * Empty number fields are invalid (Number('') would otherwise become 0).
 */
export function validateNumberingPlan(startInput, firstPageInput, pageCount) {
  const start = Number(startInput);
  const firstPage = Number(firstPageInput);
  if (!String(startInput ?? '').trim() || !Number.isSafeInteger(start) ||
      start < 1 || start > 99999) return 'start';
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 ||
      !String(firstPageInput ?? '').trim() || !Number.isSafeInteger(firstPage) ||
      firstPage < 1 || firstPage > pageCount) return 'first';
  if (start + pageCount - firstPage > 99999) return 'overflow';
  return null;
}

export function requestedPages(input, count) {
  if (!input || !input.trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const output = [];
  const seen = new Set();
  for (const { start, end } of parsePageRanges(input, count, UTILITY_LIMITS.maxImagePagesPerRun)) {
    for (let page = start; page <= end; page++) {
      if (seen.has(page)) continue;
      seen.add(page);
      output.push(page);
    }
  }
  return output;
}
/** Stable natural/lexicographic page filenames for extracted images.
 * All filenames in one PDF use the SAME width, including page 1 when a
 * 1,000-page source crosses the three-digit boundary.
 */
export function imagePageFilename(pageNumber, pageCount, format = 'jpg') {
  if (![pageNumber, pageCount].every(Number.isSafeInteger) ||
      pageCount < 1 || pageCount > UTILITY_LIMITS.maxPages ||
      pageNumber < 1 || pageNumber > pageCount || !['jpg', 'png'].includes(format)) {
    throw new Error('Invalid PDF image page or format.');
  }
  const digits = Math.max(3, String(pageCount).length);
  return `page-${String(pageNumber).padStart(digits, '0')}.${format}`;
}

/** Preserve explicitly requested non-ascending image order when users
 * extract ZIP entries in Explorer/Finder, which sort filenames by default.
 * Normal ascending exports keep their established page-001 naming contract.
 */
export function imageExportFilenames(selected, pageCount, format = 'jpg') {
  if (!Array.isArray(selected) || selected.length < 1 ||
      selected.length > UTILITY_LIMITS.maxImagePagesPerRun || new Set(selected).size !== selected.length) {
    throw new Error('Invalid PDF image page selection.');
  }
  const filenames = selected.map(page => imagePageFilename(page, pageCount, format));
  const outOfOrder = selected.some((page, index) => index > 0 && page < selected[index - 1]);
  if (!outOfOrder) return filenames;
  return filenames.map((name, index) => `order-${String(index + 1).padStart(3, '0')}-${name}`);
}

/** Deterministic ZIP label for the pages ACTUALLY exported. Keep each
 * user's original range boundary and order, but omit repeated page positions:
 * "1-3,2-4" exports 1,2,3,4 and labels its ZIP "1-3_4", never "1-3_2-4".
 * The short-label fallback also counts unique output images, not requested
 * positions. Do not change the established labels for non-overlapping inputs.
 */
export function imagePageSelectionLabel(input, count) {
  if (!input?.trim()) return '';
  const ranges = parsePageRanges(input, count, UTILITY_LIMITS.maxImagePagesPerRun);
  const seen = new Set();
  const segments = [];
  for (const range of ranges) {
    let first = null;
    let last = null;
    for (let page = range.start; page <= range.end; page++) {
      if (seen.has(page)) {
        if (first !== null) segments.push({ start: first, end: last });
        first = last = null;
        continue;
      }
      seen.add(page);
      if (first === null) first = page;
      last = page;
    }
    if (first !== null) segments.push({ start: first, end: last });
  }
  const label = segments.map(({ start, end }) =>
    start === end ? String(start) : `${start}-${end}`).join('_');
  if (label.length <= 45) return label;
  const selected = [...seen];
  return `selection-first${selected[0]}-last${selected.at(-1)}-${selected.length}pages`;
}

/** Decode imported text without silently replacing damaged characters.
 * File.text() assumes UTF-8, corrupting Windows UTF-16 (Unicode) files.
 * UTF-16 needs a BOM; unmarked text defaults to strict UTF-8.
 */
export function decodeImportedText(bytes, locale = 'en') {
  const invalid = () => {
    throw new Error(locale === 'zh'
      ? '文本编码无法识别。请将文件另存为 UTF-8，或带 BOM 的 UTF-16 LE/BE 格式后重新导入。'
      : 'Text encoding is not valid UTF-8 or BOM-marked UTF-16 LE/BE. Re-save the file as UTF-8 and import it again.');
  };
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) invalid();
  // Explicitly reject UTF-32 BOMs before their first two bytes look like
  // UTF-16; silently decoding those would produce invalid control characters.
  if (bytes.length >= 4 && (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )) invalid();
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
    : 'utf-8';
  try {
    // fatal=true prevents mojibake/replacement-glyph PDF generation.
    // TextDecoder consumes a BOM automatically, so it is not inserted in the editor.
    const content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    // UTF-16 without a BOM decodes to interspersed U+0000 under UTF-8;
    // don't mistake it for normal text and silently strip the NULs later.
    if (content.includes('\0')) invalid();
    return content;
  } catch {
    invalid();
  }
}

export function normalizeText(source) {
  return source.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/\t/g, '    ');
}
/** Unicode grapheme clusters are the smallest units safe to wrap: a Latin
 * letter plus its combining accent, a flag pair, or a ZWJ emoji must never
 * be split onto different PDF lines. Keep plain ASCII on the lightweight
 * iterator so long English books don't pay the Segmenter cost.
 */
const textGraphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function* textGraphemes(source) {
  if (!textGraphemeSegmenter || /^[\x00-\x7f]*$/.test(source)) {
    yield* source;
    return;
  }
  for (const { segment } of textGraphemeSegmenter.segment(source)) yield segment;
}

/** Keep ordinary words together during TXT/Markdown PDF layout without
 * sacrificing bounded-width fallback for long URLs, code, or CJK text.
 * Measure one grapheme at a time (linear work), and emit lines lazily so
 * book-length files can still yield to Cancel in the renderer.
 */
export function* wrapTextLines(text, maxWidth, measureChar, { preserveWords = true } = {}) {
  let row = '';
  let rowWidth = 0;
  let lastWordBreak = -1;
  let wrapped = false;
  for (const char of textGraphemes(text)) {
    const charWidth = measureChar(char);
    const blank = char === ' ' || char === '\t';
    if (row && rowWidth + charWidth > maxWidth) {
      if (!blank && preserveWords && lastWordBreak > 0) {
        // Prefer a word boundary, but a long wide-glyph token may STILL
        // overflow after the prefix is removed. Fall back to a hard wrap
        // instead of painting characters beyond the PDF's right margin.
        yield row.slice(0, lastWordBreak).trimEnd();
        row = row.slice(lastWordBreak).trimStart();
        rowWidth = 0;
        for (const retained of textGraphemes(row)) rowWidth += measureChar(retained);
        if (row && rowWidth + charWidth > maxWidth) {
          yield row.trimEnd();
          row = '';
          rowWidth = 0;
        }
      } else {
        // Markdown fenced code is literal text: trailing and leading spaces
        // at a visual line break must not be silently discarded.
        yield preserveWords ? row.trimEnd() : row;
        row = '';
        rowWidth = 0;
      }
      lastWordBreak = -1;
      wrapped = true;
      if (blank && preserveWords) continue; // Prose collapses wrap-boundary whitespace.
    }
    if (wrapped && !row && blank && preserveWords) continue;
    if (preserveWords && blank && row && row.at(-1) !== ' ' && row.at(-1) !== '\t') {
      lastWordBreak = row.length;
    }
    row += char;
    rowWidth += charWidth;
  }
  if (row) yield preserveWords ? row.trimEnd() : row;
}

export function parseTextBlocks(source, markdown = false) {
  const value = normalizeText(source);
  const blocks = [];
  // CommonMark fences can be longer than three marks and may use tildes.
  // A shorter run, a different mark, or a closing run with trailing text
  // must remain literal CODE rather than silently change later paragraphs.
  let fence = null;
  for (const raw of value.split('\n')) {
    // Prose may normalize trailing whitespace, but fenced code is literal.
    // Keep trailing spaces and whitespace-only lines inside a code fence:
    // trimming here destroys them before the PDF wrapping step can help.
    const line = markdown && fence ? raw : raw.trimEnd();
    if (markdown) {
      if (fence) {
        const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (closing && closing[1][0] === fence.mark && closing[1].length >= fence.length) {
          fence = null;
          continue;
        }
      } else {
        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
          fence = { mark: opening[1][0], length: opening[1].length };
          continue;
        }
      }
    }
    if (markdown && fence) { blocks.push({ text: line, size: 10, kind: 'code' }); continue; }
    if (!line.trim()) { blocks.push({ text: '', size: 12, kind: 'gap' }); continue; }
    if (markdown && /^\s{0,3}#{1,3} /.test(line)) {
      const match = /^\s{0,3}(#{1,3})\s+(.*)$/.exec(line);
      blocks.push({ text: stripMarkdownInline(match[2]), size: [0, 21, 17, 14][match[1].length], kind: 'heading' });
    } else if (markdown && /^\s*(?:[-*+] |\d+[.)] )/.test(line)) {
      const match = /^\s*(?:[-*+]|(\d+)[.)])\s+(.+)$/.exec(line);
      const prefix = match[1] ? `${match[1]}. ` : '• ';
      blocks.push({ text: prefix + stripMarkdownInline(match[2]), size: 11, kind: 'list' });
    } else if (markdown && /^\s*>\s*/.test(line)) {
      blocks.push({ text: '> ' + stripMarkdownInline(line.replace(/^\s*>\s*/, '')), size: 11, kind: 'quote' });
    } else if (markdown && /^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ text: '--------------------', size: 11, kind: 'rule' });
    } else {
      blocks.push({ text: markdown ? stripMarkdownInline(line) : line, size: 11, kind: 'paragraph' });
    }
  }
  return blocks;
}
// Accept conventional HTML formatting tags only: technical Markdown often
// contains C++/TypeScript generics, XML-like placeholders, or unspaced
// comparisons which must not disappear as if they were arbitrary HTML.
const PLAIN_MARKDOWN_HTML_TAGS = new Set(
  'a abbr article aside b blockquote br code del div em h1 h2 h3 h4 h5 h6 hr i img input li ol p pre s script section small span strong style table tbody td th thead tr u ul'.split(' '),
);
// Show Markdown link destinations as plain PDF text. We don't create PDF link
// annotations or fetch remote images, but must not silently lose URL data.
// A bounded label match keeps malformed book-length input inexpensive;
// balanced parentheses handle common Wikipedia and documentation URLs.
function readableMarkdownReferences(source) {
  const opening = /!?\[([^\]\n]{0,512})\]\(/g;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = opening.exec(source))) {
    let depth = 1;
    let at = opening.lastIndex;
    while (at < source.length && depth > 0 && source[at] !== '\n') {
      if (source[at] === '\\' && at + 1 < source.length) { at += 2; continue; }
      if (source[at] === '(') depth++;
      else if (source[at] === ')') depth--;
      at++;
    }
    if (depth !== 0) {
      // No closing parenthesis exists before this line ends. Retrying each
      // nested-looking "[label](" would rescan the same suffix repeatedly
      // (quadratic work on user-pasted malformed Markdown). Treat the rest
      // of this line as literal text; resume matching on the next line.
      opening.lastIndex = at;
      continue;
    }
    const target = source.slice(opening.lastIndex, at - 1).trim()
      .replace(/\s+(?:"[^"]*"|'[^']*')$/, '').trim();
    const label = match[1].trim();
    const visible = label || target;
    result += source.slice(cursor, match.index) +
      (target && target !== visible ? `${visible} (${target})` : visible);
    cursor = at;
    opening.lastIndex = at;
  }
  return result + source.slice(cursor);
}

// Pre-index valid emphasis closers once per line. A lazy regex searching the
// suffix from every unclosed '*' or '_' causes quadratic browser work.
const INLINE_MARKS = ['**', '__', '~~', String.fromCharCode(96), '*', '_'];
const INLINE_MARK_CHARS = '*_~' + String.fromCharCode(96);
const INLINE_BOUNDARY = /[\p{L}\p{N}_*~]/u;
const INLINE_SPACE = /\s/u;
function inlinePreviousCharacter(line, at) {
  const last = line.charCodeAt(at - 1);
  // Match Unicode code points (including astral letters) at boundaries.
  return at >= 2 && last >= 0xdc00 && last <= 0xdfff &&
    line.charCodeAt(at - 2) >= 0xd800 && line.charCodeAt(at - 2) <= 0xdbff
    ? line.slice(at - 2, at) : line[at - 1];
}
function inlineNextCharacter(line, at) {
  const point = line.codePointAt(at);
  return point === undefined ? '' : String.fromCodePoint(point);
}
function stripPairedMarkdownMarkers(source) {
  return source.split('\n').map(line => {
    const closers = new Map(INLINE_MARKS.map(mark => [mark, []]));
    for (let at = 1; at < line.length; at++) {
      const char = line[at];
      if (!INLINE_MARK_CHARS.includes(char) ||
          INLINE_SPACE.test(inlinePreviousCharacter(line, at))) continue;
      for (const mark of INLINE_MARKS) {
        if (mark[0] !== char || !line.startsWith(mark, at) ||
            INLINE_BOUNDARY.test(inlineNextCharacter(line, at + mark.length))) continue;
        closers.get(mark).push(at);
      }
    }
    let output = '', cursor = 0;
    for (let at = 0; at < line.length;) {
      const char = line[at];
      if (!INLINE_MARK_CHARS.includes(char) ||
          (at > 0 && INLINE_BOUNDARY.test(inlinePreviousCharacter(line, at)))) {
        at++;
        continue;
      }
      let matched = false;
      for (const mark of INLINE_MARKS) {
        if (mark[0] !== char || !line.startsWith(mark, at)) continue;
        const next = inlineNextCharacter(line, at + mark.length);
        if (!next || INLINE_SPACE.test(next)) continue;
        const candidates = closers.get(mark);
        const minEnd = at + mark.length + 1;
        let low = 0, high = candidates.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (candidates[middle] < minEnd) low = middle + 1;
          else high = middle;
        }
        if (low === candidates.length) continue;
        const end = candidates[low];
        output += line.slice(cursor, at) + line.slice(at + mark.length, end);
        cursor = end + mark.length;
        at = cursor;
        matched = true;
        break;
      }
      if (!matched) at++;
    }
    return output + line.slice(cursor);
  }).join('\n');
}

/** Scan HTML comments and HTML tags left-to-right without quadratic
 * retries on malformed '<!--'. Preserve unknown tags exactly, including
 * comment-looking text inside their quoted attribute values.
 */
// Match HTML tags only at the current '<' to preserve the original
// leftmost-alternative behavior, including unknown tags whose attributes
// contain comment-like text. Sticky matching never scans past this position.
const MARKDOWN_HTML_TAG_AT = /<\/?([A-Za-z][\w:-]*)(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/y;

function stripKnownMarkdownHtml(source) {
  const parts = [];
  let cursor = 0;
  let searchFrom = 0;
  let noCommentCloser = false;
  while (searchFrom < source.length) {
    const start = source.indexOf('<', searchFrom);
    if (start < 0) break;
    if (!noCommentCloser && source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      if (end >= 0) {
        parts.push(source.slice(cursor, start));
        cursor = end + 3;
        searchFrom = cursor;
        continue;
      }
      // There are no more comment closers anywhere in this suffix.
      // Do not re-search the same tail from subsequent malformed openers.
      noCommentCloser = true;
    }
    MARKDOWN_HTML_TAG_AT.lastIndex = start;
    const match = MARKDOWN_HTML_TAG_AT.exec(source);
    if (match) {
      if (PLAIN_MARKDOWN_HTML_TAGS.has(match[1].toLowerCase())) {
        parts.push(source.slice(cursor, start));
        cursor = MARKDOWN_HTML_TAG_AT.lastIndex;
      }
      // Unknown HTML-like tags are literal technical text. Skip the whole
      // token so a comment marker within a quoted attribute is not stripped.
      searchFrom = MARKDOWN_HTML_TAG_AT.lastIndex;
      continue;
    }
    searchFrom = start + 1;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

// Intentionally a minimal CommonMark subset: never execute HTML, remote images or scripts.
export function stripMarkdownInline(source) {
  // Shield single-backtick inline code before stripping links, HTML or emphasis.
  // Those tokens are literal text (e.g. `<strong>`, not an HTML element).
  const inlineCode = [];
  let marker = '\uE000';
  while (source.includes(marker)) marker = String.fromCharCode(marker.charCodeAt(0) + 1);
  const outsideCode = source.replace(/`([^`\n]+)`/g, (_token, literal) => {
    return `${marker}${inlineCode.push(literal) - 1}${marker}`;
  });
  const plain = stripKnownMarkdownHtml(readableMarkdownReferences(outsideCode));
  return stripPairedMarkdownMarkers(plain)
    .replace(new RegExp(`${marker}(\\d+)${marker}`, 'g'),
      (_token, index) => inlineCode[Number(index)]);
}
export function textContentToLines(content) {
  // PDF is positioned text, not a logical document. Sort approximately by baseline and X.
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim());
  const lines = [];
  // PDF.js can emit thousands of positioned fragments. Scanning ALL existing
  // rows for every fragment is quadratic on book-length/dense-text PDFs.
  // Index each row by its initial Y coordinate in narrow vertical bands.
  // Exact original tolerance, first-created row tie-breaking and text order
  // remain unchanged; unusual huge fonts/non-finite coordinates fall back to
  // the original full scan rather than silently losing or reordering text.
  const BAND_HEIGHT = 8;
  const rowsByBand = new Map();
  let largestRowFont = 0;
  for (const item of items) {
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    const fontSize = Math.max(6, Number(item.height) || Math.abs(Number(item.transform?.[3])) || 11);
    const searchRadius = Math.max(2, Math.min(largestRowFont, fontSize) * .25);
    const firstBand = Math.floor((y - searchRadius) / BAND_HEIGHT);
    const lastBand = Math.floor((y + searchRadius) / BAND_HEIGHT);
    let found = null;
    if (Number.isFinite(y) && Number.isFinite(searchRadius) &&
        Number.isSafeInteger(firstBand) && Number.isSafeInteger(lastBand) &&
        lastBand - firstBand + 1 <= lines.length) {
      for (let band = firstBand; band <= lastBand; band++) {
        for (const row of rowsByBand.get(band) ?? []) {
          if ((!found || row.order < found.order) &&
              Math.abs(row.y - y) <= Math.max(2, Math.min(row.fontSize, fontSize) * .25)) {
            found = row;
          }
        }
      }
    } else {
      found = lines.find(row =>
        Math.abs(row.y - y) <= Math.max(2, Math.min(row.fontSize, fontSize) * .25)) ?? null;
    }
    if (!found) {
      found = { y, fontSize, items: [], order: lines.length };
      lines.push(found);
      const band = Math.floor(y / BAND_HEIGHT);
      if (Number.isSafeInteger(band)) {
        const rows = rowsByBand.get(band);
        if (rows) rows.push(found);
        else rowsByBand.set(band, [found]);
      }
    }
    found.items.push({ x, width: Number(item.width) || 0, str: item.str, fontSize });
    found.fontSize = Math.max(found.fontSize, fontSize);
    largestRowFont = Math.max(largestRowFont, found.fontSize);
  }
  return lines.sort((a, b) => b.y - a.y).map(line => {
    const sorted = line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = null;
    for (const item of sorted) {
      if (previousEnd !== null && item.x - previousEnd > Math.max(2, item.fontSize * .2) && !/\s$/.test(text)) text += ' ';
      text += item.str;
      previousEnd = Math.max(previousEnd ?? item.x, item.x + item.width);
    }
    return { text: text.trim(), fontSize: line.fontSize };
  }).filter(line => line.text);
}

/** PDF text is positioned, not semantically ordered. On /Rotate 90/180/270
 * pages raw user-space Y/X do not match visible rows/columns. The optional
 * PDF.js viewport maps text origins into visible page coordinates first.
 * Row reading order remains the default for tables; explicit two-column modes
 * handle left/right article layout. Complex layouts remain approximate.
 */
export function textContentToReadingOrderLines(content, order = 'rows', viewport = null) {
  if (!['rows', 'left-first', 'right-first'].includes(order)) throw new Error('Unsupported PDF text reading order.');
  // Preserve the existing fast path for unrotated PDF pages.
  if (order === 'rows' && !viewport) return textContentToLines(content);
  if (!viewport || !Number.isFinite(viewport.width) || viewport.width <= 0 ||
      typeof viewport.convertToViewportPoint !== 'function') {
    throw new Error('PDF page viewport is required for visual reading order.');
  }
  const rows = [];
  const columns = [[], []];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const x = Number(item.transform?.[4]);
    const y = Number(item.transform?.[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      // Return original approximate order rather than silently dropping text.
      return textContentToLines(content);
    }
    const [visibleX, visibleY] = viewport.convertToViewportPoint(x, y);
    if (!Number.isFinite(visibleX) || !Number.isFinite(visibleY)) return textContentToLines(content);
    const normalized = {
      ...item,
      transform: [0, 0, 0, 0, visibleX, -visibleY],
    };
    if (order === 'rows') rows.push(normalized);
    else columns[visibleX < viewport.width / 2 ? 0 : 1].push(normalized);
  }
  if (order === 'rows') return textContentToLines({ items: rows });
  const ordered = order === 'left-first' ? columns : [columns[1], columns[0]];
  return ordered.flatMap(items => textContentToLines({ items }));
}
/** A small selectable page number is not evidence that the body of a
 * scanned page was extracted. Check only non-whitespace text, not line count.
 */
export function hasMinimalSelectableText(lines, maxCharacters = 10) {
  if (!Array.isArray(lines) || !lines.length) return false;
  const text = lines.map(line => String(line.text ?? '')).join(' ').replace(/\s+/gu, ' ').trim();
  if (!text) return false;
  // A page-number-only layer is common on scanned books, including "Page 1 of 1000".
  if (/^(?:(?:page|p\.)\s*)?\d{1,5}(?:\s*(?:of|\/)\s*\d{1,5})?$/iu.test(text) ||
      /^第\s*\d{1,5}\s*页$/u.test(text)) return true;
  return text.replace(/\s/gu, '').length <= maxCharacters;
}

// A scan may contain a whole-page raster image but still have a footer or
// running header longer than the ten-character "page number only" heuristic.
// Only do the extra image-operator check for such sparse, short-line pages;
// we do not claim that any image is definitely OCR text.
export function hasSparseTextScanRisk(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 3) return false;
  if (hasMinimalSelectableText(lines)) return true;
  const text = lines.map(line => String(line.text ?? '')).join(' ').replace(/\s+/gu, ' ').trim();
  if (!text) return false;
  const length = text.replace(/\s/gu, '').length;
  if (length <= 26) return true;
  // Longer running headers still often include an explicit page label.
  // Never scan a page containing an ordinary full paragraph just because
  // the body mentions "Page 12".
  return length <= 120 &&
    /(?:\b(?:page|p\.)\s*\d{1,5}(?:\s*(?:of|\/)\s*\d{1,5})?|第\s*\d{1,5}\s*页)/iu.test(text);
}

/** Filled text and dropdown widget values live in PDF annotations, not
 * necessarily in the page text stream. Include only visible form values that
 * PDF.js exposes; do not invent values for checkbox, radio or signature widgets.
 */
export function textLinesFromFormAnnotations(annotations) {
  const lines = [];
  const seen = new Set();
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (!annotation || !['Tx', 'Ch'].includes(annotation.fieldType)) continue;
    const raw = Array.isArray(annotation.fieldValue)
      ? annotation.fieldValue : [annotation.fieldValue];
    const value = raw.filter(part => typeof part === 'string' && part.trim()).join(', ');
    if (!value) continue;
    const label = String(annotation.fieldName || annotation.alternativeText || 'Form field').trim() || 'Form field';
    const text = `${label}: ${value}`;
    if (!seen.has(text)) {
      lines.push({ text, fontSize: 12 });
      seen.add(text);
    }
  }
  return lines;
}

/** Surface empty pages and image-backed pages with almost no selectable text.
 * An image may be a photograph rather than a scan; callers must describe
 * suspicious pages as "review required", not claim OCR detection certainty.
 */
export function summarizeTextCoverage(pages, sparseImagePageNumbers = []) {
  const missingPages = [];
  const suspectPages = [];
  const imagePages = new Set(sparseImagePageNumbers);
  for (let index = 0; index < pages.length; index++) {
    if (!pages[index].length) missingPages.push(index + 1);
    else if (imagePages.has(index + 1) && hasSparseTextScanRisk(pages[index])) {
      suspectPages.push(index + 1);
    }
  }
  return { total: pages.length, withText: pages.length - missingPages.length, missingPages, suspectPages };
}

export function linesToReadableText(pages, markdown = false) {
  const heights = pages.flat().map(x => x.fontSize).filter(x => x > 0);
  const normal = heights.length ? heights.sort((a, b) => a - b)[Math.floor((heights.length - 1) / 2)] : 12;
  return pages.map((page, index) => {
    const lines = page.map(line => {
      if (markdown && line.fontSize > normal * 1.35 && line.text.length < 125) return `## ${line.text}`;
      return line.text;
    });
    const body = lines.join('\n');
    return markdown && pages.length > 1 ? `<!-- Page ${index + 1} -->\n${body}` : body;
  }).join('\n\n');
}
// Windows also reserves device names with ANY extension (e.g. NUL.tar.gz)
// and superscript digits in COM¹/²/³ and LPT¹/²/³. The matched device part
// must end or be followed by a dot; COM10 and CONTRACT remain valid filenames.
const WINDOWS_RESERVED_DEVICE_STEM = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;

/** Sanitize a user-supplied output stem locally, never treat it as a path.
 * A missing or punctuation-only input leaves the suggested name untouched.
 * Users can type ".pdf" once without accidentally generating ".pdf.pdf".
 */
export function workspaceFilenameStem(input, fallback = '') {
  if (typeof input !== 'string' || !input.trim()) return fallback;
  const withoutExtension = input.normalize('NFKC').trim().replace(/\.pdf$/i, '');
  const stem = withoutExtension.replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/g, '').slice(0, 70);
  if (!stem) return fallback;
  // These names are reserved on Windows even when given a PDF extension.
  return WINDOWS_RESERVED_DEVICE_STEM.test(stem)
    ? `plainmile-${stem}` : stem;
}
/** Deterministic ZIP entry names for a *confirmed* bookmark-derived split.
 * A fixed ordinal and the real output page range ensure uniqueness, even
 * when the PDF contains duplicate, malicious or empty bookmark titles.
 * The caller must confirm the current page order and range plan still match.
 */
export function bookmarkSplitPartFilenames(parts, chapters) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 50 ||
      !Array.isArray(chapters)) {
    throw new Error('Invalid bookmark split filenames.');
  }
  const titles = new Map();
  for (const chapter of chapters) {
    if (!Number.isSafeInteger(chapter?.page) || chapter.page < 1 ||
        typeof chapter.title !== 'string') continue;
    if (!titles.has(chapter.page)) titles.set(chapter.page, chapter.title);
  }
  return parts.map((part, index) => {
    if (!Number.isSafeInteger(part?.start) || !Number.isSafeInteger(part?.end) ||
        part.start < 1 || part.end < part.start || part.end > 600) {
      throw new Error('Invalid bookmark output range.');
    }
    const title = workspaceFilenameStem(titles.get(part.start) ?? '', '').slice(0, 48);
    return `part-${String(index + 1).padStart(2, '0')}${title ? '-' + title : ''}-pages-${part.start}-${part.end}.pdf`;
  });
}

export function sanitizeFilename(filename) {
  const stem = (filename || 'document').replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70)
    .replace(/\.+$/g, '') || 'document';
  // Windows reserves device names even when followed by .pdf, .txt or .md.
  // The workspace custom-name field already guards these; utility-generated
  // converter filenames must follow the same rule.
  return WINDOWS_RESERVED_DEVICE_STEM.test(stem)
    ? `plainmile-${stem}` : stem;
}
