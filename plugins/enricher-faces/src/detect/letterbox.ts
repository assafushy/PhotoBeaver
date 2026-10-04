import type { RgbImage } from '../image/rgb';
import { resizeBilinear, toPlanar } from '../image/sample';

export interface Letterbox {
  size: number;
  width: number;
  height: number;
  scale: number;
}

const MEAN = 127.5;
const STD = 128;

/**
 * Fits an image into a square, keeping its aspect ratio and anchoring it at the
 * top left, the way InsightFace's SCRFD prepares its input.
 *
 * @param width - Image width.
 * @param height - Image height.
 * @param size - Side of the square model input.
 * @returns The resized width and height and the scale from image to model pixels.
 */
export function computeLetterbox(width: number, height: number, size: number): Letterbox {
  const ratio = height / width;
  const fitHeight = ratio > 1;
  const newHeight = fitHeight ? size : Math.max(1, Math.trunc(size * ratio));
  const newWidth = fitHeight ? Math.max(1, Math.trunc(size / ratio)) : size;
  return { size, width: newWidth, height: newHeight, scale: newHeight / height };
}

/**
 * Builds the SCRFD input tensor: the letterboxed image on a black square,
 * normalized as `(value - 127.5) / 128`, planar RGB.
 *
 * @param image - Source image.
 * @param box - Letterbox from `computeLetterbox`.
 * @returns A 3 x size x size float tensor.
 */
export function letterboxTensor(image: RgbImage, box: Letterbox): Float32Array {
  const resized = resizeBilinear(image, box.width, box.height);
  const canvas: RgbImage = {
    width: box.size,
    height: box.size,
    data: new Uint8Array(box.size * box.size * 3),
  };
  for (let y = 0; y < box.height; y += 1) {
    const row = resized.data.subarray(y * box.width * 3, (y + 1) * box.width * 3);
    canvas.data.set(row, y * box.size * 3);
  }
  const tensor = new Float32Array(3 * box.size * box.size);
  toPlanar(canvas, MEAN, STD, tensor);
  return tensor;
}
