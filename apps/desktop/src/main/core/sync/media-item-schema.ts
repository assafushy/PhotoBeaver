import type { MediaItem, SyncBatch } from '@photobeaver/plugin-sdk';
import { z } from 'zod';

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const albumRef = z.object({ externalId: z.string().min(1), name: z.string() });

export const mediaItemSchema = z.object({
  externalId: z.string().min(1).max(4096),
  kind: z.enum(['image', 'video']),
  mime: z.string().max(255).optional(),
  filename: z.string().max(1024).optional(),
  path: z.string().max(4096).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
  capturedAt: isoDate.optional(),
  modifiedAt: isoDate.optional(),
  etag: z.string().max(1024).optional(),
  contentHash: z.object({ algo: z.string(), value: z.string() }).optional(),
  externalUrl: z.string().max(4096).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .optional(),
  caption: z.string().optional(),
  albums: z.array(albumRef).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const syncBatchSchema = z.object({
  upserts: z.array(z.unknown()).optional(),
  deletes: z.array(z.string().min(1)).optional(),
  albums: z.array(albumRef).optional(),
  cursor: z.string(),
  progress: z
    .object({ done: z.number(), total: z.number().optional(), message: z.string().optional() })
    .optional(),
  isFullScan: z.boolean().optional(),
});

export interface ValidatedBatch extends Omit<SyncBatch, 'upserts'> {
  upserts: MediaItem[];
  rejected: number;
}

/**
 * Validates a batch from a connector. Invalid items are dropped, not fatal;
 * an invalid batch envelope throws.
 *
 * @param raw - The batch as yielded by the connector.
 * @returns The batch with only valid items, and how many were rejected.
 */
export function validateBatch(raw: unknown): ValidatedBatch {
  const batch = syncBatchSchema.parse(raw);
  const results = (batch.upserts ?? []).map((item) => mediaItemSchema.safeParse(item));
  const upserts = results.flatMap((r) => (r.success ? [r.data as MediaItem] : []));
  return { ...batch, upserts, rejected: results.length - upserts.length };
}
