import { dayKey, monthKey } from './dates';

export interface LayoutInput {
  id: string;
  width: number | null;
  height: number | null;
  capturedAt: number | null;
}

export interface LayoutOptions {
  containerWidth: number;
  targetRowHeight: number;
  gap: number;
  headerHeight: number;
}

export interface PlacedTile {
  id: string;
  index: number;
  left: number;
  width: number;
}

export type LayoutRow =
  | { kind: 'header'; key: string; top: number; height: number; capturedAt: number | null }
  | { kind: 'tiles'; key: string; top: number; height: number; tiles: PlacedTile[] };

export interface MonthMark {
  key: string;
  top: number;
  capturedAt: number | null;
}

export interface Layout {
  rows: LayoutRow[];
  totalHeight: number;
  months: MonthMark[];
  rowOfIndex: number[];
}

const MIN_ASPECT = 0.3;
const MAX_ASPECT = 4;

function aspectOf(item: LayoutInput): number {
  if (!item.width || !item.height) return 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, item.width / item.height));
}

function groupByDay(items: readonly LayoutInput[]): { key: string; indexes: number[] }[] {
  const groups: { key: string; indexes: number[] }[] = [];
  items.forEach((item, index) => {
    const key = dayKey(item.capturedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, indexes: [] });
    groups.at(-1)!.indexes.push(index);
  });
  return groups;
}

function rowHeightFor(aspects: number[], options: LayoutOptions): number {
  const available = options.containerWidth - options.gap * (aspects.length - 1);
  return available / aspects.reduce((sum, a) => sum + a, 0);
}

function placeRow(indexes: number[], aspects: number[], height: number, gap: number): PlacedTile[] {
  let left = 0;
  return indexes.map((index, i) => {
    const width = aspects[i]! * height;
    const tile = { id: '', index, left, width };
    left += width + gap;
    return tile;
  });
}

function splitRows(
  indexes: number[],
  items: readonly LayoutInput[],
  options: LayoutOptions,
): { indexes: number[]; height: number }[] {
  const rows: { indexes: number[]; height: number }[] = [];
  let current: number[] = [];
  for (const index of indexes) {
    current.push(index);
    const height = rowHeightFor(
      current.map((i) => aspectOf(items[i]!)),
      options,
    );
    if (height <= options.targetRowHeight) {
      rows.push({ indexes: current, height });
      current = [];
    }
  }
  if (current.length > 0) rows.push({ indexes: current, height: options.targetRowHeight });
  return rows;
}

interface LayoutState {
  rows: LayoutRow[];
  months: MonthMark[];
  rowOfIndex: number[];
  top: number;
}

function addHeader(state: LayoutState, key: string, capturedAt: number | null, height: number) {
  if (state.months.at(-1)?.key !== monthKey(capturedAt))
    state.months.push({ key: monthKey(capturedAt), top: state.top, capturedAt });
  state.rows.push({ kind: 'header', key: `h-${key}`, top: state.top, height, capturedAt });
  state.top += height;
}

function addTileRow(
  state: LayoutState,
  row: { indexes: number[]; height: number },
  items: readonly LayoutInput[],
  gap: number,
) {
  const aspects = row.indexes.map((i) => aspectOf(items[i]!));
  const tiles = placeRow(row.indexes, aspects, row.height, gap);
  for (const tile of tiles) {
    tile.id = items[tile.index]!.id;
    state.rowOfIndex[tile.index] = state.rows.length;
  }
  state.rows.push({
    kind: 'tiles',
    key: `r-${tiles[0]!.id}`,
    top: state.top,
    height: row.height,
    tiles,
  });
  state.top += row.height + gap;
}

/**
 * Computes a justified grid grouped by day (SPEC 8.1 Library): every full row is
 * scaled to the container width, a day's last row keeps the target height.
 *
 * @param items - Assets in display order (newest first).
 * @param options - Container width, target row height, gap and header height.
 * @returns Positioned rows, total height, month marks for the scrubber, and the row of each item.
 */
export function justifiedLayout(items: readonly LayoutInput[], options: LayoutOptions): Layout {
  const state: LayoutState = { rows: [], months: [], rowOfIndex: new Array(items.length), top: 0 };
  for (const group of groupByDay(items)) {
    addHeader(state, group.key, items[group.indexes[0]!]!.capturedAt, options.headerHeight);
    for (const row of splitRows(group.indexes, items, options))
      addTileRow(state, row, items, options.gap);
  }
  const { rows, months, rowOfIndex, top } = state;
  return { rows, totalHeight: top, months, rowOfIndex };
}
