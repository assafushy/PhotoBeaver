import { describe, expect, it } from 'vitest';
import { normalizeBox } from '../src/analyze';
import { ALIGNED_SIZE } from '../src/align/warp';
import { embedFaces, recognitionBatch } from '../src/embed/arcface';
import { decodePng, readPng } from '../src/image/rgb';
import { resizeBilinear } from '../src/image/sample';
import { encodePng, imageOf, tempDir, writePng } from './helpers';

describe('PNG decoding', () => {
  const image = imageOf(5, 3, (x, y) => [x * 50, y * 100, (x + y) * 10]);

  it('round-trips RGB pixels and drops alpha', async () => {
    expect(decodePng(encodePng(image))).toEqual(image);
    expect(await readPng(await writePng(tempDir(), 'a.png', image))).toEqual(image);
  });
});

describe('resizeBilinear', () => {
  it('keeps flat colors and halves a gradient with half-pixel centers', () => {
    const flat = resizeBilinear(
      imageOf(10, 10, () => [9, 99, 199]),
      4,
      4,
    );
    expect(new Set(flat.data)).toEqual(new Set([9, 99, 199]));
    const gradient = resizeBilinear(
      imageOf(8, 1, (x) => [x * 10, 0, 0]),
      4,
      1,
    );
    expect([0, 1, 2, 3].map((x) => gradient.data[x * 3])).toEqual([5, 25, 45, 65]);
  });
});

describe('recognition input', () => {
  it('stacks faces planar with (x - 127.5) / 127.5', () => {
    const white = imageOf(ALIGNED_SIZE, ALIGNED_SIZE, () => [255, 0, 255]);
    const tensor = recognitionBatch([white, white]);
    const plane = ALIGNED_SIZE * ALIGNED_SIZE;
    expect(tensor).toHaveLength(2 * 3 * plane);
    expect([tensor[0], tensor[plane], tensor[2 * plane], tensor[3 * plane]]).toEqual([1, -1, 1, 1]);
  });

  it('runs one batch and returns unit-length embeddings per face', async () => {
    const face = imageOf(ALIGNED_SIZE, ALIGNED_SIZE, () => [0, 0, 0]);
    const counts: number[] = [];
    const run = async (_input: Float32Array, count: number) => {
      counts.push(count);
      return Float32Array.from({ length: count * 512 }, (_, i) => (i < 512 ? 2 : -3));
    };
    const embeddings = await embedFaces([face, face], run);
    expect(counts).toEqual([2]);
    expect(embeddings[0]![0]).toBeCloseTo(1 / Math.sqrt(512));
    expect(embeddings[1]![0]).toBeCloseTo(-1 / Math.sqrt(512));
    expect(await embedFaces([], run)).toEqual([]);
  });
});

describe('normalizeBox', () => {
  it('normalizes and clips to the image', () => {
    expect(normalizeBox([100, 50, 300, 250], 400, 500)).toEqual({
      x: 0.25,
      y: 0.1,
      w: 0.5,
      h: 0.4,
    });
    expect(normalizeBox([-40, -10, 440, 100], 400, 100)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
