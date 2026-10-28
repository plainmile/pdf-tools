import { abortableWait } from './fileIo.mjs';
import { checkCancelled } from './utilityCore.mjs';

/** Optional watermark text is intentionally disabled unless the user opts in. */
export const MAX_WATERMARK_CHARS = 60;
export const WATERMARK_OPACITY = 0.2;

/**
 * Paint a watermark in the orientation a reader actually sees, not in the
 * PDF's unrotated content coordinates. /Rotate is clockwise, whereas PDF
 * drawing transforms use counter-clockwise angles. The inverse rotation and
 * CropBox offset keep the image anchored over the visible page for all four
 * common orientations, including pages rotated inside the workspace.
 */
export function watermarkPagePlacement(crop, degrees) {
  const [x, y, width, height] = [crop?.x, crop?.y, crop?.width, crop?.height];
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Invalid PDF crop-box dimensions for watermarking.');
  }
  const rotation = ((degrees % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new Error('Unsupported PDF page rotation for watermarking.');
  }
  switch (rotation) {
    case 90:
      return { x: x + width, y, width: height, height: width, rotation,
        visualWidth: height, visualHeight: width };
    case 180:
      return { x: x + width, y: y + height, width, height, rotation,
        visualWidth: width, visualHeight: height };
    case 270:
      return { x, y: y + height, width: height, height: width, rotation,
        visualWidth: height, visualHeight: width };
    default:
      return { x, y, width, height, rotation,
        visualWidth: width, visualHeight: height };
  }
}


export function watermarkTextFromOptions(watermark) {
  if (!watermark?.enabled) return null;
  const text = String(watermark.text ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) throw new Error('Enter watermark text or switch the watermark off.');
  if ([...text].length > MAX_WATERMARK_CHARS) {
    throw new Error(`Watermark text must be ${MAX_WATERMARK_CHARS} characters or fewer.`);
  }
  return text;
}

/**
 * Render text using fonts installed on the visitor's device. PDF built-in fonts
 * do not support Chinese; embedding this transparent image makes Chinese text
 * display correctly without sending content or fonts to an external service.
 */
export async function renderWatermarkPng(text, pageWidth, pageHeight, signal = null) {
  checkCancelled(signal);
  if (typeof document === 'undefined' || !document.createElement) {
    throw new Error('Watermarks require a browser with canvas support.');
  }
  if (![pageWidth, pageHeight].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('Invalid PDF page dimensions for watermarking.');
  }

  const canvas = document.createElement('canvas');
  const scale = Math.min(2, 1600 / Math.max(pageWidth, pageHeight));
  canvas.width = Math.max(1, Math.ceil(pageWidth * scale));
  canvas.height = Math.max(1, Math.ceil(pageHeight * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for watermarking.');
    context.setTransform(canvas.width / pageWidth, 0, 0, canvas.height / pageHeight, 0, 0);
    context.translate(pageWidth / 2, pageHeight / 2);
    context.rotate(-Math.PI / 6);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#444f5d';
    const fontSize = Math.max(12, Math.min(64, Math.min(pageWidth, pageHeight) * 0.09));
    context.font = `600 ${fontSize}px "Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif`;
    const availableWidth = Math.min(pageWidth * 0.84 / Math.cos(Math.PI / 6), pageHeight * 0.7 / Math.sin(Math.PI / 6));
    const measuredWidth = context.measureText(text).width;
    const fit = Math.min(1, availableWidth / Math.max(measuredWidth, 1));
    context.scale(fit, fit);
    context.fillText(text, 0, 0);
    // A browser encoder or Blob read can stall indefinitely after export is
    // cancelled. Race both stages against AbortSignal so finally releases
    // the canvas backing store and no late watermark enters the PDF.
    const blob = await abortableWait(new Promise((resolve, reject) => {
      canvas.toBlob((png) => png ? resolve(png) : reject(new Error('Could not create the watermark image.')), 'image/png');
    }), signal);
    const bytes = new Uint8Array(await abortableWait(blob.arrayBuffer(), signal));
    checkCancelled(signal);
    return bytes;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
