import type { GrayImage } from './gray';

interface Tap {
  index: number;
  weight: number;
}

function tapsFor(start: number, end: number): Tap[] {
  const taps: Tap[] = [];
  for (let index = Math.floor(start); index < end; index += 1) {
    const weight = Math.min(end, index + 1) - Math.max(start, index);
    if (weight > 0) taps.push({ index, weight });
  }
  return taps;
}

/**
 * Area-averaging weights mapping a source axis onto a smaller (or larger) one.
 *
 * @param from - Source length.
 * @param to - Target length.
 * @returns For each target cell, the source cells it covers and their overlap.
 */
export function areaTaps(from: number, to: number): Tap[][] {
  const scale = from / to;
  return Array.from({ length: to }, (_, i) => tapsFor(i * scale, (i + 1) * scale));
}

function sampleTaps(taps: Tap[], read: (index: number) => number): number {
  let sum = 0;
  let total = 0;
  for (const tap of taps) {
    sum += read(tap.index) * tap.weight;
    total += tap.weight;
  }
  return total > 0 ? sum / total : 0;
}

/**
 * Resizes a grayscale image with area averaging (box filter), separably.
 *
 * @param image - Source image.
 * @param width - Target width.
 * @param height - Target height.
 * @returns The resized image.
 */
export function resizeArea(image: GrayImage, width: number, height: number): GrayImage {
  const xTaps = areaTaps(image.width, width);
  const yTaps = areaTaps(image.height, height);
  const rows = new Float64Array(width * image.height);
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < width; x += 1)
      rows[y * width + x] = sampleTaps(xTaps[x]!, (i) => image.pixels[y * image.width + i]!);
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      pixels[y * width + x] = sampleTaps(yTaps[y]!, (i) => rows[i * width + x]!);
  return { width, height, pixels };
}
