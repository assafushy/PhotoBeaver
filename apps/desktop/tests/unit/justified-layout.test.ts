import { describe, expect, it } from 'vitest';
import { justifiedLayout, type LayoutInput } from '../../src/renderer/src/library/justified-layout';

const DAY = 86_400_000;
const options = { containerWidth: 1000, targetRowHeight: 200, gap: 4, headerHeight: 40 };

function items(count: number, capturedAt: number | null, width = 300, height = 200): LayoutInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${capturedAt}-${i}`,
    width,
    height,
    capturedAt,
  }));
}

describe('justifiedLayout', () => {
  it('fills full rows to the container width and keeps the last row at target height', () => {
    const layout = justifiedLayout(items(7, 0), options);
    const tileRows = layout.rows.filter((r) => r.kind === 'tiles');
    expect(tileRows).toHaveLength(2);
    const first = tileRows[0]!;
    if (first.kind !== 'tiles') throw new Error();
    const right = first.tiles.at(-1)!.left + first.tiles.at(-1)!.width;
    expect(right).toBeCloseTo(1000, 5);
    expect(first.height).toBeLessThanOrEqual(200);
    expect(tileRows[1]!.height).toBe(200);
  });

  it('starts a header per day and a month mark per month, undated last', () => {
    const data = [
      ...items(2, 40 * DAY),
      ...items(1, 39 * DAY),
      ...items(1, 2 * DAY),
      ...items(1, null),
    ];
    const layout = justifiedLayout(data, options);
    expect(layout.rows.filter((r) => r.kind === 'header').map((r) => r.key)).toEqual([
      'h-1970-02-10',
      'h-1970-02-09',
      'h-1970-01-03',
      'h-undated',
    ]);
    expect(layout.months.map((m) => m.key)).toEqual(['1970-02', '1970-01', 'undated']);
  });

  it('treats unknown dimensions as square and maps every item to its row', () => {
    const data = [{ id: 'a', width: null, height: null, capturedAt: 0 }, ...items(3, 0)];
    const layout = justifiedLayout(data, options);
    expect(layout.rowOfIndex).toHaveLength(4);
    expect(layout.rowOfIndex.every((row) => layout.rows[row]!.kind === 'tiles')).toBe(true);
    expect(layout.totalHeight).toBeGreaterThan(0);
  });

  it('handles an empty library', () => {
    expect(justifiedLayout([], options)).toEqual({
      rows: [],
      totalHeight: 0,
      months: [],
      rowOfIndex: [],
    });
  });
});
