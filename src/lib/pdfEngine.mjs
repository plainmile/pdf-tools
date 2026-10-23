import {
  PDFDocument, degrees, pushGraphicsState, popGraphicsState,
  moveTo, lineTo, closePath, clip, endPath,
} from 'pdf-lib';
import { renderWatermarkPng, watermarkTextFromOptions, WATERMARK_OPACITY } from './watermark.mjs';
import { jpegExifOrientation, orientedJpegSize, jpegPdfPlacement, stripJpegPrivateMetadata } from './jpegExif.mjs';
import { imagePdfPageLayout } from './imagePdfLayout.mjs';

export const LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 100 * 1024 * 1024,
  maxCombinedBytes: 200 * 1024 * 1024,
  maxPages: 600,
  maxImagePixels: 36_000_000,
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// File drag-and-drop often supplies an empty or generic MIME type. Validate actual
// bytes in the parsers rather than rejecting otherwise valid .jpg/.png/.webp files.
export function imageTypeFor(file) {
  const type = (file.type || '').toLowerCase();
  if (IMAGE_TYPES.has(type)) return type;
  if (/\.jpe?g$/i.test(file.name || '')) return 'image/jpeg';
  if (/\.png$/i.test(file.name || '')) return 'image/png';
  if (/\.webp$/i.test(file.name || '')) return 'image/webp';
  return null;
}

export function isSupportedFile(file) {
  return file.type === 'application/pdf' || Boolean(imageTypeFor(file)) || /\.pdf$/i.test(file.name);
}

