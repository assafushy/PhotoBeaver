import type { RawFace } from './anchors';

type Box = RawFace['box'];

function area(box: Box): number {
  return (box[2] - box[0] + 1) * (box[3] - box[1] + 1);
}

/**
 * Intersection over union with SCRFD's inclusive pixel convention (+1 on sides).
 *
 * @param a - First box as x1, y1, x2, y2.
 * @param b - Second box.
 * @returns The overlap ratio, 0..1.
 */
export function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1);
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1);
  const inter = w * h;
  return inter / (area(a) + area(b) - inter);
}

/**
 * Greedy non-maximum suppression: keeps the best face, drops faces overlapping
 * it by more than the threshold, and repeats.
 *
 * @param faces - Candidate faces.
 * @param threshold - IoU above which a lower-scored face is dropped.
 * @returns Kept faces, best score first.
 */
export function nms(faces: RawFace[], threshold: number): RawFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: RawFace[] = [];
  for (const face of sorted)
    if (kept.every((other) => iou(other.box, face.box) <= threshold)) kept.push(face);
  return kept;
}
