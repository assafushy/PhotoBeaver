import { z } from 'zod';
import { EDIT_CHANNELS, SESSION_CHANNELS, USER_CHANNELS } from './access-contract';
import { channel } from './ipc-channel';
import type { ConfigSchema } from './config-schema';

const emptyInput = z.undefined();

const libraryCursorSchema = z.object({
  capturedAt: z.number().int(),
  id: z.string().min(1),
});

const assetSummarySchema = z.object({
  id: z.string(),
  mediaType: z.enum(['image', 'video']),
  capturedAt: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumbState: z.enum(['pending', 'ready', 'failed']).nullable(),
});

export const appInfoSchema = z.object({
  version: z.string(),
  platform: z.string(),
  userDataDir: z.string(),
  libraryDir: z.string(),
});

export const libraryFilterSchema = z.object({
  text: z.string().max(200).optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  sourceIds: z.array(z.string()).max(100).optional(),
  mediaTypes: z.array(z.enum(['image', 'video'])).optional(),
  tagIds: z.array(z.string()).max(20).optional(),
  albumIds: z.array(z.string()).max(20).optional(),
  personIds: z.array(z.string()).max(20).optional(),
  favoritesOnly: z.boolean().optional(),
  multiSource: z.boolean().optional(),
});

export const libraryQueryInputSchema = z.object({
  cursor: libraryCursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(200),
  filter: libraryFilterSchema.default({}),
});

const facetSchema = z.object({ id: z.string(), name: z.string(), count: z.number().int() });

export const libraryFacetsSchema = z.object({
  sources: z.array(facetSchema),
  places: z.array(facetSchema),
  tags: z.array(facetSchema),
  people: z.array(facetSchema),
});

export const geoPointsSchema = z.object({
  points: z.array(z.tuple([z.string(), z.number(), z.number()])),
  truncated: z.boolean(),
});

export const libraryPageSchema = z.object({
  items: z.array(assetSummarySchema),
  nextCursor: libraryCursorSchema.nullable(),
  total: z.number().int(),
});

const idInput = z.object({ id: z.string().min(1).max(64) });
const nothing = z.null();

export const SYNC_STATES = [
  'idle',
  'queued',
  'running',
  'error',
  'auth_required',
  'paused',
] as const;

export const sourceSummarySchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  connectorName: z.string(),
  connectorAvailable: z.boolean(),
  displayName: z.string(),
  location: z.string().nullable(),
  syncState: z.enum(SYNC_STATES),
  itemCount: z.number().int(),
  lastSyncFinishedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  nextRunAt: z.number().nullable(),
  intervalSec: z.number().int(),
});

export const connectorInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  configSchema: z.custom<ConfigSchema>((value) => typeof value === 'object' && value !== null),
  usesOAuth: z.boolean(),
});

const setupIdSchema = z.string().min(1).max(100);

export const addSourceInputSchema = z.object({
  pluginId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  setupId: setupIdSchema.optional(),
});

export const assetInstanceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  filename: z.string().nullable(),
  path: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  canOpen: z.boolean(),
  missing: z.boolean(),
});

export const assetDetailSchema = z.object({
  id: z.string(),
  mediaType: z.enum(['image', 'video']),
  mime: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  capturedAt: z.number().int().nullable(),
  capturedAtSource: z.enum(['user', 'exif', 'source', 'enricher', 'filename', 'mtime']).nullable(),
  locationSource: z.enum(['user', 'exif', 'source', 'enricher']).nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  favorite: z.boolean(),
  hidden: z.boolean(),
  thumbState: z.enum(['pending', 'ready', 'failed']).nullable(),
  instances: z.array(assetInstanceSchema),
  albums: z.array(z.object({ id: z.string(), name: z.string(), user: z.boolean() })),
  place: z.string().nullable(),
  tags: z.array(z.object({ name: z.string(), kind: z.enum(['user', 'auto', 'place']) })),
  enrichments: z.array(z.object({ pluginId: z.string(), data: z.record(z.string(), z.unknown()) })),
  mergeIds: z.array(z.string()),
  faces: z.array(
    z.object({
      id: z.string(),
      bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      personId: z.string().nullable(),
      personName: z.string().nullable(),
    }),
  ),
});

