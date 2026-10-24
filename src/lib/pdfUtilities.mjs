import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { pageNumberPlacement } from './pageNumberGeometry.mjs';
import {
  UTILITY_LIMITS, validatedImageScale, enforceRasterViewport, requestedPages, parseTextBlocks, textContentToLines,
  linesToReadableText, summarizeTextCoverage, compressionStats, enforceUtilityPdfLimits, enforceImageBatchLimit,
  enforceImageBatchBytes, enforceCompressionImageBytes, checkCancelled,
} from './utilityCore.mjs';

export async function loadPdf(file, mode = 'pdf-to-txt', locale = 'en') {
  if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) {
    throw new Error(locale === 'zh' ? '请选择 PDF 文件。' : 'Choose a PDF file.');
  }
  // Check size BEFORE allocating a large ArrayBuffer or PDF.js worker.
  if (!file.size || file.size > UTILITY_LIMITS.maxPdfBytes) {
    enforceUtilityPdfLimits({ size: file.size, count: 1 }, mode, locale);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Use PDF.js for page counting rather than eagerly parsing a potentially 100 MB
  // document in pdf-lib as well. The actual page-number operation loads pdf-lib later.
  let document;
  try {
    document = await openPdfJs(bytes);
  } catch {
    throw new Error(locale === 'zh' ? 'PDF 无法打开，文件可能损坏或有密码保护。' : 'The PDF is damaged or password-protected.');
  }
  try {
    enforceUtilityPdfLimits({ size: file.size, count: document.count }, mode, locale);
    return { bytes, count: document.count, size: file.size, name: file.name };
  } finally {
    await document.destroy();
  }
}

