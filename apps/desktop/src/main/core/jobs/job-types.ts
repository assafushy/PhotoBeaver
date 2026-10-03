import type { schema } from '@photobeaver/db';

export type JobKind = (typeof schema.jobs.$inferSelect)['kind'];

export interface JobRow {
  id: number;
  kind: JobKind;
  plugin_id: string | null;
  source_id: string | null;
  asset_id: string | null;
  payload_json: string | null;
  priority: number;
  status: 'queued' | 'leased' | 'done' | 'failed' | 'dead';
  attempts: number;
  max_attempts: number;
  run_after: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  dedupe_key: string | null;
}

export interface NewJob {
  kind: JobKind;
  pluginId?: string;
  sourceId?: string;
  assetId?: string;
  payload?: unknown;
  priority?: number;
  runAfter?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export const PRIORITY = { ui: 10, thumbnail: 50, background: 100 } as const;
