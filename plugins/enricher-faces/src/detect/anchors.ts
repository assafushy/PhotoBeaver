export interface Point {
  x: number;
  y: number;
}

export interface RawFace {
  box: [number, number, number, number];
  score: number;
  landmarks: Point[];
}

/**
 * Anchor centers for one SCRFD stride: row by row, each grid cell's top-left
 * corner in input pixels, repeated once per anchor.
 *
 * @param rows - Grid rows (input height / stride).
 * @param cols - Grid columns (input width / stride).
 * @param stride - Feature stride in pixels.
 * @param anchors - Anchors per location.
 * @returns Flat array of x, y pairs.
 */
export function anchorCenters(
  rows: number,
  cols: number,
  stride: number,
  anchors: number,
): Float32Array {
  const centers = new Float32Array(rows * cols * anchors * 2);
  let index = 0;
  for (let y = 0; y < rows; y += 1)
    for (let x = 0; x < cols; x += 1)
      for (let a = 0; a < anchors; a += 1) {
        centers[index++] = x * stride;
        centers[index++] = y * stride;
      }
  return centers;
}

/**
 * Turns distances from an anchor center into a box (left, top, right, bottom).
 *
 * @param cx - Anchor center x.
 * @param cy - Anchor center y.
 * @param distances - Left, top, right and bottom distances, already scaled by stride.
 * @returns The box as x1, y1, x2, y2.
 */
export function distance2bbox(
  cx: number,
  cy: number,
  distances: ArrayLike<number>,
): [number, number, number, number] {
  return [cx - distances[0]!, cy - distances[1]!, cx + distances[2]!, cy + distances[3]!];
}

/**
 * Turns keypoint offsets from an anchor center into points.
 *
 * @param cx - Anchor center x.
 * @param cy - Anchor center y.
 * @param offsets - x, y offset pairs, already scaled by stride.
 * @returns The keypoints.
 */
export function distance2kps(cx: number, cy: number, offsets: ArrayLike<number>): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < offsets.length; i += 2)
    points.push({ x: cx + offsets[i]!, y: cy + offsets[i + 1]! });
  return points;
}
