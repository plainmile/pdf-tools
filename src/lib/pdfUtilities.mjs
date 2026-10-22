import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import {
  UTILITY_LIMITS, requestedPages, parseTextBlocks, textContentToLines,
  linesToReadableText, compressionStats,
} from './utilityCore.mjs';

export async function loadPdf(file) {
  if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) throw new Error('Choose a PDF file.');
  if (!file.size || file.size > UTILITY_LIMITS.maxPdfBytes) throw new Error('Choose a PDF under 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfLibDoc = await PDFDocument.load(bytes, { updateMetadata: false }).catch(() => { throw new Error('The PDF is damaged or password-protected.'); });
  const count = pdfLibDoc.getPageCount();
  if (!count || count > UTILITY_LIMITS.maxPages) throw new Error('PDFs must have between 1 and 50 pages.');
  return { bytes, count, size: file.size, name: file.name };
}

async function openPdfJs(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  // Pass a copy: PDF.js transfers its buffer to its worker.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const proxy = await loadingTask.promise;
  // PDF.js 6 removed PDFDocumentProxy.destroy(); the loading task owns worker teardown.
  return { getPage: (number) => proxy.getPage(number), destroy: () => loadingTask.destroy() };
}

function freeCanvas(canvas) { if (canvas) { canvas.width = 1; canvas.height = 1; } }

async function renderPageAsBlob(page, format = 'image/jpeg', scale = 1.5, quality = .8) {
  const viewport = page.getViewport({ scale });
  if (viewport.width * viewport.height > UTILITY_LIMITS.maxPixelCount) throw new Error('This page is too large to rasterize safely.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is not available.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' }).promise;
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed.')), format, quality));
  } finally { freeCanvas(canvas); }
}

export async function convertPdfToImages(pdf, options = {}) {
  const format = options.format === 'png' ? 'png' : 'jpg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const scale = options.scale === 2 ? 2 : options.scale === 1 ? 1 : 1.5;
  const selected = requestedPages(options.pages ?? '', pdf.count);
  const document = await openPdfJs(pdf.bytes);
  const files = [];
  try {
    for (const index of selected) {
      const page = await document.getPage(index);
      const blob = await renderPageAsBlob(page, mime, scale, .87);
      files.push({ name: `page-${String(index).padStart(3, '0')}.${format}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      page.cleanup();
    }
  } finally { await document.destroy(); }
  if (files.length === 1) return { ...files[0], mime, count: 1 };
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return { name: 'pdf-pages.zip', bytes: await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }), mime: 'application/zip', count: files.length };
}

// Honest, intentionally lossy raster recompression: no promise to keep searchable text,
// internal links, annotations, form fields or digital signatures. Never auto-download if larger.
export async function compressPdfRaster(pdf, options = {}) {
  const scale = options.scale === 1.5 ? 1.5 : options.scale === 1 ? 1 : .75;
  const quality = options.quality === .8 ? .8 : options.quality === .55 ? .55 : .7;
  const source = await openPdfJs(pdf.bytes);
  const output = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.count; i++) {
      const page = await source.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const jpeg = await renderPageAsBlob(page, 'image/jpeg', scale, quality);
      const embedded = await output.embedJpg(await jpeg.arrayBuffer());
      const target = output.addPage([viewport.width, viewport.height]);
      target.drawImage(embedded, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      page.cleanup();
    }
    const bytes = new Uint8Array(await output.save({ useObjectStreams: true }));
    return { bytes, stats: compressionStats(pdf.size, bytes.length) };
  } finally { await source.destroy(); }
}

export async function extractPdfText(pdf, markdown = false) {
  const document = await openPdfJs(pdf.bytes);
  const pages = [];
  try {
    for (let i = 1; i <= pdf.count; i++) {
      const page = await document.getPage(i);
      pages.push(textContentToLines(await page.getTextContent()));
      page.cleanup();
    }
  } finally { await document.destroy(); }
  if (!pages.some(p => p.length)) throw new Error('No selectable text found. Scanned PDFs require OCR, which this tool does not provide.');
  return linesToReadableText(pages, markdown);
}

export async function addPageNumbers(pdf, opts = {}) {
  const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize === 16 ? 16 : opts.fontSize === 10 ? 10 : 12;
  const start = Number(opts.start ?? 1);
  if (!Number.isSafeInteger(start) || start < 1 || start > 99999) throw new Error('Starting page number must be from 1 to 99999.');
  const position = ['bottom-center', 'bottom-right', 'top-right'].includes(opts.position) ? opts.position : 'bottom-center';
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
    const box = page.getCropBox();
    const text = String(start + i);
    const textWidth = font.widthOfTextAtSize(text, size);
    const x = position.endsWith('right') ? box.x + box.width - 28 - textWidth : box.x + (box.width - textWidth) / 2;
    const y = position.startsWith('top') ? box.y + box.height - size - 22 : box.y + 24;
    page.drawText(text, { x, y, font, size, color: rgb(.28, .33, .39) });
  }
  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

// Latin text uses real searchable PDF text. For arbitrary Unicode/CJK characters,
// render with browser's LOCAL fonts as page images to avoid missing glyphs.
export async function textToPdf(text, markdown = false) {
  const blocks = parseTextBlocks(text, markdown);
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
    if (unicode && pdfPage && canvas) {
      const jpg = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Text rendering failed.')), 'image/jpeg', .92));
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      pdfPage.drawImage(img, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
    }
    freeCanvas(canvas);
  }
  async function newPage() {
    if (pdfPage) await finishPage();
    if (++totalPages > UTILITY_LIMITS.maxOutputPages) throw new Error('Text exceeds 50 output pages.');
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
    for (const block of blocks) {
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
        // Character-level fallback guarantees even extremely long unbroken words fit the page.
        const words = Array.from(para);
        for (const word of words) {
          const next = row + word;
          const width = unicode ? measure.measureText(next).width : safeTextWidth(font, next, size);
          if (width > bodyWidth && row) {
            if (y - lineHeight < margin) await newPage();
            drawLine(row.trimEnd(), font, size, isBold, cssFont); y -= lineHeight;
            row = word.trimStart();
          } else row = next;
        }
        if (row) {
          if (y - lineHeight < margin) await newPage();
          drawLine(row.trimEnd(), font, size, isBold, cssFont); y -= lineHeight;
        }
      }
      if (block.kind === 'heading') y -= 7;
    }
    if (unicode) await finishPage();
    return { bytes: new Uint8Array(await doc.save({ useObjectStreams: true })), searchable: !unicode, pageCount: totalPages };
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
