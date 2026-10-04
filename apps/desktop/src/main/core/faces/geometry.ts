export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Intersection over union of two boxes in the same units.
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns 0 (disjoint) to 1 (identical).
 */
export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Pairs each new box with the best unused existing box at or above the threshold.
 * Existing boxes earlier in `existing` win ties, so callers order them by priority
 * (user-assigned faces first).
 *
 * @param fresh - New boxes.
 * @param existing - Existing boxes, highest priority first.
 * @param threshold - Minimum IoU for a match.
 * @returns For each new box, the index of its existing match or -1.
 */
export function matchBoxes(fresh: Box[], existing: Box[], threshold: number): number[] {
  const used = new Set<number>();
  return fresh.map((box) => {
    let best = -1;
    let bestScore = -1;
    existing.forEach((candidate, index) => {
      const score = iou(box, candidate);
      if (!used.has(index) && score >= threshold && score > bestScore)
        [best, bestScore] = [index, score];
    });
    if (best !== -1) used.add(best);
    return best;
  });
}
