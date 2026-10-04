import type { GrayImage } from './gray';
import { packBits, type Hash64 } from './hash64';
import { resizeArea } from './resize';

const DCT_SIZE = 32;
const LOW_FREQ = 8;
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

function cosineTable(): Float64Array[] {
  return Array.from({ length: LOW_FREQ + 1 }, (_, u) =>
    Float64Array.from({ length: DCT_SIZE }, (_, x) =>
      Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE)),
    ),
  );
}

const COSINES = cosineTable();

function dot(a: Float64Array, read: (i: number) => number): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * read(i);
  return sum;
}

function lowFrequencies(pixels: Float64Array): number[] {
  const rows = Array.from({ length: DCT_SIZE }, (_, y) =>
    COSINES.map((cos) => dot(cos, (x) => pixels[y * DCT_SIZE + x]!)),
  );
  const coefficients: number[] = [];
  for (let v = 1; v <= LOW_FREQ; v += 1)
    for (let u = 1; u <= LOW_FREQ; u += 1) coefficients.push(dot(COSINES[v]!, (y) => rows[y]![u]!));
  return coefficients;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 64-bit DCT perceptual hash: 32x32 area resize, 2D DCT-II, the 8x8 lowest
 * frequencies after the DC row and column, each bit set when above the median.
 *
 * @param image - Grayscale image.
 * @returns The pHash.
 */
export function pHash(image: GrayImage): Hash64 {
  const small = resizeArea(image, DCT_SIZE, DCT_SIZE);
  const coefficients = lowFrequencies(small.pixels);
  const threshold = median(coefficients);
  return packBits(coefficients.map((c) => c > threshold));
}

/**
 * 64-bit difference hash: 9x8 area resize, each bit set when a pixel is
 * brighter than its right neighbour.
 *
 * @param image - Grayscale image.
 * @returns The dHash.
 */
export function dHash(image: GrayImage): Hash64 {
  const small = resizeArea(image, DHASH_WIDTH, DHASH_HEIGHT);
  const bits: boolean[] = [];
  for (let y = 0; y < DHASH_HEIGHT; y += 1)
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1)
      bits.push(small.pixels[y * DHASH_WIDTH + x]! > small.pixels[y * DHASH_WIDTH + x + 1]!);
  return packBits(bits);
}
