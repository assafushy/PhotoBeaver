import type { AppSettings } from '@photobeaver/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { CheckboxField, Field, inputStyle } from '../components/Field';
import { Button } from '../components/Button';
import { errorMessage } from '../lib/error-message';
import { SettingsSection } from './SettingsSection';

const SETTINGS_KEY = ['settings'] as const;

function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.pb.settings.set(patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}

interface TileUrlProps {
  current: string | null;
  onSave(url: string | null): void;
}

function TileUrlInput({ draft, onChange }: { draft: string; onChange(value: string): void }) {
  return (
    <input
      className={inputStyle}
      value={draft}
      placeholder="https://tile.example.org/{z}/{x}/{y}.png"
      onChange={(e) => onChange(e.target.value)}
      data-testid="map-tile-url"
    />
  );
}

function TileUrlField({ current, onSave }: TileUrlProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(current ?? '');
  const trimmed = draft.trim();
  return (
    <Field label={t('settings.map.tileUrl')}>
      <span className="block text-xs text-neutral-500">{t('settings.map.tileUrlHelp')}</span>
      <span className="flex gap-2">
        <TileUrlInput draft={draft} onChange={setDraft} />
        <Button
          disabled={trimmed === (current ?? '')}
          onClick={() => onSave(trimmed || null)}
          testId="save-map-tiles"
        >
          {t('common.save')}
        </Button>
      </span>
    </Field>
  );
}

function MapControls({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation();
  const save = useSaveSettings();
  return (
    <>
      <TileUrlField
        current={settings.mapTileUrl}
        onSave={(mapTileUrl) => save.mutate({ mapTileUrl })}
      />
      <CheckboxField
        label={t('settings.map.duplicatesAlwaysAsk')}
        checked={settings.duplicatesAlwaysAsk}
        onChange={(duplicatesAlwaysAsk) => save.mutate({ duplicatesAlwaysAsk })}
        testId="duplicates-always-ask"
      />
      {save.error && <ErrorText>{errorMessage(save.error)}</ErrorText>}
    </>
  );
}

/**
 * Settings > Map and duplicates (Admin): the online map tiles and whether
 * duplicates are always reviewed before merging.
 */
export function MapSection() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => window.pb.settings.get() });
  return (
    <SettingsSection title={t('settings.map.title')}>
      {data && <MapControls settings={data} />}
    </SettingsSection>
  );
}
