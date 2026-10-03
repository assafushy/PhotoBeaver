import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest';
import type { ConnectorManifest } from './core/connectors/manifest';
import type { ConnectorEntry } from './core/connectors/registry';

/**
 * Default connectors loaded in-process in M1 (SPEC 12). M2 moves them into
 * isolated plugin hosts.
 *
 * @returns Registry entries.
 */
export function builtinConnectors(): ConnectorEntry[] {
  return [
    {
      manifest: localManifest as ConnectorManifest,
      plugin: localConnector as ConnectorEntry['plugin'],
    },
  ];
}
