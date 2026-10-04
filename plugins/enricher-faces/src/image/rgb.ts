import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Drops the alpha channel from RGBA bytes.
 *
 * @param rgba - Pixel bytes, 4 per pixel.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns The image with 3 bytes per pixel in RGB order.
 */
export function rgbaToRgb(rgba: Uint8Array, width: number, height: number): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; o < data.length; i += 4, o += 3) {
    data[o] = rgba[i]!;
    data[o + 1] = rgba[i + 1]!;
    data[o + 2] = rgba[i + 2]!;
  }
  return { width, height, data };
}

/**
 * Decodes PNG bytes into an RGB image.
 *
 * @param bytes - A PNG file's contents.
 * @returns The decoded image.
 */
export function decodePng(bytes: Uint8Array): RgbImage {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return rgbaToRgb(png.data, png.width, png.height);
}

/**
 * Reads and decodes a PNG file.
 *
 * @param file - Path of a PNG file.
 * @returns The decoded RGB image.
 */
export async function readPng(file: string): Promise<RgbImage> {
  return decodePng(await readFile(file));
}