async function openPdfJs(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  // Pass a copy: PDF.js transfers its buffer to its worker.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const proxy = await loadingTask.promise;
    // The loading task owns the worker and its memory, not the PDFDocumentProxy.
    return { count: proxy.numPages, getPage: (number) => proxy.getPage(number), destroy: () => loadingTask.destroy() };
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

function freeCanvas(canvas) { if (canvas) { canvas.width = 1; canvas.height = 1; } }

async function renderPageAsBlob(page, format = 'image/jpeg', scale = 1.5, quality = .8, signal) {
  checkCancelled(signal);
  const viewport = page.getViewport({ scale });
  enforceRasterViewport(viewport);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is not available.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const task = page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' });
    const abort = () => task.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try { await task.promise; checkCancelled(signal); }
    catch (error) { checkCancelled(signal); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed.')), format, quality));
  } finally { freeCanvas(canvas); }
}

export async function convertPdfToImages(pdf, options = {}, reportProgress = () => {}) {
  const format = options.format === 'png' ? 'png' : 'jpg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const scale = validatedImageScale(options.scale);
  const selected = requestedPages(options.pages ?? '', pdf.count);
  enforceImageBatchLimit(selected.length, options.locale);
  const document = await openPdfJs(pdf.bytes);
  const files = [];
  let accumulated = 0;
  try {
    for (const index of selected) {
      checkCancelled(options.signal);
      const page = await document.getPage(index);
      try {
        const blob = await renderPageAsBlob(page, mime, scale, .87, options.signal);
        accumulated = enforceImageBatchBytes(accumulated, blob.size, options.locale);
        files.push({ name: `page-${String(index).padStart(3, '0')}.${format}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      } finally { page.cleanup(); }
      reportProgress(files.length, selected.length);
    }
  } finally { await document.destroy(); }
  checkCancelled(options.signal);
  if (files.length === 1) return { ...files[0], mime, count: 1 };
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  reportProgress(files.length, files.length, 'packaging');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: true }, meta => {
    checkCancelled(options.signal);
    options.onPackagingProgress?.(Math.round(meta.percent));
  });
  checkCancelled(options.signal);
  return { name: 'pdf-pages.zip', bytes, mime: 'application/zip', count: files.length };
}

// Honest, intentionally lossy raster recompression: no promise to keep searchable text,
// internal links, annotations, form fields or digital signatures. Never auto-download if larger.
export async function compressPdfRaster(pdf, options = {}, reportProgress = () => {}) {
  const scale = options.scale === 1.5 ? 1.5 : options.scale === 1 ? 1 : .75;
  const quality = options.quality === .8 ? .8 : options.quality === .55 ? .55 : .7;
  enforceUtilityPdfLimits(pdf, 'compress-pdf', options.locale);
  const source = await openPdfJs(pdf.bytes);
  const output = await PDFDocument.create();
  let jpegBytes = 0;
  try {
    for (let i = 1; i <= pdf.count; i++) {
      checkCancelled(options.signal);
      const page = await source.getPage(i);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const jpeg = await renderPageAsBlob(page, 'image/jpeg', scale, quality, options.signal);
        checkCancelled(options.signal);
        jpegBytes = enforceCompressionImageBytes(jpegBytes, jpeg.size, options.locale);
        // JPEG data is embedded as-is; once this lower bound exceeds the original,
        // further page rendering cannot produce a smaller document.
        if (jpegBytes >= pdf.size) {
          reportProgress(i, pdf.count);
          return { bytes: null, stats: { ...compressionStats(pdf.size, jpegBytes), lowerBound: true } };
        }
        const embedded = await output.embedJpg(await jpeg.arrayBuffer());
        const target = output.addPage([viewport.width, viewport.height]);
        target.drawImage(embedded, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      } finally { page.cleanup(); }
      reportProgress(i, pdf.count);
    }
    checkCancelled(options.signal);
    const bytes = new Uint8Array(await output.save({ useObjectStreams: true }));
    checkCancelled(options.signal);
    const stats = compressionStats(pdf.size, bytes.length);
    // Do not hand a bigger, unusable PDF to React state.
    return { bytes: stats.smaller ? bytes : null, stats };
  } finally { await source.destroy(); }
}

export async function extractPdfText(pdf, markdown = false, reportProgress = () => {}, signal, onAudit = () => {}) {
  const document = await openPdfJs(pdf.bytes);
  const pages = [];
  try {
    for (let i = 1; i <= pdf.count; i++) {
      checkCancelled(signal);
      const page = await document.getPage(i);
      try { pages.push(textContentToLines(await page.getTextContent())); }
      finally { page.cleanup(); }
      reportProgress(i, pdf.count);
    }
  } finally { await document.destroy(); }
  const coverage = summarizeTextCoverage(pages);
  if (!coverage.withText) throw new Error('No selectable text found. Scanned PDFs require OCR, which this tool does not provide.');
  checkCancelled(signal);
  onAudit(coverage); // Never report a complete extraction when pages were omitted.
  return linesToReadableText(pages, markdown);
}

export async function addPageNumbers(pdf, opts = {}, reportProgress = () => {}) {
  const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize === 16 ? 16 : opts.fontSize === 10 ? 10 : 12;
  const start = Number(opts.start ?? 1);
  if (!Number.isSafeInteger(start) || start < 1 || start > 99999) throw new Error('Starting page number must be from 1 to 99999.');
  if (start + doc.getPageCount() - 1 > 99999) throw new Error('Page numbers cannot exceed 99999. Lower the starting number.');
  const position = ['bottom-center', 'bottom-right', 'top-right'].includes(opts.position) ? opts.position : 'bottom-center';
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    // Yield while numbering books: otherwise the browser cannot dispatch
    // the Cancel click until all synchronous page annotations are finished.
    if (i > 0 && i % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    checkCancelled(opts.signal);
    const page = doc.getPage(i);
    const box = page.getCropBox();
    const text = String(start + i);
    const textWidth = font.widthOfTextAtSize(text, size);
    // Use visible page coordinates, compensating PDF /Rotate and CropBox origin.
    const placement = pageNumberPlacement(box, page.getRotation().angle, textWidth, size, position);
    page.drawText(text, { x: placement.x, y: placement.y, rotate: degrees(placement.rotation), font, size, color: rgb(.28, .33, .39) });
    reportProgress(i + 1, pageCount);
  }
  checkCancelled(opts.signal);
  const bytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
  checkCancelled(opts.signal);
  return bytes;
}

// Latin text uses real searchable PDF text. For arbitrary Unicode/CJK characters,
// render with browser's LOCAL fonts as page images to avoid missing glyphs.
export async function textToPdf(text, markdown = false, options = {}) {
  checkCancelled(options.signal);
  const blocks = parseTextBlocks(text, markdown);
  // Trailing newlines are common in pasted TXT/Markdown. They must not create
  // a final, entirely blank PDF page or exhaust long-document page limits.
  // Keep interior blank lines: those can separate real paragraphs.
  while (blocks.at(-1)?.kind === 'gap') blocks.pop();
  if (!blocks.some(b => b.text.trim())) throw new Error('Enter some text first.');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const unicode = blocks.some(b => {
    try { regular.encodeText(b.text); return false; } catch { return true; }
  });
  const pdfWidth = 595.28, pdfHeight = 841.89, margin = 46;
  const bodyWidth = pdfWidth - margin * 2;
  const scale = unicode ? 2 : 1;
  const canvas = unicode ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (unicode && !ctx) throw new Error('Canvas is unavailable for Unicode text.');
  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  if (!measure) throw new Error('Canvas is unavailable.');
  let pdfPage = null, y = 0, totalPages = 0;
  async function finishPage() {
    checkCancelled(options.signal);
    if (unicode && pdfPage && canvas) {
      const jpg = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Text rendering failed.')), 'image/jpeg', .92));
      checkCancelled(options.signal);
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      pdfPage.drawImage(img, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
    }
    freeCanvas(canvas);
  }
  async function newPage() {
    checkCancelled(options.signal);
    if (pdfPage) await finishPage();
    if (++totalPages > (unicode ? UTILITY_LIMITS.maxRasterTextPages : UTILITY_LIMITS.maxOutputPages)) {
      throw new Error(unicode
        ? 'Non-Latin text can create up to 300 image-based PDF pages per conversion. Split the text into volumes.'
        : 'Text exceeds 1,000 PDF pages. Split the text into volumes.');
    }
    pdfPage = doc.addPage([pdfWidth, pdfHeight]);
    y = pdfHeight - margin;
    if (unicode) {
      canvas.width = Math.ceil(pdfWidth * scale); canvas.height = Math.ceil(pdfHeight * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pdfWidth, pdfHeight);
    }
  }
  try {
    await newPage();
    let processedCharacters = 0;
    for (const block of blocks) {
      checkCancelled(options.signal);
      const size = block.size;
      const lineHeight = size * 1.55;
      const isBold = block.kind === 'heading';
      const font = block.kind === 'code' ? mono : isBold ? bold : regular;
      if (!block.text) { y -= 9; if (y < margin) await newPage(); continue; }
      const cssFont = block.kind === 'code' ? 'monospace' : 'system-ui, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
      measure.font = `${isBold ? 'bold ' : ''}${size}px ${cssFont}`;
      const paragraphs = block.text.split('\n');
      for (const para of paragraphs) {
        let row = '';
        let rowWidth = 0;
        // Measure only the NEW character, not the full growing row: O(n)
        // rather than O(n squared) on book-length paragraphs.
        for (const char of para) {
          if (++processedCharacters % 4096 === 0) {
            // Yield to the browser event loop so Cancel remains responsive for book-sized text.
            await new Promise(resolve => setTimeout(resolve, 0));
            checkCancelled(options.signal);
          }
          const charWidth = unicode ? measure.measureText(char).width : safeTextWidth(font, char, size);
          if (row && rowWidth + charWidth > bodyWidth - 4) {
            if (y - lineHeight < margin) await newPage();
            drawLine(row.trimEnd(), font, size, isBold, cssFont); y -= lineHeight;
            row = char.trimStart();
            rowWidth = row ? charWidth : 0;
          } else { row += char; rowWidth += charWidth; }
        }
        if (row) {
          if (y - lineHeight < margin) await newPage();
          drawLine(row.trimEnd(), font, size, isBold, cssFont); y -= lineHeight;
        }
      }
      if (block.kind === 'heading') y -= 7;
    }
    if (unicode) await finishPage();
    checkCancelled(options.signal);
    const bytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
    checkCancelled(options.signal);
    return { bytes, searchable: !unicode, pageCount: totalPages };
  } finally { freeCanvas(canvas); freeCanvas(measureCanvas); }

  function drawLine(line, font, size, isBold, family) {
    if (unicode) {
      ctx.font = `${isBold ? 'bold ' : ''}${size}px ${family}`;
      ctx.fillStyle = '#22313e'; ctx.textBaseline = 'alphabetic'; ctx.fillText(line, margin, y);
    } else {
      pdfPage.drawText(line || ' ', { x: margin, y, font, size, color: rgb(.13, .19, .24) });
    }
  }
}
function safeTextWidth(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); } catch { return 999999; }
}
