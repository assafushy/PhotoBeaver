import type { Point } from '../detect/anchors';

export type Affine = [number, number, number, number, number, number];

export const ARCFACE_TEMPLATE: Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

function mean(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

interface Sums {
  dotSum: number;
  crossSum: number;
  norm: number;
}

function crossSums(src: Point[], dst: Point[], ms: Point, md: Point): Sums {
  let dotSum = 0;
  let crossSum = 0;
  let norm = 0;
  src.forEach((s, i) => {
    const sx = s.x - ms.x;
    const sy = s.y - ms.y;
    const dx = dst[i]!.x - md.x;
    const dy = dst[i]!.y - md.y;
    dotSum += sx * dx + sy * dy;
    crossSum += sx * dy - sy * dx;
    norm += sx * sx + sy * sy;
  });
  return { dotSum, crossSum, norm };
}

/**
 * Least-squares similarity transform (rotation, uniform scale, translation, no
 * reflection) mapping `src` onto `dst`. In 2D this is the closed form of
 * Umeyama's method, which InsightFace uses through scikit-image.
 *
 * @param src - Source points.
 * @param dst - Destination points, same count.
 * @returns Row-major 2 x 3 matrix [a, -b, tx, b, a, ty].
 */
export function estimateSimilarity(src: Point[], dst: Point[]): Affine {
  if (src.length !== dst.length || src.length < 2)
    throw new Error('Need at least two matching point pairs');
  const ms = mean(src);
  const md = mean(dst);
  const { dotSum, crossSum, norm } = crossSums(src, dst, ms, md);
  const a = norm > 0 ? dotSum / norm : 1;
  const b = norm > 0 ? crossSum / norm : 0;
  return [a, -b, md.x - (a * ms.x - b * ms.y), b, a, md.y - (b * ms.x + a * ms.y)];
}

/**
 * Applies a 2 x 3 affine matrix to a point.
 *
 * @param m - Row-major matrix.
 * @param p - Point.
 * @returns The transformed point.
 */
export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
}

/**
 * Inverts a 2 x 3 affine matrix.
 *
 * @param m - Row-major matrix.
 * @returns The inverse matrix.
 * @throws Error when the matrix is singular.
 */
export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-12) throw new Error('Affine matrix is not invertible');
  const i0 = m[4] / det;
  const i1 = -m[1] / det;
  const i3 = -m[3] / det;
  const i4 = m[0] / det;
  return [i0, i1, -(i0 * m[2] + i1 * m[5]), i3, i4, -(i3 * m[2] + i4 * m[5])];
}
