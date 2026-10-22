/**
 * EXIF Orientation belongs to IFD0 (TIFF tag 0x0112).
 * The scan ends at Start of Scan: never search arbitrary compressed JPEG bytes.
 * Malformed/absent optional metadata is non-fatal and defaults to orientation 1.
 * All offsets are bounded by the current APP1 segment, not just file length.
 */
export function jpegExifOrientation(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) break;
    while (at < bytes.length && bytes[at] === 0xff) at++;
    if (at >= bytes.length) break;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) break;
    const length = view.getUint16(at, false);
    if (length < 2 || length > bytes.length - at) break;
    const start = at + 2;
    const end = at + length;
    if (marker === 0xe1) {
      const orientation = orientationInExifSegment(bytes, view, start, end);
      if (orientation !== null) return orientation;
    }
    at = end;
  }
  return 1;
}

function orientationInExifSegment(bytes, view, start, end) {
  if (end - start < 14 || bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 ||
      bytes[start + 2] !== 0x69 || bytes[start + 3] !== 0x66 ||
      bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if ((!little && !big) || view.getUint16(tiff + 2, little) !== 42) return null;
  const relative = view.getUint32(tiff + 4, little);
  // The entire IFD and each entry must remain within this APP1 segment.
  if (relative > end - tiff - 2) return null;
  const ifd = tiff + relative;
  const count = view.getUint16(ifd, little);
  if (count > Math.floor((end - ifd - 2) / 12)) return null;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, little) !== 0x0112 ||
        view.getUint16(entry + 2, little) !== 3 ||
        view.getUint32(entry + 4, little) !== 1) continue;
    const value = view.getUint16(entry + 8, little);
    if (value >= 1 && value <= 8) return value;
  }
  return null;
}

/** Pixel size after applying EXIF Orientation to the original JPEG. */
export function orientedJpegSize(rawWidth, rawHeight, orientation) {
  const swap = orientation >= 5 && orientation <= 8;
  return { width: swap ? rawHeight : rawWidth, height: swap ? rawWidth : rawHeight };
}

/**
 * PDF XObject JPEG samples are drawn unmodified; transform the PDF image itself.
 * In pdf-lib: translate(x,y), rotate(counter-clockwise), scale(width,height).
 * Negative scales mirror the embedded bitmap without lossy JPEG re-encoding.
 *
 * rect describes the final ORIENTED image bounds in PDF points.
 */
export function jpegPdfPlacement(rect, orientation) {
  const { x, y, width: w, height: h } = rect;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 ||
      !Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new Error('Invalid JPEG orientation or page placement.');
  }
  switch (orientation) {
    case 2: return { x: x + w, y, width: -w, height: h, angle: 0 };
    case 3: return { x: x + w, y: y + h, width: w, height: h, angle: 180 };
    case 4: return { x, y: y + h, width: w, height: -h, angle: 0 };
    case 5: return { x: x + w, y: y + h, width: -h, height: w, angle: 90 };
    case 6: return { x, y: y + h, width: h, height: w, angle: 270 };
    case 7: return { x, y, width: h, height: -w, angle: 90 };
    case 8: return { x: x + w, y, width: h, height: w, angle: 90 };
    default: return { x, y, width: w, height: h, angle: 0 };
  }
}

/**
 * Strip common sensitive JPEG metadata without re-encoding the image pixels.
 * APP1 = EXIF/XMP (including possible GPS); APP13 = IPTC/Photoshop metadata;
 * COM = arbitrary comments. Keep APP0/JFIF, APP2 ICC, APP14 Adobe color data.
 * Stop at the first SOS to preserve the original encoded image bitstream.
 *
 * If headers cannot be parsed safely, FAIL CLOSED instead of embedding a
 * possibly sensitive uninspected APP1 into a shared PDF.
 */
export function stripJpegPrivateMetadata(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('JPEG metadata could not be safely removed.');
  }
  const parts = [bytes.subarray(0, 2)];
  let at = 2;
  let removed = false;
  let foundScan = false;
  while (at < bytes.length) {
    const markerStart = at;
    if (bytes[at] !== 0xff) break;
    while (at < bytes.length && bytes[at] === 0xff) at++;
    if (at >= bytes.length) break;
    const marker = bytes[at++];
    if (marker === 0xda) {
      // A scan can contain escaped 0xff bytes and additional progressive scans.
      // Never rewrite entropy-coded data or trailing markers.
      parts.push(bytes.subarray(markerStart));
      foundScan = true;
      break;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(markerStart, at));
      continue;
    }
    if (at + 1 >= bytes.length) break;
    const size = (bytes[at] << 8) | bytes[at + 1];
    if (size < 2 || size > bytes.length - at) break;
    const end = at + size;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
      removed = true;
    } else {
      parts.push(bytes.subarray(markerStart, end));
    }
    at = end;
  }
  if (!foundScan) throw new Error('JPEG metadata could not be safely removed.');
  if (!removed) return bytes;
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