export const pluginPermissionsSchema = z.object({
  network: z.array(z.string()),
  filesystem: z.enum(['none', 'user-selected']),
  oauth: z.boolean(),
  originals: z.enum(['none', 'thumbnail', 'read']),
  assets: z.enum(['none', 'merge']),
  nativeModules: z.boolean(),
  gpu: z.boolean(),
});

export const PLUGIN_STATUSES = ['ok', 'crashed', 'invalid', 'disabled', 'uninstalled'] as const;

export const pluginSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  type: z.enum(['connector', 'enricher']),
  description: z.string(),
  enabled: z.boolean(),
  status: z.enum(PLUGIN_STATUSES),
  error: z.string().nullable(),
  installSource: z.enum(['builtin', 'registry', 'file', 'dev']),
  isDefault: z.boolean(),
  permissions: pluginPermissionsSchema.nullable(),
  running: z.boolean(),
  pid: z.number().nullable(),
  restarts: z.number().int(),
  sourceCount: z.number().int(),
  devPath: z.string().nullable(),
  queueSize: z.number().int(),
  activity: z.string().nullable(),
  enableNotice: z
    .object({ title: z.string(), body: z.string(), url: z.string().optional() })
    .nullable(),
  produces: z.array(z.string()),
  hasSettings: z.boolean(),
});

export const stagedPackageSchema = z.object({
  token: z.string(),
  id: z.string(),
  name: z.string(),
  version: z.string(),
  type: z.enum(['connector', 'enricher']),
  description: z.string(),
  author: z.string().nullable(),
  permissions: pluginPermissionsSchema,
  sha256: z.string(),
  verified: z.boolean(),
  replacesVersion: z.string().nullable(),
});

const enabledInput = z.object({ id: z.string().min(1), enabled: z.boolean() });
const uninstallInput = z.object({ id: z.string().min(1), removeData: z.boolean() });
const logsInput = z.object({
  id: z.string().min(1),
  lines: z.number().int().min(1).max(2000).default(200),
});
const pathInput = z.object({ path: z.string().min(1) });
const tokenInput = z.object({ token: z.string().min(1) });

const duplicateAssetSchema = z.object({
  id: z.string(),
  mediaType: z.enum(['image', 'video']),
  width: z.number().nullable(),
  height: z.number().nullable(),
  capturedAt: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  sources: z.array(z.string()),
  place: z.string().nullable(),
});

export const duplicateGroupSchema = z.object({
  id: z.string(),
  kind: z.enum(['exact', 'near']),
  confidence: z.number().nullable(),
  createdAt: z.number().nullable(),
  assets: z.array(duplicateAssetSchema),
});

export const mergeRecordSchema = z.object({
  id: z.string(),
  survivingAssetId: z.string(),
  mergedBy: z.string(),
  createdAt: z.number().nullable(),
});

export const personSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  faceCount: z.number().int(),
  assetCount: z.number().int(),
  coverFaceId: z.string().nullable(),
});

export const personFacesPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      assetId: z.string(),
      bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      assignedBy: z.enum(['user', 'auto']),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const appSettingsSchema = z.object({
  mapTileUrl: z.string().max(500).nullable(),
  duplicatesAlwaysAsk: z.boolean(),
});

export const pluginSettingsSchema = z.object({
  configSchema: z.custom<ConfigSchema>((value) => typeof value === 'object' && value !== null),
  values: z.record(z.string(), z.unknown()),
});

