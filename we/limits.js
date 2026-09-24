export const LIMITS = Object.freeze({ packageBytes: 256 * 1024 * 1024, pixels: 32 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024, texturePoolBytes: 256 * 1024 * 1024, compositePixels: 64 * 1024 * 1024 });
export function bounded(value, maximum, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} 超出安全上限 (${value}/${maximum})`);
  return value;
}
export function pixels(width, height) {
  bounded(width, 16384, '图像宽度', 1); bounded(height, 16384, '图像高度', 1);
  return bounded(width * height, LIMITS.pixels, '图像像素数', 1);
}
