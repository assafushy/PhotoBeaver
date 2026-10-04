import type { RgbImage } from './rgb';

/**
 * Reads one channel with bilinear interpolation. Pixels outside the image read as 0,
 * like OpenCV's constant border.
 *
 * @param image - Source image.
 * @param x - Horizontal position in pixel coordinates (pixel centers at integers).
 * @param y - Vertical position in pixel coordinates.
 * @param channel - 0, 1 or 2 for R, G or B.
 * @returns The interpolated value, 0..255.
 */
export function sampleBilinear(image: RgbImage, x: number, y: number, channel: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const top = lerp(pixel(image, x0, y0, channel), pixel(image, x0 + 1, y0, channel), fx);
  const bottom = lerp(pixel(image, x0, y0 + 1, channel), pixel(image, x0 + 1, y0 + 1, channel), fx);
  return lerp(top, bottom, fy);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pixel(image: RgbImage, x: number, y: number, channel: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  return image.data[(y * image.width + x) * 3 + channel]!;
}

/**
 * Resizes with bilinear interpolation and half-pixel centers, as OpenCV's INTER_LINEAR does.
 *
 * @param image - Source image.
 * @param width - Target width.
 * @param height - Target height.
 * @returns The resized image.
 */
export function resizeBilinear(image: RgbImage, width: number, height: number): RgbImage {
  const data = new Uint8Array(width * height * 3);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy = clamp((y + 0.5) * scaleY - 0.5, 0, image.height - 1);
    for (let x = 0; x < width; x += 1) {
      const sx = clamp((x + 0.5) * scaleX - 0.5, 0, image.width - 1);
      for (let c = 0; c < 3; c += 1)
        data[(y * width + x) * 3 + c] = Math.round(sampleBilinear(image, sx, sy, c));
    }
  }
  return { width, height, data };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Converts an RGB image to a planar (CHW) float tensor with `(value - mean) / std`.
 *
 * @param image - Source image.
 * @param mean - Subtracted from every value.
 * @param std - Divides every value.
 * @param target - Destination array, at least 3 * width * height long.
 * @param offset - Where in `target` to start writing.
 */
export function toPlanar(
  image: RgbImage,
  mean: number,
  std: number,
  target: Float32Array,
  offset = 0,
): void {
  const plane = image.width * image.height;
  for (let i = 0; i < plane; i += 1)
    for (let c = 0; c < 3; c += 1)
      target[offset + c * plane + i] = (image.data[i * 3 + c]! - mean) / std;
}