export const IPC_CONTRACT = {
  ...SESSION_CHANNELS,
  ...USER_CHANNELS,
  ...EDIT_CHANNELS,
  'app.info': channel({ requires: 'assets.view', input: emptyInput, output: appInfoSchema }),
  'library.query': channel({
    requires: 'assets.view',
    input: libraryQueryInputSchema,
    output: libraryPageSchema,
  }),
  'library.facets': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: libraryFacetsSchema,
  }),
  'library.geoPoints': channel({
    requires: 'assets.view',
    input: z.object({ filter: libraryFilterSchema.default({}) }),
    output: geoPointsSchema,
  }),
  'assets.get': channel({ requires: 'assets.view', input: idInput, output: assetDetailSchema }),
  'assets.openInSource': channel({ requires: 'assets.view', input: idInput, output: nothing }),
  'sources.list': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.array(sourceSummarySchema),
  }),
  'sources.connectors': channel({
    requires: 'sources.manage',
    input: emptyInput,
    output: z.array(connectorInfoSchema),
  }),
  'sources.add': channel({
    requires: 'sources.manage',
    input: addSourceInputSchema,
    output: sourceSummarySchema,
  }),
  'sources.remove': channel({ requires: 'sources.manage', input: idInput, output: nothing }),
  'sources.reconnect': channel({
    requires: 'sources.manage',
    input: z.object({ id: z.string(), setupId: setupIdSchema.optional() }),
    output: sourceSummarySchema,
  }),
  'sources.cancelSetup': channel({
    requires: 'sources.manage',
    input: z.object({ setupId: setupIdSchema }),
    output: nothing,
  }),
  'sources.pickDirectory': channel({
    requires: 'sources.manage',
    input: emptyInput,
    output: z.string().nullable(),
  }),
  'sources.syncNow': channel({ requires: 'sources.sync', input: idInput, output: nothing }),
  'sources.pause': channel({ requires: 'sources.sync', input: idInput, output: nothing }),
  'sources.resume': channel({ requires: 'sources.sync', input: idInput, output: nothing }),
  'plugins.list': channel({
    requires: 'plugins.manage',
    input: emptyInput,
    output: z.array(pluginSummarySchema),
  }),
  'plugins.setEnabled': channel({
    requires: 'plugins.manage',
    input: enabledInput,
    output: nothing,
  }),
  'plugins.reEnable': channel({ requires: 'plugins.manage', input: idInput, output: nothing }),
  'plugins.uninstall': channel({
    requires: 'plugins.manage',
    input: uninstallInput,
    output: nothing,
  }),
  'plugins.logs': channel({ requires: 'plugins.manage', input: logsInput, output: z.string() }),
  'plugins.pickPackage': channel({
    requires: 'plugins.manage',
    input: emptyInput,
    output: z.string().nullable(),
  }),
  'plugins.inspectPackage': channel({
    requires: 'plugins.manage',
    input: pathInput,
    output: stagedPackageSchema,
  }),
  'plugins.installStaged': channel({
    requires: 'plugins.manage',
    input: tokenInput,
    output: pluginSummarySchema,
  }),
  'plugins.discardStaged': channel({
    requires: 'plugins.manage',
    input: tokenInput,
    output: nothing,
  }),
  'plugins.restoreDefaults': channel({
    requires: 'plugins.manage',
    input: emptyInput,
    output: nothing,
  }),
  'plugins.getDeveloperMode': channel({
    requires: 'plugins.manage',
    input: emptyInput,
    output: z.boolean(),
  }),
  'plugins.setDeveloperMode': channel({
    requires: 'plugins.manage',
    input: z.object({ enabled: z.boolean() }),
    output: nothing,
  }),
  'plugins.loadUnpacked': channel({
    requires: 'plugins.manage',
    input: emptyInput,
    output: pluginSummarySchema.nullable(),
  }),
  'plugins.reload': channel({ requires: 'plugins.manage', input: idInput, output: nothing }),
  'plugins.getSettings': channel({
    requires: 'plugins.manage',
    input: idInput,
    output: pluginSettingsSchema,
  }),
  'plugins.setSettings': channel({
    requires: 'plugins.manage',
    input: z.object({ id: z.string(), values: z.record(z.string(), z.unknown()) }),
    output: nothing,
  }),
  'plugins.rerun': channel({ requires: 'plugins.manage', input: idInput, output: nothing }),
  'plugins.openNotice': channel({ requires: 'plugins.manage', input: idInput, output: nothing }),
  'people.list': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.array(personSummarySchema),
  }),
  'people.faces': channel({
    requires: 'assets.view',
    input: z.object({ id: z.string(), after: z.string().nullable().default(null) }),
    output: personFacesPageSchema,
  }),
  'people.rename': channel({
    requires: 'people.edit',
    input: z.object({ id: z.string(), name: z.string().max(200) }),
    output: nothing,
  }),
  'people.merge': channel({
    requires: 'people.edit',
    input: z.object({ fromId: z.string(), intoId: z.string() }),
    output: nothing,
  }),
  'people.moveFaces': channel({
    requires: 'people.edit',
    input: z.object({
      faceIds: z.array(z.string()).min(1).max(500),
      target: z.union([
        z.object({ personId: z.string() }),
        z.object({ newPerson: z.literal(true) }),
      ]),
    }),
    output: z.object({ personId: z.string() }),
  }),
  'people.rejectFace': channel({
    requires: 'people.edit',
    input: z.object({ faceId: z.string() }),
    output: nothing,
  }),
  'people.setCover': channel({
    requires: 'people.edit',
    input: z.object({ personId: z.string(), faceId: z.string() }),
    output: nothing,
  }),
  'duplicates.list': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.array(duplicateGroupSchema),
  }),
  'duplicates.merge': channel({
    requires: 'duplicates.merge',
    input: z.object({ id: z.string(), keepAssetId: z.string() }),
    output: nothing,
  }),
  'duplicates.dismiss': channel({ requires: 'duplicates.merge', input: idInput, output: nothing }),
  'merges.recent': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.array(mergeRecordSchema),
  }),
  'merges.undo': channel({ requires: 'duplicates.merge', input: idInput, output: nothing }),
  'settings.get': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: appSettingsSchema,
  }),
  'settings.set': channel({
    requires: 'library.admin',
    input: appSettingsSchema.partial(),
    output: nothing,
  }),
} as const;

