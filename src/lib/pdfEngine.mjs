import { PDFDocument, degrees } from 'pdf-lib';

export const LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 25 * 1024 * 1024,
  maxCombinedBytes: 100 * 1024 * 1024,
  maxPages: 200,
  maxImagePixels: 36_000_000,
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isSupportedFile(file) {
  return file.type === 'application/pdf' || IMAGE_TYPES.has(file.type) || /\.pdf$/i.test(file.name);
}

export async function readSourceFile(file) {
  if (!isSupportedFile(file)) throw new Error(`${file.name}: choose PDF, JPG, PNG or WebP files.`);
  if (!file.size || file.size > LIMITS.maxFileBytes) {
    throw new Error(`${file.name}: files must be between 1 byte and 25 MB.`);
  }
  const isImage = IMAGE_TYPES.has(file.type);
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (isImage) bytes = await imageToPdfBytes(file, bytes);

  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (/encrypted|password/i.test(String(error?.message ?? ''))) {
      throw new Error(`${file.name}: password-protected PDFs are not supported.`);
    }
    throw new Error(`${file.name}: the file could not be opened as a PDF.`);
  }
  const pageCount = doc.getPageCount();
  if (!pageCount) throw new Error(`${file.name}: this document has no pages.`);
  return { id: crypto.randomUUID(), name: file.name, bytes, pageCount, isImage, inputSize: file.size };
}

async function imageToPdfBytes(file, originalBytes) {
  const doc = await PDFDocument.create();
  let embedded;
  let bitmap;
  try {
    if (file.type === 'image/jpeg') embedded = await doc.embedJpg(originalBytes);
    else if (file.type === 'image/png') embedded = await doc.embedPng(originalBytes);
    else {
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > LIMITS.maxImagePixels) throw new Error('Image dimensions are too large.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image canvas is unavailable.');
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not convert WebP image.')), 'image/png'));
      embedded = await doc.embedPng(await blob.arrayBuffer());
      canvas.width = 1;
      canvas.height = 1;
    }
    if (embedded.width * embedded.height > LIMITS.maxImagePixels) throw new Error('Image dimensions are too large.');
    const width = 595.28;
    const height = 841.89;
    const margin = 30;
    const factor = Math.min((width - margin * 2) / embedded.width, (height - margin * 2) / embedded.height);
    const drawWidth = embedded.width * factor;
    const drawHeight = embedded.height * factor;
    const page = doc.addPage([width, height]);
    page.drawImage(embedded, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
    return new Uint8Array(await doc.save({ useObjectStreams: true }));
  } catch (error) {
    if (error?.message === 'Image dimensions are too large.') throw error;
    throw new Error(`${file.name}: image could not be converted to PDF.`);
  } finally {
    bitmap?.close();
  }
}

/** Export pages in workspace order. The originals are never modified. */
export async function composePdf(sources, pageRefs) {
  if (!pageRefs.length) throw new Error('There are no pages to export.');
  const destination = await PDFDocument.create();
  const originalDocs = new Map();
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const pageRef of pageRefs) {
    let sourceDoc = originalDocs.get(pageRef.sourceId);
    if (!sourceDoc) {
      const source = byId.get(pageRef.sourceId);
      if (!source) throw new Error('A page source is missing. Reload your files.');
      sourceDoc = await PDFDocument.load(source.bytes, { updateMetadata: false });
      originalDocs.set(pageRef.sourceId, sourceDoc);
    }
    const [page] = await destination.copyPages(sourceDoc, [pageRef.pageIndex]);
    if (!page) throw new Error('Could not copy a page.');
    if (pageRef.rotation) {
      const nativeAngle = page.getRotation().angle;
      const angle = ((nativeAngle + pageRef.rotation) % 360 + 360) % 360;
      page.setRotation(degrees(angle));
    }
    destination.addPage(page);
  }
  destination.setTitle('Organized with PlainMile PDF');
  destination.setCreator('PlainMile PDF');
  return new Uint8Array(await destination.save({ useObjectStreams: true }));
}

export function saveDownload(bytesOrBlob, filename, mime = 'application/pdf') {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
