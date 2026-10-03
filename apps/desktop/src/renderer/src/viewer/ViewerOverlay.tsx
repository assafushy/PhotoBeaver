import type { AssetSummary } from '@photobeaver/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { InfoPanel } from './InfoPanel';
import { MediaStage } from './MediaStage';

const navButton =
  'rounded-full bg-black/40 px-3 py-2 text-white hover:bg-black/70 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-amber-500';

function useViewerKeys(handlers: Record<string, () => void>) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const handler = latest.current[event.key];
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
}

/**
 * Steps through the library. The position lives in a ref updated on every step,
 * because route changes render as transitions: a second key press can arrive
 * before the viewer re-renders, and must still move from the latest position.
 *
 * @param items - Library items in display order.
 * @param index - Index of the asset in the current render.
 * @param navigate - Router navigate function.
 * @returns A function that moves by a delta.
 */
function useViewerPosition(
  items: AssetSummary[],
  index: number,
  navigate: ReturnType<typeof useNavigate>,
) {
  const position = useRef(index);
  useLayoutEffect(() => {
    position.current = index;
  }, [index]);
  return useCallback(
    (delta: number) => {
      const target = items[position.current + delta];
      if (!target) return;
      position.current += delta;
      navigate(`/library/asset/${target.id}`, { replace: true });
    },
    [items, navigate],
  );
}

interface ControlsProps {
  showInfo: boolean;
  onClose(): void;
  onToggleInfo(): void;
}

interface StepButtonsProps {
  index: number;
  count: number;
  go(delta: number): void;
}

function TopControls({ showInfo, onClose, onToggleInfo }: ControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="absolute top-3 right-3 left-3 flex justify-between">
      <button type="button" className={navButton} onClick={onClose}>
        {t('viewer.close')}
      </button>
      <button type="button" className={navButton} onClick={onToggleInfo} aria-pressed={showInfo}>
        {t('viewer.info')}
      </button>
    </div>
  );
}

const STEPS = {
  previous: { delta: -1, side: 'left-3', labelKey: 'viewer.previous', glyph: '‹' },
  next: { delta: 1, side: 'right-3', labelKey: 'viewer.next', glyph: '›' },
} as const;

function StepButton({
  step,
  disabled,
  go,
}: {
  step: keyof typeof STEPS;
  disabled: boolean;
  go(delta: number): void;
}) {
  const { t } = useTranslation();
  const { delta, side, labelKey, glyph } = STEPS[step];
  return (
    <button
      type="button"
      className={`${navButton} absolute ${side}`}
      onClick={() => go(delta)}
      disabled={disabled}
      aria-label={t(labelKey)}
    >
      {glyph}
    </button>
  );
}

function StepButtons({ index, count, go }: StepButtonsProps) {
  return (
    <>
      <StepButton step="previous" disabled={index === 0} go={go} />
      <StepButton step="next" disabled={index === count - 1} go={go} />
    </>
  );
}

function useViewerState() {
  const navigate = useNavigate();
  const { assetId } = useParams();
  const { items } = useOutletContext<{ items: AssetSummary[] }>();
  const [showInfo, setShowInfo] = useState(true);
  const index = items.findIndex((item) => item.id === assetId);
  const go = useViewerPosition(items, index, navigate);
  const close = useCallback(() => navigate('/library'), [navigate]);
  const toggleInfo = useCallback(() => setShowInfo((v) => !v), []);
  useViewerKeys({
    Escape: close,
    ArrowRight: () => go(1),
    ArrowLeft: () => go(-1),
    i: toggleInfo,
  });
  return { items, index, asset: items[index], showInfo, go, close, toggleInfo };
}

/**
 * Full-screen viewer over the library (SPEC 8.1): next/prev with arrows, Esc to
 * close, "i" toggles the info panel. The grid stays mounted underneath, so its
 * scroll position survives.
 */
export function ViewerOverlay() {
  const { t } = useTranslation();
  const { items, index, asset, showInfo, go, close, toggleInfo } = useViewerState();
  if (!asset) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('viewer.label')}
      className="fixed inset-0 z-50 flex bg-black"
      data-testid="viewer"
    >
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <MediaStage asset={asset} />
        <TopControls showInfo={showInfo} onClose={close} onToggleInfo={toggleInfo} />
        <StepButtons index={index} count={items.length} go={go} />
      </div>
      {showInfo && <InfoPanel assetId={asset.id} />}
    </div>
  );
}