export type IpcContract = typeof IPC_CONTRACT;
export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcParsedInput<C extends IpcChannel> = z.output<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;

export type AppInfo = IpcOutput<'app.info'>;
export type LibraryQueryInput = IpcInput<'library.query'>;
export type LibraryPage = IpcOutput<'library.query'>;
export type AssetSummary = LibraryPage['items'][number];
export type LibraryFilter = z.infer<typeof libraryFilterSchema>;
export type LibraryFacets = z.infer<typeof libraryFacetsSchema>;
export type GeoPoints = z.infer<typeof geoPointsSchema>;
export type AssetDetail = IpcOutput<'assets.get'>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export type ConnectorInfo = z.infer<typeof connectorInfoSchema>;
export type AddSourceInput = z.infer<typeof addSourceInputSchema>;
export type SyncState = (typeof SYNC_STATES)[number];
export type PluginSummary = z.infer<typeof pluginSummarySchema>;
export type StagedPackageSummary = z.infer<typeof stagedPackageSchema>;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export type MergeRecord = z.infer<typeof mergeRecordSchema>;
export type PersonSummary = z.infer<typeof personSummarySchema>;
export type PersonFacesPage = z.infer<typeof personFacesPageSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type PluginSettingsView = z.infer<typeof pluginSettingsSchema>;

/**
 * Narrows an arbitrary string to a known IPC channel.
 *
 * @param name - The candidate channel name.
 * @returns True when the name is declared in the contract.
 */
export function isIpcChannel(name: string): name is IpcChannel {
  return Object.hasOwn(IPC_CONTRACT, name);
}
