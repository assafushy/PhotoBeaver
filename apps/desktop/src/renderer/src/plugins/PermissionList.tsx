import type { PluginSummary } from '@photobeaver/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

type Permissions = NonNullable<PluginSummary['permissions']>;

function permissionLines(p: Permissions, t: TFunction): { text: string; warn: boolean }[] {
  const lines = [
    {
      text: p.network.length
        ? t('plugins.perm.network', { hosts: p.network.join(', ') })
        : t('plugins.perm.noNetwork'),
      warn: p.network.length > 0,
    },
    { text: t(`plugins.perm.fs.${p.filesystem}`), warn: false },
  ];
  if (p.originals !== 'none')
    lines.push({ text: t(`plugins.perm.originals.${p.originals}`), warn: false });
  if (p.assets === 'merge') lines.push({ text: t('plugins.perm.merge'), warn: true });
  if (p.oauth) lines.push({ text: t('plugins.perm.oauth'), warn: false });
  if (p.nativeModules) lines.push({ text: t('plugins.perm.native'), warn: true });
  if (p.gpu) lines.push({ text: t('plugins.perm.gpu'), warn: false });
  return lines;
}

/**
 * What a plugin may do, in plain words (SPEC 5.4 consent; SPEC 6.6 shows native modules prominently).
 */
export function PermissionList({ permissions }: { permissions: Permissions }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-sm" data-testid="permission-list">
      {permissionLines(permissions, t).map((line) => (
        <li
          key={line.text}
          className={
            line.warn
              ? 'font-medium text-amber-700 dark:text-amber-400'
              : 'text-neutral-600 dark:text-neutral-300'
          }
        >
          {line.text}
        </li>
      ))}
    </ul>
  );
}
