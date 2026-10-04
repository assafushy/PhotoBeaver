import type { AssetDetail } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../lib/format-bytes';
import { usePbEvent } from '../lib/use-pb-event';
import { formatFull } from '../library/dates';
import { CameraRow, EnrichmentsRow, PlaceRow, Row, TagsRow, UndoMergeButton } from './InfoExtras';

type Instance = AssetDetail['instances'][number];

function OpenInSourceButton({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="text-amber-400 hover:underline"
      onClick={() => void window.pb.assets.openInSource(instanceId)}
    >
      {t('viewer.openInSource')}
    </button>
  );
}

function InstanceItem({ instance }: { instance: Instance }) {
  const { t } = useTranslation();
  return (
    <li className="rounded bg-neutral-800 p-2 text-sm">
      <div className="font-medium">{instance.sourceName}</div>
      <div className="text-xs break-all text-neutral-400">
        {[instance.path, instance.filename].filter(Boolean).join('/')}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
        <span>{instance.missing ? t('viewer.missing') : formatBytes(instance.sizeBytes)}</span>
        {instance.canOpen && <OpenInSourceButton instanceId={instance.id} />}
      </div>
    </li>
  );
}

function Instances({ asset }: { asset: AssetDetail }) {
  return (
    <ul className="space-y-2">
      {asset.instances.map((instance) => (
        <InstanceItem key={instance.id} instance={instance} />
      ))}
    </ul>
  );
}

function DateRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  const date = asset.capturedAt === null ? t('library.undated') : formatFull(asset.capturedAt);
  return (
    <Row label={t('viewer.date')}>
      {date}
      {asset.capturedAtSource && (
        <span className="ml-1 text-xs text-neutral-400">
          ({t(`viewer.dateSource.${asset.capturedAtSource}`)})
        </span>
      )}
    </Row>
  );
}

function MediaRows({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  return (
    <>
      {asset.width !== null && asset.height !== null && (
        <Row label={t('viewer.dimensions')}>{`${asset.width} x ${asset.height}`}</Row>
      )}
      {asset.durationMs !== null && (
        <Row label={t('viewer.duration')}>{`${(asset.durationMs / 1000).toFixed(1)} s`}</Row>
      )}
      {asset.mime && <Row label={t('viewer.type')}>{asset.mime}</Row>}
    </>
  );
}

function Details({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <dl>
        <DateRow asset={asset} />
        <PlaceRow asset={asset} />
        <CameraRow asset={asset} />
        <MediaRows asset={asset} />
        <Row label={t('viewer.locations')}>
          <Instances asset={asset} />
        </Row>
        <TagsRow asset={asset} />
        <EnrichmentsRow asset={asset} />
      </dl>
      <UndoMergeButton asset={asset} />
    </>
  );
}

function useAssetDetail(assetId: string) {
  const client = useQueryClient();
  usePbEvent('library.changed', () => void client.invalidateQueries({ queryKey: ['asset'] }));
  return useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => window.pb.assets.get(assetId),
    retry: false,
  });
}

/**
 * Viewer info panel (SPEC 8.1): date and its origin, place, camera, dimensions,
 * type, every location the asset lives in with "Open in source", tags, plugin
 * data, and "Undo merge" for merged assets.
 */
export function InfoPanel({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const { data } = useAssetDetail(assetId);
  return (
    <aside
      aria-label={t('viewer.info')}
      className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4 text-neutral-100"
      data-testid="viewer-info"
    >
      <h2 className="mb-2 text-sm font-semibold">{t('viewer.info')}</h2>
      {data && <Details asset={data} />}
    </aside>
  );
}
