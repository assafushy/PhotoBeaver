import type { UserSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonRow } from '../components/Button';
import { useScopeChoices, useUserActions, type Scopes } from './use-users';
import { UserError } from './UserForm';

interface Choice {
  id: string;
  label: string;
}

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function ChoiceList(props: {
  title: string;
  choices: Choice[];
  selected: string[];
  onToggle(id: string): void;
  testId: string;
}) {
  if (props.choices.length === 0) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-neutral-500">{props.title}</legend>
      {props.choices.map((choice) => (
        <label key={choice.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.selected.includes(choice.id)}
            onChange={() => props.onToggle(choice.id)}
            data-testid={props.testId}
            data-id={choice.id}
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}

function useChoiceLabels() {
  const { t } = useTranslation();
  const { sources, albums } = useScopeChoices();
  return {
    sources: sources.map((source) => ({ id: source.id, label: source.displayName })),
    albums: albums.map((album) => ({
      id: album.id,
      label: album.sourceName
        ? t('users.albumFrom', { name: album.name, source: album.sourceName })
        : album.name,
    })),
  };
}

function ScopeLists({ scopes, onChange }: { scopes: Scopes; onChange(scopes: Scopes): void }) {
  const { t } = useTranslation();
  const choices = useChoiceLabels();
  return (
    <div className="max-h-56 space-y-3 overflow-y-auto">
      <ChoiceList
        title={t('users.scopeSources')}
        choices={choices.sources}
        selected={scopes.sourceIds}
        onToggle={(id) => onChange({ ...scopes, sourceIds: toggled(scopes.sourceIds, id) })}
        testId="scope-source"
      />
      <ChoiceList
        title={t('users.scopeAlbums')}
        choices={choices.albums}
        selected={scopes.albumIds}
        onToggle={(id) => onChange({ ...scopes, albumIds: toggled(scopes.albumIds, id) })}
        testId="scope-album"
      />
    </div>
  );
}

function ScopeSummary({ scopes }: { scopes: Scopes }) {
  const { t } = useTranslation();
  const everything = scopes.sourceIds.length === 0 && scopes.albumIds.length === 0;
  return (
    <p className="text-xs text-neutral-500" data-testid="scope-summary">
      {t(everything ? 'users.scopeEverything' : 'users.scopeLimited')}
    </p>
  );
}

/**
 * What a Viewer or Editor can see (SPEC 3.3): chosen sources and albums, or
 * everything when nothing is chosen.
 *
 * @param props - The user and what to do after saving.
 */
export function ScopeEditor({ user, onSaved }: { user: UserSummary; onSaved(): void }) {
  const { t } = useTranslation();
  const [scopes, setScopes] = useState<Scopes>(user.scopes);
  const { setScopes: save } = useUserActions(onSaved);
  return (
    <section className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <h3 className="text-sm font-semibold">{t('users.scopeTitle')}</h3>
      <ScopeSummary scopes={scopes} />
      <ScopeLists scopes={scopes} onChange={setScopes} />
      <UserError error={save.error} />
      <ButtonRow>
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate({ id: user.id, scopes })}
          testId="save-scopes"
        >
          {t('users.saveScopes')}
        </Button>
      </ButtonRow>
    </section>
  );
}
