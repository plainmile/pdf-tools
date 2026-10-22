export const IMAGE_PDF_LAYOUT_DEFAULT = Object.freeze({
  paper: 'a4',
  orientation: 'portrait',
  margin: 30,
});

const PAPER_SIZES = Object.freeze({
  a4: [595.28, 841.89],
  letter: [612, 792],
});
const MAX_PAGE_DIMENSION = 14_400;

/**
 * Determine the actual PDF page and image rectangle in PDF points.
 * The image dimensions must ALREADY account for JPEG EXIF orientation.
 * 'fit' creates a page sized to the picture at 96 CSS pixels/inch
 * (72 PDF points/inch), with the requested margins, max 14,400 points.
 */
export function imagePdfPageLayout(imageWidth, imageHeight, options = {}) {
  const paper = options.paper ?? IMAGE_PDF_LAYOUT_DEFAULT.paper;
  const orientation = options.orientation ?? IMAGE_PDF_LAYOUT_DEFAULT.orientation;
  const margin = Number(options.margin ?? IMAGE_PDF_LAYOUT_DEFAULT.margin);
  if (!(paper in PAPER_SIZES) && paper !== 'fit') throw new Error('Unsupported image PDF paper size.');
  if (!['portrait', 'landscape', 'auto'].includes(orientation)) throw new Error('Unsupported image PDF orientation.');
  if (![0, 12, 30, 48].includes(margin)) throw new Error('Unsupported image PDF margin.');
  if (![imageWidth, imageHeight].every(Number.isFinite) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('Invalid image dimensions.');
  }

  let width, height;
  if (paper === 'fit') {
    // Keep the original proportions but never create an out-of-range PDF page.
    const factor = Math.min(0.75, (MAX_PAGE_DIMENSION - 2 * margin) / Math.max(imageWidth, imageHeight));
    width = imageWidth * factor + 2 * margin;
    height = imageHeight * factor + 2 * margin;
  } else {
    [width, height] = PAPER_SIZES[paper];
  }

  // Fit-to-image means the physical page follows the picture itself.
  // A forced Portrait/Landscape option must never change a Fit page's aspect.
  const wantLandscape = paper === 'fit'
    ? imageWidth > imageHeight
    : orientation === 'landscape' || (orientation === 'auto' && imageWidth > imageHeight);
  if (wantLandscape && width < height || !wantLandscape && width > height) {
    [width, height] = [height, width];
  }

  const areaWidth = width - 2 * margin;
  const areaHeight = height - 2 * margin;
  if (!(areaWidth > 0 && areaHeight > 0)) throw new Error('Image PDF margins leave no room for a picture.');
  const scale = Math.min(areaWidth / imageWidth, areaHeight / imageHeight);
  const drawWidth = imageWidth * scale, drawHeight = imageHeight * scale;
  return {
    width, height, margin,
    image: { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight },
  };
}
