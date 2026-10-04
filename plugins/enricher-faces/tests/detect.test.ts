import { describe, expect, it } from 'vitest';
import { decodeStride, groupOutputs, type OutputTensor } from '../src/detect/decode';
import { detectFaces, selectFaces } from '../src/detect/scrfd';
import { imageOf } from './helpers';

const SIZE = 640;
const ANCHORS = 2;

interface Hit {
  stride: number;
  index: number;
  score: number;
  box: number[];
  kps: number[];
}

function strideOutputs(stride: number, hits: Hit[]): OutputTensor[] {
  const rows = (SIZE / stride) ** 2 * ANCHORS;
  const scores = new Float32Array(rows);
  const boxes = new Float32Array(rows * 4);
  const kps = new Float32Array(rows * 10);
  for (const hit of hits.filter((h) => h.stride === stride)) {
    scores[hit.index] = hit.score;
    boxes.set(hit.box, hit.index * 4);
    kps.set(hit.kps, hit.index * 10);
  }
  return [
    { dims: [rows, 1], data: scores },
    { dims: [rows, 4], data: boxes },
    { dims: [rows, 10], data: kps },
  ];
}

function fakeOutputs(hits: Hit[]): OutputTensor[] {
  const all = [8, 16, 32].flatMap((stride) => strideOutputs(stride, hits));
  return [all[4]!, all[0]!, all[8]!, all[2]!, all[6]!, all[1]!, all[3]!, all[7]!, all[5]!];
}

const HIT: Hit = {
  stride: 16,
  index: (5 * 40 + 10) * 2 + 1,
  score: 0.92,
  box: [1, 1, 2, 2],
  kps: [-0.5, -0.25, 0.5, -0.25, 0, 0.25, -0.25, 0.75, 0.25, 0.75],
};

describe('SCRFD output decoding', () => {
  it('groups outputs by shape whatever their order', () => {
    const groups = groupOutputs(fakeOutputs([HIT]), SIZE, ANCHORS);
    expect(
      groups.map((g) => [g.stride, g.scores.length, g.boxes.length, g.landmarks.length]),
    ).toEqual([
      [8, 12800, 51200, 128000],
      [16, 3200, 12800, 32000],
      [32, 800, 3200, 8000],
    ]);
  });

  it('rejects outputs with an unknown shape', () => {
    expect(() =>
      groupOutputs([{ dims: [12800, 3], data: new Float32Array() }], SIZE, ANCHORS),
    ).toThrow(/Unexpected detector output/);
  });

  it('decodes a hit at its anchor and drops low scores', () => {
    const group = groupOutputs(fakeOutputs([HIT]), SIZE, ANCHORS)[1]!;
    const [face] = decodeStride(group, SIZE, ANCHORS, 0.5);
    expect(face!.box).toEqual([144, 64, 192, 112]);
    expect(face!.score).toBeCloseTo(0.92);
    expect(face!.landmarks[0]).toEqual({ x: 152, y: 76 });
    expect(decodeStride(group, SIZE, ANCHORS, 0.95)).toEqual([]);
  });
});

describe('detectFaces', () => {
  it('maps faces back to image pixels through the letterbox', async () => {
    const image = imageOf(1280, 960, () => [0, 0, 0]);
    const run = async () => fakeOutputs([HIT]);
    const faces = await detectFaces(image, run, { threshold: 0.5, minFaceSize: 40, maxFaces: 50 });
    expect(faces).toHaveLength(1);
    expect(faces[0]!.box).toEqual([288, 128, 384, 224]);
    expect(faces[0]!.landmarks[2]).toEqual({ x: 320, y: 168 });
  });

  it('drops small faces and keeps the largest first, up to the cap', () => {
    const face = (side: number) => ({
      box: [0, 0, side, side] as [number, number, number, number],
      score: 0.9,
      landmarks: [],
    });
    const kept = selectFaces([face(30), face(50), face(90), face(70)], {
      threshold: 0.5,
      minFaceSize: 40,
      maxFaces: 2,
    });
    expect(kept.map((f) => f.box[2])).toEqual([90, 70]);
  });
});
