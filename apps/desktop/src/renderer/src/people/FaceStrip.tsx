import type { PersonFacesPage } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { faceUrl } from './use-people';

type Face = PersonFacesPage['items'][number];

interface FaceStripProps {
  faces: Face[];
  selected: ReadonlySet<string>;
  onToggle(faceId: string): void;
}

/**
 * A person's faces as small crops; click to select several for moving.
 */
export function FaceStrip({ faces, selected, onToggle }: FaceStripProps) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('people.faces')}>
      {faces.map((face) => (
        <li key={face.id}>
          <button
            type="button"
            aria-pressed={selected.has(face.id)}
            className={`overflow-hidden rounded-full border-4 ${selected.has(face.id) ? 'border-amber-500' : 'border-transparent'}`}
            onClick={() => onToggle(face.id)}
            data-testid="person-face"
          >
            <img src={faceUrl(face.id)} alt="" className="h-16 w-16 object-cover" />
          </button>
        </li>
      ))}
    </ul>
  );
}
