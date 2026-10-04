import { settingsSchemaOf, type PluginManifest } from '@photobeaver/shared/manifest';
import type { PluginSummary, StagedPackageSummary } from '@photobeaver/shared';
import type { LoadedPlugin } from './plugin-loader';
import type { PluginRow } from './plugin-rows';
import type { StagedPackage } from './plugin-store';

export interface SummaryInput {
  row: PluginRow;
  loaded: LoadedPlugin | undefined;
  error: string | undefined;
  isDefault: boolean;
  sourceCount: number;
  queueSize: number;
}

function statusOf(input: SummaryInput): PluginSummary['status'] {
  if (!input.row.installPath) return 'uninstalled';
  if (input.error) return 'invalid';
  if (input.row.health === 'crashed') return 'crashed';
  return input.row.enabled ? 'ok' : 'disabled';
}

function storedManifest(row: PluginRow): Partial<PluginManifest> {
  try {
    return JSON.parse(row.manifestJson) as Partial<PluginManifest>;
  } catch {
    return {};
  }
}

function runtimeOf(loaded: LoadedPlugin | undefined) {
  return {
    running: loaded?.handle.isRunning ?? false,
    pid: loaded?.handle.pid ?? null,
    restarts: loaded?.handle.restarts ?? 0,
  };
}

function hasSettings(row: PluginRow, manifest: Partial<PluginManifest>): boolean {
  return settingsSchemaOf({ ...manifest, type: row.type }) !== null;
}

/**
 * What the Plugins screen shows for one plugin.
 *
 * @param input - Row, runtime state and context.
 * @returns The summary.
 */
export function pluginSummary(input: SummaryInput): PluginSummary {
  const { row, loaded } = input;
  const manifest = loaded?.manifest ?? storedManifest(row);
  return {
    id: row.id,
    name: manifest.name ?? row.id,
    version: row.version,
    type: row.type,
    description: manifest.description ?? '',
    enabled: row.enabled === 1,
    status: statusOf(input),
    error: input.error ?? null,
    installSource: row.installSource,
    isDefault: input.isDefault,
    permissions: manifest.permissions ?? null,
    ...runtimeOf(loaded),
    sourceCount: input.sourceCount,
    devPath: row.installSource === 'dev' ? row.installPath : null,
    queueSize: input.queueSize,
    hasSettings: hasSettings(row, manifest),
  };
}

/**
 * What the consent dialog shows for a staged package (SPEC 5.4 step 3).
 *
 * @param token - Staging token.
 * @param staged - Staged package.
 * @param installedVersion - Version currently installed, if any.
 * @returns The summary.
 */
export function stagedSummary(
  token: string,
  staged: StagedPackage,
  installedVersion: string | null,
): StagedPackageSummary {
  const { manifest } = staged;
  return {
    token,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    description: manifest.description,
    author: manifest.author?.name ?? null,
    permissions: manifest.permissions,
    sha256: staged.sha256,
    verified: false,
    replacesVersion: installedVersion,
  };
}
