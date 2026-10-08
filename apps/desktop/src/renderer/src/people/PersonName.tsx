import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '../session/use-session';
import { usePeopleActions } from './use-people';

interface PersonNameProps {
  id: string;
  name: string | null;
  className?: string;
}

interface NameInputProps {
  draft: string;
  onChange(draft: string): void;
  onSave(): void;
  onCancel(): void;
}

function NameButton({ name, className, onEdit }: Omit<PersonNameProps, 'id'> & { onEdit(): void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`text-left hover:underline ${className}`}
      onClick={onEdit}
      data-testid="person-name"
    >
      {name ?? <span className="text-neutral-400">{t('people.addName')}</span>}
    </button>
  );
}

function NameInput({ draft, onChange, onSave, onCancel }: NameInputProps) {
  const { t } = useTranslation();
  return (
    <input
      autoFocus
      aria-label={t('people.nameLabel')}
      className="w-full rounded border border-neutral-300 bg-transparent px-1 text-sm dark:border-neutral-700"
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSave}
      onKeyDown={(e) =>
        e.key === 'Enter' ? onSave() : e.key === 'Escape' ? onCancel() : undefined
      }
      data-testid="person-name-input"
    />
  );
}

function ReadOnlyName({ name, className }: Omit<PersonNameProps, 'id'>) {
  const { t } = useTranslation();
  return (
    <span className={className} data-testid="person-name">
      {name ?? <span className="text-neutral-400">{t('people.unnamed')}</span>}
    </span>
  );
}

/**
 * A person's name. For users who may edit people it turns into a text field
 * on click; Enter or leaving the field saves it, Escape cancels.
 */
export function PersonName(props: PersonNameProps) {
  const canEdit = useCan('people.edit');
  return canEdit ? <EditableName {...props} /> : <ReadOnlyName {...props} />;
}

function EditableName({ id, name, className = '' }: PersonNameProps) {
  const { rename } = usePeopleActions();
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => (
    draft !== null && draft !== (name ?? '') && rename.mutate({ id, name: draft }),
    setDraft(null)
  );
  if (draft === null)
    return <NameButton name={name} className={className} onEdit={() => setDraft(name ?? '')} />;
  return (
    <NameInput draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
  );
}
