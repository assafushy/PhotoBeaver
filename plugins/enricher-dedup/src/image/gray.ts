import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export interface GrayImage {
  width: number;
  height: number;
  pixels: Float64Array;
}

/**
 * Converts RGBA bytes to luma (ITU-R BT.601 weights).
 *
 * @param rgba - Pixel bytes, 4 per pixel.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns A grayscale image with values 0..255.
 */
export function rgbaToGray(rgba: Uint8Array, width: number, height: number): GrayImage {
  const pixels = new Float64Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    const p = i * 4;
    pixels[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }
  return { width, height, pixels };
}

/**
 * Decodes a PNG file into a grayscale image.
 *
 * @param file - Path of a PNG file.
 * @returns The grayscale image.
 */
export async function readGrayPng(file: string): Promise<GrayImage> {
  const png = PNG.sync.read(await readFile(file));
  return rgbaToGray(png.data, png.width, png.height);
}
