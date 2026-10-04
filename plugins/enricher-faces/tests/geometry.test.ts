import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  estimateSimilarity,
  invertAffine,
  type Affine,
} from '../src/align/similarity';
import { alignFace, warpAffine } from '../src/align/warp';
import { anchorCenters, distance2bbox, distance2kps, type RawFace } from '../src/detect/anchors';
import { computeLetterbox, letterboxTensor } from '../src/detect/letterbox';
import { iou, nms } from '../src/detect/nms';
import { cosineDistance, l2Normalize } from '../src/embed/vector';
import { imageOf } from './helpers';

function face(box: RawFace['box'], score: number): RawFace {
  return { box, score, landmarks: [] };
}

describe('letterbox', () => {
  it('fits landscape images to the width and portrait images to the height', () => {
    expect(computeLetterbox(1024, 768, 640)).toEqual({
      size: 640,
      width: 640,
      height: 480,
      scale: 0.625,
    });
    expect(computeLetterbox(768, 1024, 640)).toEqual({
      size: 640,
      width: 480,
      height: 640,
      scale: 0.625,
    });
    expect(computeLetterbox(1000, 333, 640)).toMatchObject({ width: 640, height: 213 });
  });

  it('places the image top left on a black square, normalized and planar', () => {
    const image = imageOf(4, 2, () => [255, 128, 0] as [number, number, number]);
    const tensor = letterboxTensor(image, computeLetterbox(4, 2, 4));
    expect(tensor).toHaveLength(48);
    expect(tensor[0]).toBeCloseTo(127.5 / 128);
    expect(tensor[16]).toBeCloseTo(0.5 / 128);
    expect(tensor[32]).toBeCloseTo(-127.5 / 128);
    expect(tensor[8]).toBeCloseTo(-127.5 / 128);
  });
});

describe('anchors', () => {
  it('lists each grid corner row by row, once per anchor', () => {
    expect(Array.from(anchorCenters(2, 2, 8, 2))).toEqual([
      0, 0, 0, 0, 8, 0, 8, 0, 0, 8, 0, 8, 8, 8, 8, 8,
    ]);
  });

  it('decodes distances into boxes and keypoints', () => {
    expect(distance2bbox(16, 24, [2, 3, 4, 5])).toEqual([14, 21, 20, 29]);
    expect(distance2kps(16, 24, [1, -1, 2, -2])).toEqual([
      { x: 17, y: 23 },
      { x: 18, y: 22 },
    ]);
  });
});

describe('nms', () => {
  it('computes IoU with inclusive pixel edges', () => {
    expect(iou([0, 0, 9, 9], [0, 0, 9, 9])).toBe(1);
    expect(iou([0, 0, 9, 9], [5, 0, 14, 9])).toBeCloseTo(50 / 150);
    expect(iou([0, 0, 9, 9], [20, 20, 29, 29])).toBe(0);
  });

  it('keeps the best of overlapping faces and every separate face', () => {
    const kept = nms(
      [face([0, 0, 9, 9], 0.8), face([1, 0, 10, 9], 0.9), face([50, 50, 60, 60], 0.7)],
      0.4,
    );
    expect(kept.map((f) => f.score)).toEqual([0.9, 0.7]);
  });
});

describe('similarity transform', () => {
  const angle = Math.PI / 6;
  const scale = 1.7;
  const truth: Affine = [
    scale * Math.cos(angle),
    -scale * Math.sin(angle),
    12,
    scale * Math.sin(angle),
    scale * Math.cos(angle),
    -5,
  ];
  const src = [
    { x: 10, y: 20 },
    { x: 40, y: 22 },
    { x: 25, y: 35 },
    { x: 14, y: 50 },
    { x: 37, y: 49 },
  ];

  it('recovers a known rotation, scale and translation', () => {
    const estimated = estimateSimilarity(
      src,
      src.map((p) => applyAffine(truth, p)),
    );
    estimated.forEach((value, i) => expect(value).toBeCloseTo(truth[i]!, 9));
  });

  it('inverts affine matrices', () => {
    const p = applyAffine(invertAffine(truth), applyAffine(truth, { x: 3, y: 4 }));
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.y).toBeCloseTo(4, 9);
  });
});

describe('warp', () => {
  const gradient = imageOf(64, 64, (x, y) => [x * 4, y * 4, 100]);

  it('samples bilinearly between pixels', () => {
    const half: Affine = [1, 0, -0.5, 0, 1, -0.25];
    const out = warpAffine(gradient, half, 8, 8);
    expect(out.data[(2 * 8 + 3) * 3]).toBe(Math.round(3.5 * 4));
    expect(out.data[(2 * 8 + 3) * 3 + 1]).toBe(Math.round(2.25 * 4));
    expect(out.data[(2 * 8 + 3) * 3 + 2]).toBe(100);
  });

  it('scales down by two and fills outside the image with black', () => {
    const out = warpAffine(gradient, [0.5, 0, 0, 0, 0.5, 0], 40, 40);
    expect(out.data[(10 * 40 + 10) * 3]).toBe(80);
    expect(out.data[(39 * 40 + 39) * 3 + 2]).toBe(0);
  });

  it('aligns landmarks that already match the template to an identity crop', () => {
    const big = imageOf(112, 112, (x, y) => [x * 2, y * 2, 50]);
    const template = [
      { x: 38.2946, y: 51.6963 },
      { x: 73.5318, y: 51.5014 },
      { x: 56.0252, y: 71.7366 },
      { x: 41.5493, y: 92.3655 },
      { x: 70.7299, y: 92.2041 },
    ];
    expect(alignFace(big, template).data).toEqual(big.data);
  });
});

describe('vectors', () => {
  it('normalizes to unit length and leaves zero vectors alone', () => {
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });

  it('measures cosine distance', () => {
    expect(cosineDistance([1, 0], [2, 0])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [0, 3])).toBeCloseTo(1);
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2);
  });
});
