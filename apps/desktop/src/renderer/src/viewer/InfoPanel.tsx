import type { AssetDetail } from '@photobeaver/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFull } from '../library/dates';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1.5">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-sm break-words text-neutral-100">{children}</dd>
    </div>
  );
}

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

function Details({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  return (
    <dl>
      <DateRow asset={asset} />
      {asset.width !== null && asset.height !== null && (
        <Row label={t('viewer.dimensions')}>{`${asset.width} x ${asset.height}`}</Row>
      )}
      {asset.durationMs !== null && (
        <Row label={t('viewer.duration')}>{`${(asset.durationMs / 1000).toFixed(1)} s`}</Row>
      )}
      {asset.mime && <Row label={t('viewer.type')}>{asset.mime}</Row>}
      <Row label={t('viewer.locations')}>
        <Instances asset={asset} />
      </Row>
    </dl>
  );
}

/**
 * Viewer info panel (SPEC 8.1): date and its origin, dimensions, type and every
 * location the asset lives in, with "Open in source".
 */
export function InfoPanel({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => window.pb.assets.get(assetId),
  });
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
