import type { ConfigSchema } from '@photobeaver/shared';

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  type: 'connector';
  apiVersion: string;
  description?: string;
  permissions?: Record<string, unknown>;
  connector: {
    syncModes: ('poll' | 'watch' | 'manual')[];
    defaultIntervalSec: number;
    minIntervalSec?: number;
    multipleSources?: boolean;
  };
  configSchema?: ConfigSchema;
}
