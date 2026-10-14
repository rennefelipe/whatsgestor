export function imageScale(value: number) {
  return Math.max(1, Math.min(8, Number.isFinite(value) ? value : 1));
}
export function imagePan(
  x: number,
  y: number,
  scale: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const maxX = Math.max(0, (imageWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (imageHeight * scale - viewportHeight) / 2);
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, y)),
  };
}
