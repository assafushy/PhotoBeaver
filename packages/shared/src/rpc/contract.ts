import { z } from 'zod';

export const HOST_METHODS = {
  init: 'host.init',
  deactivate: 'plugin.deactivate',
  setupSource: 'connector.setupSource',
  testSource: 'connector.testSource',
  sync: 'connector.sync',
  getOriginal: 'connector.getOriginal',
  getThumbnail: 'connector.getThumbnail',
  watch: 'connector.watch',
  unwatch: 'connector.unwatch',
} as const;

export const CORE_METHODS = {
  log: 'ctx.log',
  storageGet: 'ctx.storage.get',
  storageSet: 'ctx.storage.set',
  storageDelete: 'ctx.storage.delete',
  settings: 'ctx.settings',
  secretGet: 'ctx.secret.get',
  secretSet: 'ctx.secret.set',
  pickDirectory: 'ctx.ui.pickDirectory',
  notify: 'ctx.ui.notify',
  isKnown: 'ctx.sync.isKnown',
  progress: 'ctx.sync.progress',
  watchChange: 'watch.change',
} as const;

export const hostInitSchema = z.object({
  pluginId: z.string(),
  pluginDir: z.string(),
  main: z.string(),
  dataDir: z.string(),
  tempDir: z.string(),
  network: z.array(z.string()),
  filesystem: z.enum(['none', 'user-selected']),
  grantedDirs: z.array(z.string()),
  rateLimit: z.object({ requests: z.number(), perSec: z.number() }).optional(),
});

export const hostCapabilitiesSchema = z.object({
  type: z.enum(['connector', 'enricher']),
  getThumbnail: z.boolean(),
  testSource: z.boolean(),
  watch: z.boolean(),
});

export const sourceCallSchema = z.object({
  contextId: z.string(),
  sourceId: z.string(),
  config: z.unknown(),
  grantedDirs: z.array(z.string()).default([]),
});

const itemRefSchema = z.object({
  sourceId: z.string(),
  externalId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const syncCallSchema = sourceCallSchema.extend({ cursor: z.string().nullable() });
export const itemCallSchema = sourceCallSchema.extend({
  item: itemRefSchema,
  size: z.number().int().positive().optional(),
});
export const watchCallSchema = sourceCallSchema.extend({ watchId: z.string() });
export const unwatchCallSchema = z.object({ watchId: z.string() });
export const setupResultSchema = z.object({
  displayName: z.string().min(1),
  secret: z.record(z.string(), z.unknown()).optional(),
});

export const logParamsSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  msg: z.string().max(10_000),
  data: z.record(z.string(), z.unknown()).optional(),
});
export const storageKeySchema = z.object({ key: z.string().min(1).max(512) });
export const storageSetSchema = storageKeySchema.extend({ value: z.unknown() });
export const contextParamsSchema = z.object({ contextId: z.string() });
export const secretSetSchema = contextParamsSchema.extend({
  value: z.record(z.string(), z.unknown()),
});
export const notifyParamsSchema = contextParamsSchema.extend({
  msg: z.string().max(2000),
  level: z.enum(['info', 'warn', 'error']).default('info'),
});
export const isKnownParamsSchema = contextParamsSchema.extend({
  externalIds: z.array(z.string()).max(5000),
});
export const progressParamsSchema = contextParamsSchema.extend({
  done: z.number(),
  total: z.number().optional(),
  message: z.string().optional(),
});
export const watchChangeSchema = z.object({ watchId: z.string(), batch: z.unknown() });

export type HostInit = z.infer<typeof hostInitSchema>;
export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>;
export type SourceCall = z.input<typeof sourceCallSchema>;
export type SyncCall = z.input<typeof syncCallSchema>;
export type ItemCall = z.input<typeof itemCallSchema>;
export type WatchCall = z.input<typeof watchCallSchema>;

/**
 * Wraps a zod schema as an RpcPeer params validator.
 *
 * @param schema - The schema for the params.
 * @returns A function that parses params or throws a readable error.
 */
export function validatorOf<T>(schema: z.ZodType<T>): (params: unknown) => T {
  return (params) => {
    const result = schema.safeParse(params);
    if (!result.success)
      throw new Error(
        `Invalid params: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    return result.data;
  };
}
