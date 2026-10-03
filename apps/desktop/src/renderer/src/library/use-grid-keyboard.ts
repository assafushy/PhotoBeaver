import { useCallback, useState, type KeyboardEvent } from 'react';
import type { Layout, PlacedTile } from './justified-layout';

function tilesOfRow(layout: Layout, rowIndex: number | undefined): PlacedTile[] {
  const row = rowIndex === undefined ? undefined : layout.rows[rowIndex];
  return row?.kind === 'tiles' ? row.tiles : [];
}

function nearestInRow(tiles: PlacedTile[], centerX: number): number | null {
  let best: PlacedTile | null = null;
  for (const tile of tiles) {
    const distance = Math.abs(tile.left + tile.width / 2 - centerX);
    if (!best || distance < Math.abs(best.left + best.width / 2 - centerX)) best = tile;
  }
  return best?.index ?? null;
}

function adjacentRowTiles(layout: Layout, fromRow: number, step: 1 | -1): PlacedTile[] {
  for (let r = fromRow + step; r >= 0 && r < layout.rows.length; r += step) {
    const tiles = tilesOfRow(layout, r);
    if (tiles.length > 0) return tiles;
  }
  return [];
}

function verticalTarget(layout: Layout, index: number, step: 1 | -1): number | null {
  const rowIndex = layout.rowOfIndex[index];
  const tile = tilesOfRow(layout, rowIndex).find((t) => t.index === index);
  if (rowIndex === undefined || !tile) return null;
  return nearestInRow(adjacentRowTiles(layout, rowIndex, step), tile.left + tile.width / 2);
}

function keyTargets(layout: Layout, focused: number, count: number): Record<string, number | null> {
  return {
    ArrowRight: Math.min(count - 1, focused + 1),
    ArrowLeft: Math.max(0, focused - 1),
    ArrowDown: verticalTarget(layout, focused, 1),
    ArrowUp: verticalTarget(layout, focused, -1),
    Home: 0,
    End: count - 1,
  };
}

/**
 * Roving keyboard focus for the grid (SPEC 10 accessibility): arrows move between
 * tiles, Home/End jump to the ends, Enter opens.
 *
 * @param layout - Current layout.
 * @param count - Number of items.
 * @param onMove - Scrolls to and focuses an index.
 * @returns The focused index, a setter, and the keydown handler.
 */
export function useGridKeyboard(layout: Layout, count: number, onMove: (index: number) => void) {
  const [focused, setFocused] = useState(0);
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const moves = keyTargets(layout, focused, count);
      if (!(event.key in moves)) return;
      event.preventDefault();
      const target = moves[event.key];
      if (target !== null && target !== undefined && target >= 0) {
        setFocused(target);
        onMove(target);
      }
    },
    [count, focused, layout, onMove],
  );
  return { focused, setFocused, onKeyDown };
}
