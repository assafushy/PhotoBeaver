import type { AssetSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { originalUrl, thumbUrl, useThumbVersions } from '../library/thumb-store';
import { useZoom } from './use-zoom';

function NoPreview() {
  const { t } = useTranslation();
  return <p className="text-neutral-400">{t('viewer.noPreview')}</p>;
}

function useOriginal() {
  const [originalReady, setOriginalReady] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  return {
    originalReady,
    originalFailed,
    onLoad: () => setOriginalReady(true),
    onError: () => setOriginalFailed(true),
  };
}

function ZoomedImage({ src, transform }: { src: string; transform: string }) {
  const { t } = useTranslation();
  return (
    <img
      src={src}
      alt={t('viewer.photo')}
      draggable={false}
      className="max-h-full max-w-full object-contain motion-safe:transition-transform"
      style={{ transform }}
      data-testid="viewer-image"
    />
  );
}

function ImageStage({ asset }: { asset: AssetSummary }) {
  const version = useThumbVersions((s) => s.versions[asset.id] ?? 0);
  const { originalReady, originalFailed, onLoad, onError } = useOriginal();
  const zoom = useZoom();
  if (asset.thumbState === 'failed' && originalFailed) return <NoPreview />;
  const src = originalReady ? originalUrl(asset.id) : thumbUrl(asset.id, 1024, version);
  return (
    <div
      className={`flex h-full w-full items-center justify-center overflow-hidden ${zoom.zoomed ? 'cursor-grab' : 'cursor-zoom-in'}`}
      {...zoom.handlers}
    >
      <ZoomedImage src={src} transform={zoom.transform} />
      <img src={originalUrl(asset.id)} alt="" hidden onLoad={onLoad} onError={onError} />
    </div>
  );
}

function VideoStage({ asset }: { asset: AssetSummary }) {
  const { t } = useTranslation();
  return (
    <video
      key={asset.id}
      src={originalUrl(asset.id)}
      controls
      autoPlay
      aria-label={t('viewer.video')}
      className="max-h-full max-w-full"
      data-testid="viewer-video"
    />
  );
}

/**
 * Shows the asset full size: the 1024 thumbnail first, then the original; videos
 * play from the original with seeking (HTTP ranges over `pb-media://`).
 */
export function MediaStage({ asset }: { asset: AssetSummary }) {
  return asset.mediaType === 'video' ? (
    <VideoStage asset={asset} />
  ) : (
    <ImageStage key={asset.id} asset={asset} />
  );
}
