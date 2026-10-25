import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { pageNumberPlacement } from './pageNumberGeometry.mjs';
import {
  UTILITY_LIMITS, validatedImageScale, enforceRasterViewport, rasterCanvasSideLimit, requestedPages, imageExportFilenames, parseTextBlocks, wrapTextLines, textContentToLines,
  linesToReadableText, textContentToReadingOrderLines, hasMinimalSelectableText, textLinesFromFormAnnotations, summarizeTextCoverage, compressionStats, enforceUtilityPdfLimits, enforceImageBatchLimit,
  enforceImageBatchBytes, enforceCompressionImageBytes, checkCancelled,
} from './utilityCore.mjs';

/** FileReader can abort an in-progress read. File.arrayBuffer() cannot. */
export function readFileArrayBuffer(file, signal = null) {
  checkCancelled(signal);
  if (!signal) return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      finish(null, new Error('Processing cancelled.'));
    };
    reader.onload = () => finish(reader.result, signal.aborted ? new Error('Processing cancelled.') : null);
    reader.onerror = () => finish(null, reader.error || new Error('Unable to read input file.'));
    reader.onabort = () => finish(null, new Error('Processing cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { reader.readAsArrayBuffer(file); }
    catch (error) { finish(null, error); }
  });
}

/** Release the UI on Cancel even if a third-party PDF worker does not settle
 * its promise promptly. The caller also destroys the underlying loading task.
 */
