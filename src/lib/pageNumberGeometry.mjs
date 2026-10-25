/**
 * Position a page number in the VISIBLE crop-box coordinate system, then
 * inverse-transform that position into the underlying PDF user space.
 *
 * PDF /Rotate is clockwise. pdf-lib drawText rotation is counterclockwise,
 * so drawing the text at the same positive angle keeps the digits upright.
 */
export function pageNumberPlacement(crop, degrees, textWidth, fontSize, position = 'bottom-center', margin = 24) {
  const rotation = ((degrees % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation) ||
      !['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'].includes(position)) {
    throw new Error('Unsupported page number rotation or position.');
  }
  const values = [crop?.x, crop?.y, crop?.width, crop?.height, textWidth, fontSize, margin];
  if (values.some(value => !Number.isFinite(value)) || crop.width <= 0 || crop.height <= 0 ||
      textWidth <= 0 || fontSize <= 0) {
    throw new Error('Invalid PDF crop-box dimensions for page numbering.');
  }
  if (margin < 8 || margin > 72) throw new Error('Page number margin must be from 8 to 72 points.');
  const sideways = rotation === 90 || rotation === 270;
  const visualWidth = sideways ? crop.height : crop.width;
  const visualHeight = sideways ? crop.width : crop.height;
  // With the default 24pt margin preserve the historical 28pt horizontal,
  // 22pt top and 24pt bottom positions, including rotated/cropped pages.
  if (visualWidth < textWidth + 2 * (margin + 4) || visualHeight < fontSize + 2 * margin - 2) {
    throw new Error('Page is too small for page numbers at this font size. Choose a smaller font or a larger page.');
  }
  const visibleX = position.endsWith('right')
    ? visualWidth - (margin + 4) - textWidth
    : position.endsWith('left') ? margin + 4 : (visualWidth - textWidth) / 2;
  const visibleY = position.startsWith('top')
    ? visualHeight - fontSize - (margin - 2)
    : margin;
  let ux, uy;
  switch (rotation) {
    case 90: ux = crop.width - visibleY; uy = visibleX; break;
    case 180: ux = crop.width - visibleX; uy = crop.height - visibleY; break;
    case 270: ux = visibleY; uy = crop.height - visibleX; break;
    default: ux = visibleX; uy = visibleY; break;
  }
  return { x: crop.x + ux, y: crop.y + uy, rotation, visibleX, visibleY, visualWidth, visualHeight };
}
