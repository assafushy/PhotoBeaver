import { z } from 'zod';

export const syncProgressEventSchema = z.object({
  sourceId: z.string(),
  done: z.number(),
  total: z.number().optional(),
  message: z.string().optional(),
});

export interface ThumbUpdate {
  id: string;
  width: number | null;
  height: number | null;
  thumbState: 'pending' | 'ready' | 'failed';
}

export interface PbEvents {
  'library.changed': Record<string, never>;
  'sources.changed': Record<string, never>;
  'plugins.changed': Record<string, never>;
  'sync.progress': z.infer<typeof syncProgressEventSchema>;
  'thumbs.ready': { items: ThumbUpdate[] };
}

export type PbEventName = keyof PbEvents;