export function abortableWait(promise, signal = null) {
  checkCancelled(signal);
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(new Error('Processing cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); if (signal.aborted) reject(new Error('Processing cancelled.')); else resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}

export async function loadPdf(file, mode = 'pdf-to-txt', locale = 'en', signal = null) {
  if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) {
    throw new Error(locale === 'zh' ? '请选择 PDF 文件。' : 'Choose a PDF file.');
  }
  // Check size BEFORE allocating a large ArrayBuffer or PDF.js worker.
  if (!file.size || file.size > UTILITY_LIMITS.maxPdfBytes) {
    enforceUtilityPdfLimits({ size: file.size, count: 1 }, mode, locale);
  }
  const bytes = new Uint8Array(await readFileArrayBuffer(file, signal));
  checkCancelled(signal);
  // Use PDF.js for page counting rather than eagerly parsing a potentially 100 MB
  // document in pdf-lib as well. The actual page-number operation loads pdf-lib later.
  let document;
  try {
    document = await openPdfJs(bytes, signal);
  } catch {
    checkCancelled(signal);
    throw new Error(locale === 'zh' ? 'PDF 无法打开，文件可能损坏或有密码保护。' : 'The PDF is damaged or password-protected.');
  }
  try {
    enforceUtilityPdfLimits({ size: file.size, count: document.count }, mode, locale);
    return { bytes, count: document.count, size: file.size, name: file.name };
  } finally {
    // A stalled PDF.js shutdown must not prevent Cancel from restoring controls.
    await abortableWait(document.destroy(), signal);
  }
}

async function openPdfJs(bytes, signal = null) {
  checkCancelled(signal);
  const pdfjs = await abortableWait(import('pdfjs-dist/legacy/build/pdf.mjs'), signal);
  checkCancelled(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  // Pass a copy: PDF.js transfers its buffer to its worker.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  // Cancel even when loadingTask.promise has not resolved yet.
  const abort = () => { void loadingTask.destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const proxy = await abortableWait(loadingTask.promise, signal);
    checkCancelled(signal);
    return {
      count: proxy.numPages,
      getPage: number => proxy.getPage(number),
      getFieldObjects: () => proxy.getFieldObjects(),
      destroy: () => {
        signal?.removeEventListener('abort', abort);
        return loadingTask.destroy();
      },
    };
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    if (signal?.aborted) {
      // Do not await an already-stalled worker during cancellation. A destroy
      // was scheduled by the abort handler; the UI can recover immediately.
      checkCancelled(signal);
    }
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

function freeCanvas(canvas) { if (canvas) { canvas.width = 1; canvas.height = 1; } }

async function renderPageAsBlob(page, format = 'image/jpeg', scale = 1.5, quality = .8, signal) {
  checkCancelled(signal);
  const viewport = page.getViewport({ scale });
  enforceRasterViewport(viewport, rasterCanvasSideLimit(navigator.userAgent, navigator.maxTouchPoints));
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
  const filenames = imageExportFilenames(selected, pdf.count, format);
  const document = await openPdfJs(pdf.bytes, options.signal);
  const files = [];
  let accumulated = 0;
  try {
    for (const index of selected) {
      checkCancelled(options.signal);
      const page = await document.getPage(index);
      try {
        const blob = await renderPageAsBlob(page, mime, scale, .87, options.signal);
        accumulated = enforceImageBatchBytes(accumulated, blob.size, options.locale);
        files.push({ name: filenames[files.length], bytes: new Uint8Array(await blob.arrayBuffer()) });
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
  const source = await openPdfJs(pdf.bytes, options.signal);
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

export async function extractPdfText(pdf, markdown = false, reportProgress = () => {}, signal, onAudit = () => {}, readingOrder = 'rows') {
  const document = await openPdfJs(pdf.bytes, signal);
  const pages = [];
  const sparseImagePageNumbers = [];
  let imagePaintOps;
  let hasFormFields = false;
  let extractionStage = 'opening document';
  try {
    // Read widget values via page annotations rather than the document-level
    // getFieldObjects() method. The latter throws in some WebKit PDF.js builds,
    // breaking *every* PDF to TXT/Markdown extraction, even ordinary PDFs.
    // Include non-text widgets in the completeness warning.
    for (let i = 1; i <= pdf.count; i++) {
      checkCancelled(signal);
      extractionStage = `page ${i}: getPage`;
      const page = await document.getPage(i);
      try {
        extractionStage = `page ${i}: getTextContent`;
        const content = await page.getTextContent();
        extractionStage = `page ${i}: textContentToReadingOrderLines`;
        const viewport = readingOrder === 'rows' ? null : page.getViewport({ scale: 1 });
        const lines = textContentToReadingOrderLines(content, readingOrder, viewport);
        pages.push(lines);
        // PDF.js text layers can contain only a page number while an image
        // holds the real document body. Only inspect drawing operators on
        // sparse pages; avoid this extra work on ordinary searchable books.
        if (hasMinimalSelectableText(lines)) {
          if (!imagePaintOps) {
            const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            imagePaintOps = new Set([
              OPS.paintImageXObject, OPS.paintJpegXObject,
              OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup,
              OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject,
              OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat,
            ].filter(Number.isInteger));
          }
          extractionStage = `page ${i}: getOperatorList`;
          const operations = await page.getOperatorList();
          checkCancelled(signal);
          if (operations.fnArray.some(operator => imagePaintOps.has(operator))) {
            sparseImagePageNumbers.push(i);
          }
        }
        // Text, choice, checkbox and signature widgets are annotations.
        // Detect form presence on the *actual* page and append visible values.
        extractionStage = `page ${i}: getAnnotations`;
        const annotations = await page.getAnnotations({ intent: 'display' });
        checkCancelled(signal);
        extractionStage = `page ${i}: parse annotation fields`;
        if (annotations.some(item => ['Tx', 'Ch', 'Btn', 'Sig'].includes(item?.fieldType))) {
          hasFormFields = true;
          lines.push(...textLinesFromFormAnnotations(annotations));
        }
      } finally { page.cleanup(); }
      reportProgress(i, pdf.count);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // Keep failures diagnosable in Safari/WebKit instead of reporting a bare
    // minified TypeError with no source context.
    throw new Error(`PDF text extraction [${extractionStage}]: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await document.destroy(); }
  const coverage = summarizeTextCoverage(pages, sparseImagePageNumbers);
  if (!coverage.withText) throw new Error(hasFormFields
    ? 'No extractable text or filled form values found. Review the original PDF and its form fields.'
    : 'No selectable text found. Scanned PDFs require OCR, which this tool does not provide.');
  checkCancelled(signal);
  onAudit({ ...coverage, hasFormFields }); // Review remaining interactive fields before download.
  return linesToReadableText(pages, markdown);
}

export async function addPageNumbers(pdf, opts = {}, reportProgress = () => {}) {
  const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize === 16 ? 16 : opts.fontSize === 10 ? 10 : 12;
  const start = Number(opts.start ?? 1);
  const pageCount = doc.getPageCount();
  const firstPage = Number(opts.firstPage ?? 1);
  if (!Number.isSafeInteger(start) || start < 1 || start > 99999) throw new Error('Starting page number must be from 1 to 99999.');
  if (!Number.isSafeInteger(firstPage) || firstPage < 1 || firstPage > pageCount) {
    throw new Error(`First PDF page to number must be from 1 to ${pageCount}.`);
  }
  // Only pages at/after firstPage get labels. Pages before it (covers, table
  // of contents) are copied unchanged, and firstPage gets printed number start.
  if (start + pageCount - firstPage > 99999) throw new Error('Page numbers cannot exceed 99999. Lower the starting number.');
  const position = ['bottom-center', 'bottom-right', 'top-right'].includes(opts.position) ? opts.position : 'bottom-center';
  for (let i = 0; i < pageCount; i++) {
    // Yield while numbering books: otherwise the browser cannot dispatch
    // the Cancel click until all synchronous page annotations are finished.
    if (i > 0 && i % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    checkCancelled(opts.signal);
    if (i < firstPage - 1) {
      reportProgress(i + 1, pageCount);
      continue; // No numbering or other content modification on cover pages.
    }
    const page = doc.getPage(i);
    const box = page.getCropBox();
    const text = String(start + i - (firstPage - 1));
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
  let pdfPage = null, y = 0, totalPages = 0, rasterPages = 0;
  let pageLines = [], pageRequiresRaster = false;
  // In mixed-language books, keep ordinary PDF text searchable on pages
  // that do not require browser-font rasterization. Buffer only ONE page of
  // positioned lines; avoid accumulating a whole book before writing it.
  const widthCaches = new Map();
  async function finishPage() {
    checkCancelled(options.signal);
    if (!pdfPage) return;
    if (pageRequiresRaster) {
      if (++rasterPages > UTILITY_LIMITS.maxRasterTextPages) {
        throw new Error('Non-Latin text can create up to 300 image-based PDF pages per conversion. Split the text into volumes.');
      }
      if (!canvas || !ctx) throw new Error('Canvas is unavailable for Unicode text.');
      canvas.width = Math.ceil(pdfWidth * scale);
      canvas.height = Math.ceil(pdfHeight * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pdfWidth, pdfHeight);
      for (const entry of pageLines) {
        ctx.font = entry.cssFont;
        ctx.fillStyle = '#22313e';
        ctx.textBaseline = 'alphabetic';
        // PDF text baselines use bottom-left origin; Canvas uses top-left.
        // Invert Y or Chinese lines start near the bottom and flow upward.
        ctx.fillText(entry.text, margin, pdfHeight - entry.y);
      }
      const jpg = await new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Text rendering failed.')), 'image/jpeg', .92));
      checkCancelled(options.signal);
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      checkCancelled(options.signal);
      pdfPage.drawImage(img, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
    } else {
      for (const entry of pageLines) {
        pdfPage.drawText(entry.text || ' ', {
          x: margin, y: entry.y, font: entry.font, size: entry.size, color: rgb(.13, .19, .24),
        });
      }
    }
    pageLines = [];
    pageRequiresRaster = false;
    freeCanvas(canvas);
  }
  async function newPage() {
    checkCancelled(options.signal);
    if (pdfPage) await finishPage();
    if (++totalPages > UTILITY_LIMITS.maxOutputPages) {
      throw new Error('Text exceeds 1,000 PDF pages. Split the text into volumes.');
    }
    pdfPage = doc.addPage([pdfWidth, pdfHeight]);
    y = pdfHeight - margin;
  }
  try {
    await newPage();
    let processedCharacters = 0;
    let nextYield = 4096;
    for (const block of blocks) {
      checkCancelled(options.signal);
      const size = block.size;
      const lineHeight = size * 1.55;
      const isBold = block.kind === 'heading';
      const font = block.kind === 'code' ? mono : isBold ? bold : regular;
      if (!block.text) { y -= block.kind === 'code' ? lineHeight : 9; if (y < margin) await newPage(); continue; }
      const cssFont = block.kind === 'code' ? 'monospace' : 'system-ui, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
      measure.font = `${isBold ? 'bold ' : ''}${size}px ${cssFont}`;
      // A Latin page in a mixed document uses the embedded PDF font; a CJK
      // page uses system fonts. Conservatively measure both so either output
      // stays within the page margins even when the fonts differ.
      const widthKey = block.kind + ':' + size;
      if (!widthCaches.has(widthKey)) widthCaches.set(widthKey, new Map());
      const cachedWidths = widthCaches.get(widthKey);
      const measureChar = unicode
        ? char => {
          if (cachedWidths.has(char)) return cachedWidths.get(char);
          const browserWidth = measure.measureText(char).width;
          const pdfWidth = safeTextWidth(font, char, size);
          const width = Math.max(browserWidth, pdfWidth === 999999 ? 0 : pdfWidth);
          cachedWidths.set(char, width);
          return width;
        }
        : char => safeTextWidth(font, char, size);
      for (const para of block.text.split('\n')) {
        // Ordinary prose wraps at word boundaries; code preserves spacing.
        // Oversized tokens and CJK still wrap by individual character.
        for (const row of wrapTextLines(para, bodyWidth - 4, measureChar,
          { preserveWords: block.kind !== 'code' })) {
          processedCharacters += row.length;
          if (processedCharacters >= nextYield) {
            // Allow Cancel to interrupt even an enormous single paragraph.
            await new Promise(resolve => setTimeout(resolve, 0));
            checkCancelled(options.signal);
            nextYield = processedCharacters + 4096;
          }
          if (y - lineHeight < margin) await newPage();
          drawLine(row, font, size, isBold, cssFont);
          y -= lineHeight;
        }
      }
      if (block.kind === 'heading') y -= 7;
    }
    if (pdfPage) await finishPage();
    checkCancelled(options.signal);
    const bytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
    checkCancelled(options.signal);
    return { bytes, searchable: rasterPages === 0, rasterPages, pageCount: totalPages };
  } finally { freeCanvas(canvas); freeCanvas(measureCanvas); }

  function drawLine(line, font, size, isBold, family) {
    // pdf-lib's built-in fonts cannot encode CJK and some symbols. A single
    // unsupported line rasterizes only its own page, not unrelated pages.
    try { font.encodeText(line || ' '); }
    catch { pageRequiresRaster = true; }
    pageLines.push({
      text: line, font, size, y,
      cssFont: (isBold ? 'bold ' : '') + size + 'px ' + family,
    });
  }
}
function safeTextWidth(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); } catch { return 999999; }
}
