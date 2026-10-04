import { KM_PER_DEGREE } from './distance';

const ROWS = 180;
const COLUMNS = 360;
const POLE_COSINE = 1e-6;

export interface GridIndex {
  lat: Float64Array;
  lon: Float64Array;
  cellStart: Int32Array;
  cellItems: Int32Array;
}

function rowOf(lat: number): number {
  return Math.min(ROWS - 1, Math.max(0, Math.floor(lat + 90)));
}

function wrapColumn(column: number): number {
  return ((column % COLUMNS) + COLUMNS) % COLUMNS;
}

function cellOf(lat: number, lon: number): number {
  return rowOf(lat) * COLUMNS + wrapColumn(Math.floor(lon + 180));
}

function cellStarts(cells: Int32Array): Int32Array {
  const starts = new Int32Array(ROWS * COLUMNS + 1);
  for (const cell of cells) starts[cell + 1]!++;
  for (let i = 1; i < starts.length; i++) starts[i]! += starts[i - 1]!;
  return starts;
}

/**
 * Buckets points into one-degree cells (a compressed sparse row layout), so a
 * radius search only visits the cells it overlaps.
 *
 * @param lat - Latitudes in degrees.
 * @param lon - Longitudes in degrees, same length as `lat`.
 * @returns The grid index.
 */
export function buildGrid(lat: Float64Array, lon: Float64Array): GridIndex {
  const cells = Int32Array.from(lat, (value, i) => cellOf(value, lon[i]!));
  const cellStart = cellStarts(cells);
  const next = cellStart.slice(0, -1);
  const cellItems = new Int32Array(cells.length);
  cells.forEach((cell, i) => (cellItems[next[cell]!++] = i));
  return { lat, lon, cellStart, cellItems };
}

function longitudeSpan(lat: number, latSpan: number): number {
  const cosine = Math.cos((Math.min(90, Math.abs(lat) + latSpan) * Math.PI) / 180);
  return cosine < POLE_COSINE ? 180 : Math.min(180, latSpan / cosine);
}

function visitRow(
  grid: GridIndex,
  row: number,
  columns: number[],
  visit: (i: number) => void,
): void {
  for (const column of columns) {
    const cell = row * COLUMNS + column;
    for (let k = grid.cellStart[cell]!; k < grid.cellStart[cell + 1]!; k++)
      visit(grid.cellItems[k]!);
  }
}

function columnsAround(lon: number, lonSpan: number): number[] {
  const first = Math.floor(lon + 180 - lonSpan);
  const count = Math.min(COLUMNS, Math.floor(lon + 180 + lonSpan) - first + 1);
  return Array.from({ length: count }, (_, i) => wrapColumn(first + i));
}

/**
 * Calls `visit` for every point in the cells that overlap a circle, including
 * cells across the anti-meridian. Points outside the circle may be visited too.
 *
 * @param grid - The grid index.
 * @param lat - Centre latitude in degrees.
 * @param lon - Centre longitude in degrees.
 * @param radiusKm - Search radius in kilometres.
 * @param visit - Called with each candidate point index.
 */
export function forEachNearby(
  grid: GridIndex,
  lat: number,
  lon: number,
  radiusKm: number,
  visit: (i: number) => void,
): void {
  const latSpan = radiusKm / KM_PER_DEGREE;
  const columns = columnsAround(lon, longitudeSpan(lat, latSpan));
  for (let row = rowOf(lat - latSpan); row <= rowOf(lat + latSpan); row++) {
    visitRow(grid, row, columns, visit);
  }
}
