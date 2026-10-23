import { parsePageRanges } from './pageOperations.mjs';

const MiB = 1024 * 1024;
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
});

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
    [/Starting page number/i, '起始页码必须是 1 至 99999 之间的整数。'],
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
export function normalizeText(source) {
  return source.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/\t/g, '    ');
}
export function parseTextBlocks(source, markdown = false) {
  const value = normalizeText(source);
  const blocks = [];
  let fenced = false;
  for (const raw of value.split('\n')) {
    const line = raw.trimEnd();
    if (markdown && /^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (!line.trim()) { blocks.push({ text: '', size: 12, kind: 'gap' }); continue; }
    if (markdown && fenced) { blocks.push({ text: line, size: 10, kind: 'code' }); continue; }
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
// Intentionally a minimal CommonMark subset: never execute HTML, remote images or scripts.
export function stripMarkdownInline(source) {
  return source.replace(/!?\[([^\]]+)\]\([^\n)]+\)/g, '$1')
    .replace(/(?:\*\*|__|\*|_|~~|`)/g, '').replace(/<[^>]+>/g, '');
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
export function sanitizeFilename(filename) {
  return (filename || 'document').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70) || 'document';
}
