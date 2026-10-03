import type { AssetSummary } from '@photobeaver/shared';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { thumbUrl, useThumbVersions } from './thumb-store';

interface TileProps {
  asset: AssetSummary;
  index: number;
  left: number;
  width: number;
  height: number;
  focused: boolean;
  onOpen(index: number): void;
  onFocus(index: number): void;
}

function Placeholder({ asset }: { asset: AssetSummary }) {
  const { t } = useTranslation();
  const label = asset.thumbState === 'failed' ? t('library.noPreview') : '';
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-200 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {label}
    </div>
  );
}

function TileImage({ asset }: { asset: AssetSummary }) {
  const version = useThumbVersions((state) => state.versions[asset.id] ?? 0);
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  if (asset.thumbState === 'failed' || failedVersion === version)
    return <Placeholder asset={asset} />;
  return (
    <img
      src={thumbUrl(asset.id, 256, version)}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onError={() => setFailedVersion(version)}
    />
  );
}

function VideoBadge() {
  const { t } = useTranslation();
  return (
    <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">
      {t('library.video')}
    </span>
  );
}

function TileView({ asset, index, left, width, height, focused, onOpen, onFocus }: TileProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-index={index}
      data-asset-id={asset.id}
      data-testid="library-tile"
      tabIndex={focused ? 0 : -1}
      aria-label={t(asset.mediaType === 'video' ? 'library.openVideo' : 'library.openPhoto')}
      className="absolute overflow-hidden rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-amber-500"
      style={{ left, width, height, top: 0 }}
      onClick={() => onOpen(index)}
      onFocus={() => onFocus(index)}
    >
      <TileImage asset={asset} />
      {asset.mediaType === 'video' && <VideoBadge />}
    </button>
  );
}

export const Tile = memo(TileView);
