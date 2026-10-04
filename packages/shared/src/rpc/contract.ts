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
  enrich: 'enricher.enrich',
  enrichBatch: 'enricher.enrichBatch',
  finalize: 'enricher.finalize',
} as const;

export const CORE_METHODS = {
  log: 'ctx.log',
  status: 'ctx.status',
  storageGet: 'ctx.storage.get',
  storageSet: 'ctx.storage.set',
  storageDelete: 'ctx.storage.delete',
  settings: 'ctx.settings',
  secretGet: 'ctx.secret.get',
  secretSet: 'ctx.secret.set',
  pickDirectory: 'ctx.ui.pickDirectory',
  notify: 'ctx.ui.notify',
  openExternal: 'ctx.ui.openExternal',
  oauthAuthorize: 'ctx.oauth.authorize',
  oauthRefresh: 'ctx.oauth.refresh',
  isKnown: 'ctx.sync.isKnown',
  progress: 'ctx.sync.progress',
  watchChange: 'watch.change',
  getInput: 'ctx.enrich.getInput',
  findByIdentity: 'ctx.assets.findByIdentity',
  listIdentity: 'ctx.assets.listIdentity',
  isMergeBlocked: 'ctx.assets.isMergeBlocked',
  suggestDuplicates: 'ctx.assets.suggestDuplicates',
} as const;

export const hostInitSchema = z.object({
  pluginId: z.string(),
  type: z.enum(['connector', 'enricher']).default('connector'),
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
  enrichBatch: z.boolean().default(false),
  finalize: z.boolean().default(false),
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
export const statusParamsSchema = z.object({ text: z.string().max(200).nullable() });
export const storageKeySchema = z.object({ key: z.string().min(1).max(512) });
export const storageSetSchema = storageKeySchema.extend({ value: z.unknown() });
export const contextParamsSchema = z.object({ contextId: z.string() });
export const secretSetSchema = contextParamsSchema.extend({
  value: z.record(z.string(), z.unknown()),
});
export const openExternalSchema = contextParamsSchema.extend({ url: z.url().max(4000) });
const httpsUrl = z.url().max(4000);
export const oauthAuthorizeSchema = contextParamsSchema.extend({
  options: z.object({
    authUrl: httpsUrl,
    tokenUrl: httpsUrl,
    clientId: z.string().min(1).max(500),
    scopes: z.array(z.string().max(500)).max(50),
    extraParams: z.record(z.string(), z.string().max(2000)).optional(),
    clientSecret: z.string().max(500).optional(),
    redirectHost: z.enum(['127.0.0.1', 'localhost']).optional(),
    redirectPorts: z.array(z.number().int().min(1024).max(65535)).max(10).optional(),
  }),
});
export const oauthRefreshSchema = contextParamsSchema.extend({
  options: z.object({
    tokenUrl: httpsUrl,
    clientId: z.string().min(1).max(500),
    refreshToken: z.string().min(1).max(10_000),
    clientSecret: z.string().max(500).optional(),
    scopes: z.array(z.string().max(500)).max(50).optional(),
  }),
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

const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const contentHashSchema = z.object({ algo: z.string(), value: z.string() });

export const assetViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video']),
  mime: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  capturedAt: z.string().optional(),
  location: geoPointSchema.optional(),
  instances: z.array(
    z.object({
      sourceId: z.string(),
      filename: z.string().optional(),
      path: z.string().optional(),
      caption: z.string().optional(),
      sizeBytes: z.number().optional(),
      contentHash: contentHashSchema.optional(),
    }),
  ),
  enrichments: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const suggestionSchema = z.object({
  assetIds: z.array(z.string()).min(2).max(50),
  kind: z.enum(['exact', 'near']),
  confidence: z.number().min(0).max(1),
});

export const enrichmentResultSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  tags: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1).optional(),
        kind: z.enum(['auto', 'place']).optional(),
      }),
    )
    .max(500)
    .optional(),
  capturedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
    .optional(),
  location: geoPointSchema.optional(),
  dimensions: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      durationMs: z.number().nonnegative().optional(),
    })
    .optional(),
  faces: z
    .array(
      z.object({
        bbox: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0).max(1),
          h: z.number().min(0).max(1),
        }),
        confidence: z.number().min(0).max(1),
        embedding: z.array(z.number().finite()).max(1024).optional(),
      }),
    )
    .max(200)
    .optional(),
  searchText: z.string().max(10_000).optional(),
  identityKeys: z.array(z.string().min(1).max(512)).max(100).optional(),
  mergeWith: z.array(z.string()).max(50).optional(),
  suggestDuplicates: z.array(suggestionSchema).max(50).optional(),
});

export const enrichOutcomeSchema = z.union([
  z.object({ skipped: z.literal(true) }),
  z.object({ skipped: z.literal(false), result: z.unknown() }),
]);

export const enrichCallSchema = z.object({ contextId: z.string(), asset: assetViewSchema });
export const enrichBatchCallSchema = z.object({
  contextId: z.string(),
  assets: z.array(assetViewSchema).max(64),
});
export const finalizeCallSchema = z.object({ contextId: z.string() });
export const getInputParamsSchema = z.object({
  contextId: z.string(),
  assetId: z.string(),
  input: z.enum(['thumbnail', 'original']).optional(),
  format: z.enum(['png']).optional(),
});
export const findByIdentitySchema = z.object({
  contextId: z.string(),
  keys: z.array(z.string()).max(1000),
  excludeAssetId: z.string().optional(),
});
export const listIdentitySchema = z.object({
  contextId: z.string(),
  prefix: z.string().min(1).max(64),
  cursor: z.string().optional(),
});
export const mergeBlockedSchema = z.object({ contextId: z.string(), a: z.string(), b: z.string() });
export const suggestDuplicatesSchema = z.object({
  contextId: z.string(),
  suggestions: z.array(suggestionSchema).max(500),
});

export type EnrichOutcome = z.infer<typeof enrichOutcomeSchema>;
export type EnrichmentResultPayload = z.infer<typeof enrichmentResultSchema>;
