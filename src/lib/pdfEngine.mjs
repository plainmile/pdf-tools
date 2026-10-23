import {
  PDFDocument, degrees, pushGraphicsState, popGraphicsState,
  moveTo, lineTo, closePath, clip, endPath,
} from 'pdf-lib';
import { renderWatermarkPng, watermarkTextFromOptions, watermarkPagePlacement, WATERMARK_OPACITY } from './watermark.mjs';
import { jpegExifOrientation, orientedJpegSize, jpegPdfPlacement, stripJpegPrivateMetadata } from './jpegExif.mjs';
import { imagePdfPageLayout, IMAGE_PDF_LAYOUT_DEFAULT, shouldReflowImageSource } from './imagePdfLayout.mjs';

/**
 * Generate temporary IDs without depending on crypto.randomUUID(), which is
 * unavailable on HTTP LAN origins in many browsers. getRandomValues() also
 * works in insecure contexts. IDs are never used for authentication.
 */
export function temporaryWorkspaceId(api = globalThis.crypto) {
  if (typeof api?.randomUUID === 'function') return api.randomUUID();
  if (typeof api?.getRandomValues !== 'function') {
    throw new Error('This browser cannot generate unique page identifiers.');
  }
  const bytes = new Uint8Array(16);
  api.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 100 * 1024 * 1024,
  maxCombinedBytes: 200 * 1024 * 1024,
  maxPages: 600,
  maxImagePixels: 36_000_000,
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif']);

/**
 * Count document buffers actually retained by the workspace, not only the
 * compressed file size supplied at upload. WebP can decode into a much larger
 * embedded PNG/PDF; photos also retain ORIGINAL bytes for safe reflow.
 *
 * This budget measures retained source buffers, not transient canvas pixels,
 * preview worker copies, serialization buffers or exports. Those can peak
 * higher on low-memory devices.
 */
export function retainedSourceBytes(source) {
  const pdfBytes = source?.bytes?.byteLength;
  const originalBytes = source?.originalImageBytes?.byteLength ?? 0;
  if (![pdfBytes, originalBytes].every(Number.isSafeInteger) ||
      pdfBytes < 1 || originalBytes < 0) {
    throw new Error('Invalid retained document source.');
  }
  return pdfBytes + originalBytes;
}

export function retainedSourcesBytes(sources) {
  return sources.reduce((sum, source) => sum + retainedSourceBytes(source), 0);
}


// File drag-and-drop often supplies an empty or generic MIME type. Validate actual
// bytes in the parsers rather than rejecting otherwise valid .jpg/.png/.webp files.
export function imageTypeFor(file) {
  const type = (file.type || '').toLowerCase();
  if (['image/x-ms-bmp', 'image/x-bmp'].includes(type)) return 'image/bmp';
  if (IMAGE_TYPES.has(type)) return type;
  if (/\.jpe?g$/i.test(file.name || '')) return 'image/jpeg';
  if (/\.png$/i.test(file.name || '')) return 'image/png';
  if (/\.webp$/i.test(file.name || '')) return 'image/webp';
  if (/\.bmp$/i.test(file.name || '')) return 'image/bmp';
  if (/\.avif$/i.test(file.name || '')) return 'image/avif';
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
  if (type === 'image/bmp') {
    // Only Windows BITMAPINFOHEADER-style BMP with a sane pixel offset;
    // reject OS/2 core headers and embedded compressed/JPEG/PNG variants.
    if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('Invalid image header.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const imageOffset = view.getUint32(10, true);
    const dibSize = view.getUint32(14, true);
    if (dibSize < 40 || imageOffset < 14 + dibSize || imageOffset >= bytes.length) {
      throw new Error('Invalid image header.');
    }
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    const bitDepth = view.getUint16(28, true);
    const compression = view.getUint32(30, true);
    if (width <= 0 || !height || ![1, 4, 8, 16, 24, 32].includes(bitDepth) ||
        ![0, 3].includes(compression)) throw new Error('Invalid image header.');
    return { width, height };
  }
  if (type === 'image/avif') {
    // AVIF is an ISO BMFF container. Validate ftyp and inspect ispe
    // BEFORE decoding images on canvas. Reject animation instead of
    // silently outputting only the first frame.
    const invalid = () => { throw new Error('Invalid image header.'); };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 32 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') invalid();
    const boxLen = view.getUint32(0);
    if (boxLen < 16 || boxLen > bytes.length || (boxLen - 16) % 4 !== 0) invalid();
    const fourcc = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const brands = [fourcc(8)];
    for (let offset = 16; offset + 4 <= boxLen; offset += 4) brands.push(fourcc(offset));
    if (brands.includes('avis') || brands.includes('msf1')) {
      throw new Error('Animated AVIF is not supported.');
    }
    if (!brands.includes('avif')) invalid();
    let dimensions = null;
    let inspected = 0;
    const walk = (from, end, container = '') => {
      let offset = from;
      while (offset + 8 <= end) {
        if (++inspected > 4096) invalid();
        const size = view.getUint32(offset);
        const typeName = fourcc(offset + 4);
        // Exclude extended and zero-sized boxes; fail closed for unusually
        // complex containers instead of guessing pre-decode dimensions.
        if (size < 8 || size > end - offset) invalid();
        const dataOffset = offset + 8;
        const dataEnd = offset + size;
        if (typeName === 'ispe' && container === 'ipco') {
          if (size < 20) invalid();
          const width = view.getUint32(dataOffset + 4);
          const height = view.getUint32(dataOffset + 8);
          if (!width || !height) invalid();
          // Check all item properties; actual decoded bitmap is checked again.
          if (width * height > LIMITS.maxImagePixels) throw new Error('Image dimensions are too large.');
          dimensions = { width, height };
        } else if (typeName === 'meta') {
          if (size < 12) invalid();
          walk(dataOffset + 4, dataEnd, 'meta');
        } else if (typeName === 'iprp' && container === 'meta') {
          walk(dataOffset, dataEnd, 'iprp');
        } else if (typeName === 'ipco' && container === 'iprp') {
          walk(dataOffset, dataEnd, 'ipco');
        }
        offset = dataEnd;
      }
      if (offset !== end) invalid();
    };
    walk(0, bytes.length);
    if (!dimensions) invalid();
    return dimensions;
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
        if (bytes[start] & 0x02) throw new Error('Animated WebP is not supported.');
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
  if (!isSupportedFile(file)) throw new Error(`${file.name}: choose PDF, JPG, PNG, WebP, BMP or static AVIF files.`);
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
  return { id: temporaryWorkspaceId(), name: file.name, bytes, pageCount, isImage, inputSize: file.size,
    imageLayout: isImage ? { ...IMAGE_PDF_LAYOUT_DEFAULT, ...options.imageLayout } : null,
    // Retain only in browser RAM, so the user can change paper settings without
    // re-uploading a photo or losing the existing page order/undo history.
    originalImageBytes: isImage ? originalBytes : null,
    originalImageType: isImage ? imageType : null,
  };
}

/**
 * Create a truly blank, browser-local PDF page sized to match the visible
 * selected page (including its current rotation). Never modify the source PDF.
 * Generated blank pages are not user input files and do not count against the
 * 20 imported-file limit; they still count toward the 600-page/memory budgets.
 */
export async function createBlankPageSource(source, pageRef, name = 'blank-page.pdf') {
  if (!source?.bytes || !pageRef || !Number.isSafeInteger(pageRef.pageIndex)) {
    throw new Error('Choose a valid page before inserting a blank page.');
  }
  const original = await PDFDocument.load(source.bytes, { updateMetadata: false });
  if (pageRef.pageIndex < 0 || pageRef.pageIndex >= original.getPageCount()) {
    throw new Error('The chosen page no longer exists.');
  }
  const reference = original.getPage(pageRef.pageIndex);
  const crop = reference.getCropBox();
  let { width, height } = crop;
  const angle = (((reference.getRotation().angle + (pageRef.rotation || 0)) % 360) + 360) % 360;
  if (angle === 90 || angle === 270) [width, height] = [height, width];
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 14_400)) {
    throw new Error('The selected page size cannot be used for a blank page.');
  }

  const blank = await PDFDocument.create({ updateMetadata: false });
  blank.addPage([width, height]);
  const bytes = new Uint8Array(await blank.save({ useObjectStreams: true }));
  return {
    id: temporaryWorkspaceId(), name, bytes, pageCount: 1,
    inputSize: bytes.length, isImage: false, isGeneratedBlank: true,
    imageLayout: null, originalImageBytes: null, originalImageType: null,
  };
}

export async function reflowImageSources(sources, layout, report = () => {}, budgetError = 'Retained document data exceeds the 200 MiB workspace budget.', activeImageIds = null) {
  const updated = [];
  let retainedBytes = 0;
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    // Avoid decoding photos that are no longer in the visible workspace (only
    // stored for Undo), or photos that already match these paper settings.
    // Retain their original bytes and include them in the true RAM budget.
    if (!shouldReflowImageSource(source, layout, activeImageIds)) {
      updated.push(source);
    } else {
      if (!source.originalImageBytes || !source.originalImageType) {
        throw new Error('Photo source bytes are missing. Reimport the original images.');
      }
      const bytes = await imageToPdfBytes({ name: source.name },
        source.originalImageBytes, source.originalImageType, layout);
      updated.push({ ...source, bytes, imageLayout: { ...IMAGE_PDF_LAYOUT_DEFAULT, ...layout } });
    }
    // Validate the entire prospective image reflow BEFORE updating React state.
    // A change in page size/cropping can produce considerably larger PDF data.
    retainedBytes += retainedSourceBytes(updated[updated.length - 1]);
    if (retainedBytes > LIMITS.maxCombinedBytes) throw new Error(budgetError);
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
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not convert image to PNG.')), 'image/png'));
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
    if (imageType === 'image/avif' && error?.name === 'InvalidStateError') {
      throw new Error('This AVIF could not be decoded in your browser. Try PNG or WebP.');
    }
    if (error?.message === 'Image dimensions are too large.' ||
        error?.message === 'JPEG metadata could not be safely removed.' ||
        /^Animated (AVIF|WebP) is not supported\.$/.test(error?.message) ||
        /^This AVIF could not be decoded/.test(error?.message)) throw error;
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
  // Page operations create a new document. Do not stamp brand or implicit
  // creator/producer metadata on the user's exported PDF.
  const destination = await PDFDocument.create({ updateMetadata: false });
  const originalDocs = new Map();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const checkAbort = () => {
    if (options.signal?.aborted) throw new Error(options.cancelMessage || 'Split cancelled.');
  };
  for (let index = 0; index < pageRefs.length; index++) {
    const pageRef = pageRefs[index];
    if (options.signal) {
      // Yield regularly so large exports and splits remain cancellable.
      if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      checkAbort();
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
      const placement = watermarkPagePlacement(page.getCropBox(), page.getRotation().angle);
      const key = `${placement.visualWidth}x${placement.visualHeight}`;
      let watermarkImage = watermarkImages.get(key);
      if (!watermarkImage) {
        const png = await renderWatermarkPng(watermarkText, placement.visualWidth, placement.visualHeight);
        watermarkImage = await destination.embedPng(png);
        watermarkImages.set(key, watermarkImage);
      }
      page.drawImage(watermarkImage, {
        x: placement.x, y: placement.y, width: placement.width, height: placement.height,
        rotate: degrees(placement.rotation), opacity: WATERMARK_OPACITY,
      });
    }
    if (options.onProgress && (index === 0 || (index + 1) % 8 === 0 || index === pageRefs.length - 1)) {
      options.onProgress(index + 1, pageRefs.length);
    }
  }
  checkAbort();
  const result = new Uint8Array(await destination.save({ useObjectStreams: true }));
  checkAbort();
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