// Inspect dimensions in compressed image headers before allocating decoded buffers.
// In particular, WebP must be bounded BEFORE createImageBitmap, not after.
export function compressedImageDimensions(type, bytes) {
  if (type === 'image/png') {
    if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b) ||
        bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
      throw new Error('Invalid image header.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid image header.');
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let index = 2;
    while (index + 4 < bytes.length) {
      if (bytes[index++] !== 0xff) continue;
      while (bytes[index] === 0xff) index++;
      const marker = bytes[index++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      if (index + 1 >= bytes.length) break;
      const segmentSize = bytes[index] * 256 + bytes[index + 1];
      if (segmentSize < 2 || index + segmentSize > bytes.length) break;
      if (frames.has(marker) && segmentSize >= 7) {
        return {
          height: bytes[index + 3] * 256 + bytes[index + 4],
          width: bytes[index + 5] * 256 + bytes[index + 6],
        };
      }
      index += segmentSize;
    }
    throw new Error('Invalid image header.');
  }
  if (type === 'image/webp') {
    // RFC 9649: RIFF WEBP chunks are little-endian, padded to even lengths.
    // VP8X stores canvas size as LE24 + 1, VP8L as two packed 14-bit fields,
    // and VP8 key-frame headers store LE16 dimensions masked to 14 bits.
    const bad = () => { throw new Error('Invalid image header.'); };
    if (bytes.length < 20 || [82,73,70,70].some((b,i) => bytes[i] !== b) ||
        [87,69,66,80].some((b,i) => bytes[8+i] !== b)) bad();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const riffLength = view.getUint32(4, true) + 8;
    if (riffLength < 20 || riffLength > bytes.length) bad();
    let offset = 12;
    while (offset + 8 <= riffLength) {
      const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (size > riffLength - start) bad();
      if (tag === 'VP8X') {
        if (size < 10) bad();
        const width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        const height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
        return { width, height };
      }
      if (tag === 'VP8L') {
        if (size < 5 || bytes[start] !== 0x2f) bad();
        const bits = view.getUint32(start + 1, true);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      if (tag === 'VP8 ') {
        if (size < 10 || bytes[start + 3] !== 0x9d ||
            bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) bad();
        const width = view.getUint16(start + 6, true) & 0x3fff;
        const height = view.getUint16(start + 8, true) & 0x3fff;
        if (!width || !height) bad();
        return { width, height };
      }
      const padded = size + (size & 1);
      if (padded > riffLength - start) bad();
      offset = start + padded;
    }
    bad();
  }
  return null;
}

export async function readSourceFile(file, options = {}) {
  if (!isSupportedFile(file)) throw new Error(`${file.name}: choose PDF, JPG, PNG or WebP files.`);
  if (!file.size || file.size > LIMITS.maxFileBytes) {
    throw new Error(`${file.name}: files must be between 1 byte and 100 MB.`);
  }
  const imageType = imageTypeFor(file);
  const isImage = Boolean(imageType);
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const bytes = isImage ? await imageToPdfBytes(file, originalBytes, imageType, options.imageLayout) : originalBytes;

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
  return { id: crypto.randomUUID(), name: file.name, bytes, pageCount, isImage, inputSize: file.size,
    // Retain only in browser RAM, so the user can change paper settings without
    // re-uploading a photo or losing the existing page order/undo history.
    originalImageBytes: isImage ? originalBytes : null,
    originalImageType: isImage ? imageType : null,
  };
}

export async function reflowImageSources(sources, layout, report = () => {}) {
  const updated = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    if (!source.isImage) {
      updated.push(source);
    } else {
      if (!source.originalImageBytes || !source.originalImageType) {
        throw new Error('Photo source bytes are missing. Reimport the original images.');
      }
      const bytes = await imageToPdfBytes({ name: source.name },
        source.originalImageBytes, source.originalImageType, layout);
      updated.push({ ...source, bytes });
    }
    report(index + 1, sources.length);
    // Allow React updates and UI progress during bulk photo reflow.
    if (index % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return updated;
}

async function imageToPdfBytes(file, originalBytes, imageType, options = {}) {
  const doc = await PDFDocument.create();
  let embedded;
  let bitmap;
  try {
    const header = compressedImageDimensions(imageType, originalBytes);
    if (header && (!header.width || !header.height || header.width * header.height > LIMITS.maxImagePixels)) {
      throw new Error('Image dimensions are too large.');
    }
    const exifOrientation = imageType === 'image/jpeg' ? jpegExifOrientation(originalBytes) : 1;
    if (imageType === 'image/jpeg') embedded = await doc.embedJpg(stripJpegPrivateMetadata(originalBytes));
    else if (imageType === 'image/png') embedded = await doc.embedPng(originalBytes);
    else {
      bitmap = await createImageBitmap(new Blob([originalBytes], { type: imageType }));
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
    const oriented = orientedJpegSize(embedded.width, embedded.height, exifOrientation);
    const layout = imagePdfPageLayout(oriented.width, oriented.height, options);
    const page = doc.addPage([layout.width, layout.height]);
    const placement = jpegPdfPlacement(layout.image, exifOrientation);
    // EXIF changes the displayed orientation, not the JPEG pixel data or its
    // compression quality. PDF transforms handle all eight incl. mirrors.
    if (layout.clip) {
      const { x, y, width, height } = layout.clip;
      page.pushOperators(
        pushGraphicsState(), moveTo(x, y), lineTo(x + width, y),
        lineTo(x + width, y + height), lineTo(x, y + height),
        closePath(), clip(), endPath(),
      );
    }
    page.drawImage(embedded, {
      x: placement.x, y: placement.y, width: placement.width, height: placement.height,
      rotate: degrees(placement.angle),
    });
    if (layout.clip) page.pushOperators(popGraphicsState());
    return new Uint8Array(await doc.save({ useObjectStreams: true }));
  } catch (error) {
    if (error?.message === 'Image dimensions are too large.' ||
        error?.message === 'JPEG metadata could not be safely removed.') throw error;
    throw new Error(`${file.name}: image could not be converted to PDF.`);
  } finally {
    bitmap?.close();
  }
}

/** Export pages in workspace order. The originals are never modified. */
export async function composePdf(sources, pageRefs, options = {}) {
  if (!pageRefs.length) throw new Error('There are no pages to export.');
  const watermarkText = watermarkTextFromOptions(options.watermark);
  const watermarkImages = new Map();
  const destination = await PDFDocument.create();
  const originalDocs = new Map();
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (let index = 0; index < pageRefs.length; index++) {
    const pageRef = pageRefs[index];
    if (options.signal) {
      // Yield periodically so a user can cancel a long split without locking the UI.
      if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      if (options.signal.aborted) throw new Error('Split cancelled.');
    }
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
    if (watermarkText) {
      const crop = page.getCropBox();
      const key = `${crop.width}x${crop.height}`;
      let watermarkImage = watermarkImages.get(key);
      if (!watermarkImage) {
        const png = await renderWatermarkPng(watermarkText, crop.width, crop.height);
        watermarkImage = await destination.embedPng(png);
        watermarkImages.set(key, watermarkImage);
      }
      page.drawImage(watermarkImage, {
        x: crop.x, y: crop.y, width: crop.width, height: crop.height, opacity: WATERMARK_OPACITY,
      });
    }
  }
  destination.setTitle('Organized with PlainMile PDF');
  destination.setCreator('PlainMile PDF');
  if (options.signal?.aborted) throw new Error('Split cancelled.');
  const result = new Uint8Array(await destination.save({ useObjectStreams: true }));
  if (options.signal?.aborted) throw new Error('Split cancelled.');
  return result;
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
