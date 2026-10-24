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
    throw new Error(zh ? '图片化压缩每次最多处理 120 页。长文档请先拆分，避免浏览器耗尽内存。' : 'Image-based compression supports at most 120 pages per run. Split long PDFs first to avoid memory exhaustion.');
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

/** A deterministic ASCII download label for user-chosen page ranges, even
 * when the accepted input used Chinese punctuation or fullwidth digits.
 * Long noncontiguous lists get a truthful compact selection label.
 */
export function imagePageSelectionLabel(input, count) {
  if (!input?.trim()) return '';
  const ranges = parsePageRanges(input, count, UTILITY_LIMITS.maxImagePagesPerRun);
  const label = ranges.map(({ start, end }) =>
    start === end ? String(start) : `${start}-${end}`).join('_');
  if (label.length <= 45) return label;
  const selected = requestedPages(input, count);
  const first = selected[0], last = selected[selected.length - 1];
  return `selection-first${first}-last${last}-${selected.length}pages`;
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
/** Keep ordinary words together during TXT/Markdown PDF layout without
 * sacrificing bounded-width fallback for long URLs, code, or CJK text.
 * Measure one character at a time (linear work), and emit lines lazily so
 * book-length files can still yield to Cancel in the renderer.
 */
export function* wrapTextLines(text, maxWidth, measureChar, { preserveWords = true } = {}) {
  let row = '';
  let rowWidth = 0;
  let lastWordBreak = -1;
  let wrapped = false;
  for (const char of text) {
    const charWidth = measureChar(char);
    const blank = char === ' ' || char === '\t';
    if (row && rowWidth + charWidth > maxWidth) {
      if (!blank && preserveWords && lastWordBreak > 0) {
        // The final word fits on the next line; never split it just because
        // character-by-character layout used up the remaining space.
        yield row.slice(0, lastWordBreak).trimEnd();
        row = row.slice(lastWordBreak).trimStart();
        rowWidth = 0;
        for (const retained of row) rowWidth += measureChar(retained);
      } else {
        yield row.trimEnd();
        row = '';
        rowWidth = 0;
      }
      lastWordBreak = -1;
      wrapped = true;
      if (blank) continue; // A word boundary is not a new line's content.
    }
    if (wrapped && !row && blank) continue;
    if (preserveWords && blank && row && row.at(-1) !== ' ' && row.at(-1) !== '\t') {
      lastWordBreak = row.length;
    }
    row += char;
    rowWidth += charWidth;
  }
  if (row) yield row.trimEnd();
}

export function parseTextBlocks(source, markdown = false) {
  const value = normalizeText(source);
  const blocks = [];
  // CommonMark fences can be longer than three marks and may use tildes.
  // A shorter run, a different mark, or a closing run with trailing text
  // must remain literal CODE rather than silently change later paragraphs.
  let fence = null;
  for (const raw of value.split('\n')) {
    const line = raw.trimEnd();
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
    if (markdown && fence && line.trim()) { blocks.push({ text: line, size: 10, kind: 'code' }); continue; }
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
    if (depth !== 0) continue; // Preserve the malformed link verbatim.
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
  return readableMarkdownReferences(outsideCode)
    // Strip only recognizable HTML tags with syntactically valid attributes.
    // Preserve "List<T>", "<username>", and "a<b && c>d" verbatim.
    .replace(/<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g,
      (token, tag) => tag && !PLAIN_MARKDOWN_HTML_TAGS.has(tag.toLowerCase()) ? token : '')
    // Strip only MATCHED Markdown formatting markers. Removing every '*' and
    // '_' silently corrupts identifiers (user_id), multiplication (a*b) and
    // exponent notation (x**2) in technical reports.
    // Reject marker boundaries *inside* a doubled operator. Otherwise a
    // sequence like "x**2 and y**2" matches the inner single stars and loses
    // one multiplication symbol at each end even though no Markdown emphasis
    // was intended. Preserve scientific notation and unspaced identifiers.
    .replace(/(?<![\p{L}\p{N}_*~])(\*\*|__|~~|`|\*|_)(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}_*~])/gu, '$2')
    .replace(new RegExp(`${marker}(\\d+)${marker}`, 'g'),
      (_token, index) => inlineCode[Number(index)]);
}
export function textContentToLines(content) {
  // PDF is positioned text, not a logical document. Sort approximately by baseline and X.
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim());
  const lines = [];
  for (const item of items) {
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    const fontSize = Math.max(6, Number(item.height) || Math.abs(Number(item.transform?.[3])) || 11);
    let found = lines.find(line => Math.abs(line.y - y) <= Math.max(2, Math.min(line.fontSize, fontSize) * .25));
    if (!found) { found = { y, fontSize, items: [] }; lines.push(found); }
    found.items.push({ x, width: Number(item.width) || 0, str: item.str, fontSize });
    found.fontSize = Math.max(found.fontSize, fontSize);
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
/** Surface incomplete PDF text extraction instead of implying success.
 * A blank page and an image-only/scanned page are indistinguishable by their
 * text layer alone, so report "no selectable text", not "scanned".
 */
export function summarizeTextCoverage(pages) {
  const missingPages = [];
  for (let index = 0; index < pages.length; index++) {
    if (!pages[index].length) missingPages.push(index + 1);
  }
  return { total: pages.length, withText: pages.length - missingPages.length, missingPages };
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
