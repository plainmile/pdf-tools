/**
 * Position a page number in the VISIBLE crop-box coordinate system, then
 * inverse-transform that position into the underlying PDF user space.
 *
 * PDF /Rotate is clockwise. pdf-lib drawText rotation is counterclockwise,
 * so drawing the text at the same positive angle keeps the digits upright.
 */
export function pageNumberPlacement(crop, degrees, textWidth, fontSize, position = 'bottom-center') {
  const rotation = ((degrees % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation) ||
      !['bottom-center', 'bottom-right', 'top-right'].includes(position)) {
    throw new Error('Unsupported page number rotation or position.');
  }
  const values = [crop?.x, crop?.y, crop?.width, crop?.height, textWidth, fontSize];
  if (values.some(value => !Number.isFinite(value)) || crop.width <= 0 || crop.height <= 0 ||
      textWidth <= 0 || fontSize <= 0) {
    throw new Error('Invalid PDF crop-box dimensions for page numbering.');
  }
  const sideways = rotation === 90 || rotation === 270;
  const visualWidth = sideways ? crop.height : crop.width;
  const visualHeight = sideways ? crop.width : crop.height;
  if (visualWidth < textWidth + 56 || visualHeight < fontSize + 46) {
    throw new Error('Page is too small for page numbers at this font size. Choose a smaller font or a larger page.');
  }
  const visibleX = position.endsWith('right')
    ? visualWidth - 28 - textWidth
    : (visualWidth - textWidth) / 2;
  const visibleY = position.startsWith('top')
    ? visualHeight - fontSize - 22
    : 24;
  let ux, uy;
  switch (rotation) {
    case 90: ux = crop.width - visibleY; uy = visibleX; break;
    case 180: ux = crop.width - visibleX; uy = crop.height - visibleY; break;
    case 270: ux = visibleY; uy = crop.height - visibleX; break;
    default: ux = visibleX; uy = visibleY; break;
  }
  return { x: crop.x + ux, y: crop.y + uy, rotation, visibleX, visibleY, visualWidth, visualHeight };
}
