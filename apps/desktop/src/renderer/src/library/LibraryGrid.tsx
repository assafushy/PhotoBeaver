import type { AssetSummary } from '@photobeaver/shared';
import { useVirtualizer, type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from './dates';
import { justifiedLayout, type Layout, type LayoutRow } from './justified-layout';
import { Tile } from './Tile';
import { TimelineScrubber } from './TimelineScrubber';
import { useElementSize } from './use-element-size';
import { useGridKeyboard } from './use-grid-keyboard';

const LAYOUT = { targetRowHeight: 180, gap: 4, headerHeight: 44 };
const PADDING = 16;

type GridVirtualizer = Virtualizer<HTMLDivElement, Element>;
type GridKeyboard = ReturnType<typeof useGridKeyboard>;

interface GridProps {
  items: AssetSummary[];
  onOpen(index: number): void;
}

interface RowProps {
  row: LayoutRow;
  virtual: VirtualItem;
  items: AssetSummary[];
  keyboard: GridKeyboard;
  onOpen(index: number): void;
}

interface ScrollerProps extends GridProps {
  scroller: RefObject<HTMLDivElement>;
  layout: Layout;
  virtualizer: GridVirtualizer;
  keyboard: GridKeyboard;
  onScrollTop(top: number): void;
}

function DayHeader({ row }: { row: Extract<LayoutRow, { kind: 'header' }> }) {
  const { t } = useTranslation();
  return (
    <h2 className="flex h-full items-end pb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
      {row.capturedAt === null ? t('library.undated') : formatDay(row.capturedAt)}
    </h2>
  );
}

function useLayout(items: AssetSummary[], width: number): Layout {
  return useMemo(
    () => justifiedLayout(items, { ...LAYOUT, containerWidth: Math.max(1, width) }),
    [items, width],
  );
}

function useGridVirtualizer(layout: Layout, scroller: RefObject<HTMLDivElement>): GridVirtualizer {
  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) =>
      layout.rows[i]!.height + (layout.rows[i]!.kind === 'tiles' ? LAYOUT.gap : 0),
    getItemKey: (i) => layout.rows[i]!.key,
    overscan: 6,
  });
  useEffect(() => virtualizer.measure(), [layout, virtualizer]);
  return virtualizer;
}

function useFocusIndex(
  layout: Layout,
  virtualizer: GridVirtualizer,
  scroller: RefObject<HTMLDivElement>,
): (index: number) => void {
  return useCallback(
    (index: number) => {
      const row = layout.rowOfIndex[index];
      if (row !== undefined) virtualizer.scrollToIndex(row, { align: 'auto' });
      requestAnimationFrame(() =>
        scroller.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus(),
      );
    },
    [layout, virtualizer, scroller],
  );
}

function RowTiles({ row, items, keyboard, onOpen }: Omit<RowProps, 'virtual'>) {
  if (row.kind === 'header') return <DayHeader row={row} />;
  const tiles = row.tiles.map((tile) => (
    <Tile
      key={tile.id}
      asset={items[tile.index]!}
      index={tile.index}
      left={tile.left}
      width={tile.width}
      height={row.height}
      focused={keyboard.focused === tile.index}
      onOpen={onOpen}
      onFocus={keyboard.setFocused}
    />
  ));
  return <>{tiles}</>;
}

function GridRow({ virtual, ...rest }: RowProps) {
  return (
    <div
      role="row"
      className="absolute right-0 left-0"
      style={{ top: virtual.start, height: rest.row.height }}
    >
      <RowTiles {...rest} />
    </div>
  );
}

function VirtualRows({
  layout,
  virtualizer,
  keyboard,
  items,
  onOpen,
}: Omit<ScrollerProps, 'scroller' | 'onScrollTop'>) {
  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtual) => (
        <GridRow
          key={virtual.key}
          virtual={virtual}
          row={layout.rows[virtual.index]!}
          items={items}
          keyboard={keyboard}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function GridScroller({ scroller, onScrollTop, ...props }: ScrollerProps) {
  const { t } = useTranslation();
  return (
    <div
      id="library-grid"
      ref={scroller}
      role="grid"
      aria-label={t('library.gridLabel')}
      aria-rowcount={props.layout.rows.length}
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ paddingInline: PADDING }}
      onScroll={(e) => onScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={props.keyboard.onKeyDown}
    >
      <VirtualRows {...props} />
    </div>
  );
}

function useLibraryGrid(items: AssetSummary[]) {
  const scroller = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(scroller);
  const layout = useLayout(items, width);
  const [scrollTop, setScrollTop] = useState(0);
  const virtualizer = useGridVirtualizer(layout, scroller);
  const focusIndex = useFocusIndex(layout, virtualizer, scroller);
  const keyboard = useGridKeyboard(layout, items.length, focusIndex);
  return { scroller, height, layout, scrollTop, setScrollTop, virtualizer, keyboard };
}

/**
 * Virtualized justified grid grouped by day, with a timeline scrubber (SPEC 8.1).
 * Only the rows near the viewport are rendered, so it scales to very large libraries.
 */
function LibraryGridView({ items, onOpen }: GridProps) {
  const { scroller, height, layout, scrollTop, setScrollTop, virtualizer, keyboard } =
    useLibraryGrid(items);
  return (
    <div className="flex min-h-0 flex-1">
      <GridScroller
        {...{ items, onOpen, scroller, layout, virtualizer, keyboard }}
        onScrollTop={setScrollTop}
      />
      <TimelineScrubber
        months={layout.months}
        totalHeight={virtualizer.getTotalSize()}
        viewportHeight={height}
        scrollTop={scrollTop}
        onScrollTo={(top) => scroller.current?.scrollTo({ top })}
      />
    </div>
  );
}

export const LibraryGrid = memo(LibraryGridView);
