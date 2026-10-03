import { useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMonth } from './dates';
import { useElementSize } from './use-element-size';
import type { MonthMark } from './justified-layout';

interface ScrubberProps {
  months: MonthMark[];
  totalHeight: number;
  viewportHeight: number;
  scrollTop: number;
  onScrollTo(top: number): void;
}

const MIN_LABEL_GAP_PX = 16;

function yearLabels(
  months: MonthMark[],
  totalHeight: number,
  barHeight: number,
): { key: string; y: number }[] {
  const labels: { key: string; y: number }[] = [];
  months.forEach((mark, i) => {
    const year = mark.key.slice(0, 4);
    if (mark.capturedAt === null || (i > 0 && months[i - 1]!.key.slice(0, 4) === year)) return;
    const y = (mark.top / Math.max(1, totalHeight)) * barHeight;
    if (labels.length === 0 || y - labels.at(-1)!.y >= MIN_LABEL_GAP_PX)
      labels.push({ key: year, y });
  });
  return labels;
}

function markAt(months: MonthMark[], top: number): MonthMark | undefined {
  let found: MonthMark | undefined;
  for (const mark of months) {
    if (mark.top > top) break;
    found = mark;
  }
  return found;
}

type Hover = { y: number; top: number };

function contentAt(bar: HTMLDivElement, clientY: number, totalHeight: number): Hover {
  const rect = bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return { y: ratio * rect.height, top: ratio * totalHeight };
}

function scrubberAria(label: string, percent: number) {
  return {
    role: 'scrollbar',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuenow': Math.round(percent),
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-controls': 'library-grid',
  } as const;
}

function useYearLabels(bar: RefObject<HTMLDivElement>, months: MonthMark[], totalHeight: number) {
  const { height: barHeight } = useElementSize(bar);
  return useMemo(
    () => yearLabels(months, totalHeight, barHeight),
    [months, totalHeight, barHeight],
  );
}

function useScrubberPointer(
  bar: RefObject<HTMLDivElement>,
  totalHeight: number,
  scrollable: number,
  onScrollTo: (top: number) => void,
) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState(false);
  const toContent = (clientY: number) => contentAt(bar.current!, clientY, totalHeight);
  const scrollToPointer = (event: PointerEvent) =>
    onScrollTo(Math.min(scrollable, toContent(event.clientY).top));
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => (
      e.currentTarget.setPointerCapture(e.pointerId),
      setDragging(true),
      scrollToPointer(e)
    ),
    onPointerMove: (e: PointerEvent) => (
      setHover(toContent(e.clientY)),
      dragging && scrollToPointer(e)
    ),
    onPointerUp: () => setDragging(false),
    onPointerLeave: () => setHover(null),
  };
  return { hover, handlers };
}

function YearLabels({ years }: { years: { key: string; y: number }[] }) {
  const labels = years.map((label) => (
    <span
      key={label.key}
      className="absolute right-1 text-[10px] text-neutral-500"
      style={{ top: label.y }}
    >
      {label.key}
    </span>
  ));
  return <>{labels}</>;
}

function HoverLabel({ hover, months }: { hover: Hover | null; months: MonthMark[] }) {
  const { t } = useTranslation();
  const hovered = hover ? markAt(months, hover.top) : undefined;
  if (!hover || !hovered) return null;
  return (
    <div
      className="pointer-events-none absolute right-full mr-1 rounded bg-neutral-900 px-2 py-0.5 text-xs whitespace-nowrap text-white"
      style={{ top: hover.y - 10 }}
    >
      {hovered.capturedAt === null ? t('library.undated') : formatMonth(hovered.capturedAt)}
    </div>
  );
}

/**
 * Scrubbable timeline on the right edge of the grid (SPEC 8.1). Shows year marks,
 * the month under the pointer, and scrolls the grid on click or drag.
 */
export function TimelineScrubber({
  months,
  totalHeight,
  viewportHeight,
  scrollTop,
  onScrollTo,
}: ScrubberProps) {
  const { t } = useTranslation();
  const bar = useRef<HTMLDivElement>(null);
  const scrollable = Math.max(1, totalHeight - viewportHeight);
  const { hover, handlers } = useScrubberPointer(bar, totalHeight, scrollable, onScrollTo);
  const years = useYearLabels(bar, months, totalHeight);
  const thumbTop = (scrollTop / scrollable) * 100;
  return (
    <div
      ref={bar}
      {...scrubberAria(t('library.timeline'), thumbTop)}
      className="relative w-14 shrink-0 cursor-ns-resize select-none border-l border-neutral-200 dark:border-neutral-800"
      {...handlers}
    >
      <YearLabels years={years} />
      <div className="absolute right-0 left-0 h-0.5 bg-amber-500" style={{ top: `${thumbTop}%` }} />
      <HoverLabel hover={hover} months={months} />
    </div>
  );
}
