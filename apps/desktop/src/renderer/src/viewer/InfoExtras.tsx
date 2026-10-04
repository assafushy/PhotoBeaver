import type { AssetDetail } from '@photobeaver/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { faceUrl } from '../people/use-people';
import { cameraLines, formatValue } from './camera';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1.5">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-sm break-words text-neutral-100">{children}</dd>
    </div>
  );
}

const linkButton = 'text-xs text-amber-400 hover:underline';

function ShowOnMapButton({ lat, lon }: { lat: number; lon: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`${linkButton} ml-2`}
      onClick={() => navigate(`/map?lat=${lat}&lon=${lon}`)}
    >
      {t('viewer.showOnMap')}
    </button>
  );
}

export function PlaceRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  const { lat, lon } = asset;
  if (lat === null || lon === null) {
    return asset.place ? <Row label={t('viewer.place')}>{asset.place}</Row> : null;
  }
  return (
    <Row label={t('viewer.place')}>
      <span data-testid="viewer-place">
        {asset.place ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`}
      </span>
      <ShowOnMapButton lat={lat} lon={lon} />
    </Row>
  );
}

export function CameraRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  const lines = cameraLines(asset);
  if (!lines) return null;
  return (
    <Row label={t('viewer.camera')}>
      {[lines.camera, lines.lens, lines.exposure].filter(Boolean).map((line) => (
        <div key={line}>{line}</div>
      ))}
    </Row>
  );
}

function FaceChip({ face }: { face: AssetDetail['faces'][number] }) {
  const { t } = useTranslation();
  const body = (
    <>
      <img src={faceUrl(face.id)} alt="" className="h-8 w-8 rounded-full object-cover" />
      <span className="text-xs">{face.personName ?? t('people.unnamed')}</span>
    </>
  );
  if (!face.personId) return <li className="flex items-center gap-1 opacity-70">{body}</li>;
  return (
    <li>
      <Link
        to={`/people/${face.personId}`}
        className="flex items-center gap-1 hover:underline"
        data-testid="viewer-person"
      >
        {body}
      </Link>
    </li>
  );
}

export function PeopleRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  if (asset.faces.length === 0) return null;
  return (
    <Row label={t('viewer.people')}>
      <ul className="flex flex-wrap gap-2">
        {asset.faces.map((face) => (
          <FaceChip key={face.id} face={face} />
        ))}
      </ul>
    </Row>
  );
}

export function TagsRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  if (asset.tags.length === 0) return null;
  return (
    <Row label={t('viewer.tags')}>
      <ul className="flex flex-wrap gap-1">
        {asset.tags.map((tag) => (
          <li
            key={`${tag.kind}:${tag.name}`}
            className="rounded bg-neutral-800 px-2 py-0.5 text-xs"
          >
            {tag.name}
          </li>
        ))}
      </ul>
    </Row>
  );
}

function EnrichmentGroup({ pluginId, data }: AssetDetail['enrichments'][number]) {
  return (
    <li className="rounded bg-neutral-800 p-2">
      <div className="text-xs font-medium text-neutral-300">{pluginId}</div>
      <dl className="mt-1 space-y-0.5 text-xs text-neutral-400">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="break-words">
            <span className="text-neutral-500">{key}: </span>
            {formatValue(value)}
          </div>
        ))}
      </dl>
    </li>
  );
}

export function EnrichmentsRow({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  if (asset.enrichments.length === 0) return null;
  return (
    <Row label={t('viewer.pluginData')}>
      <ul className="space-y-2">
        {asset.enrichments.map((e) => (
          <EnrichmentGroup key={e.pluginId} {...e} />
        ))}
      </ul>
    </Row>
  );
}

export function UndoMergeButton({ asset }: { asset: AssetDetail }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const undo = useMutation({
    mutationFn: () => window.pb.merges.undo(asset.mergeIds[0]!),
    onSuccess: () => void client.invalidateQueries(),
  });
  if (asset.mergeIds.length === 0) return null;
  return (
    <button
      type="button"
      className={`${linkButton} mt-3`}
      disabled={undo.isPending}
      onClick={() => undo.mutate()}
      data-testid="undo-merge"
    >
      {t('viewer.undoMerge')}
    </button>
  );
}
