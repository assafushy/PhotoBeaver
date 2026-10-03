import { z } from 'zod';
import { PERMISSIONS, type Permission } from './permissions';
import { ROLES } from './roles';
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

export const sessionUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export const appInfoSchema = z.object({
  version: z.string(),
  platform: z.string(),
  userDataDir: z.string(),
  libraryDir: z.string(),
});

export const libraryQueryInputSchema = z.object({
  cursor: libraryCursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(200),
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
});

export const addSourceInputSchema = z.object({
  pluginId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
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
  capturedAtSource: z.enum(['exif', 'source', 'filename', 'mtime']).nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  favorite: z.boolean(),
  thumbState: z.enum(['pending', 'ready', 'failed']).nullable(),
  instances: z.array(assetInstanceSchema),
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

interface ChannelContract<I extends z.ZodType, O extends z.ZodType> {
  requires: Permission;
  input: I;
  output: O;
}

const channel = <I extends z.ZodType, O extends z.ZodType>(
  contract: ChannelContract<I, O>,
): ChannelContract<I, O> => contract;

export const IPC_CONTRACT = {
  'app.info': channel({ requires: 'assets.view', input: emptyInput, output: appInfoSchema }),
  'session.current': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: sessionUserSchema,
  }),
  'library.query': channel({
    requires: 'assets.view',
    input: libraryQueryInputSchema,
    output: libraryPageSchema,
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
} as const;

export type IpcContract = typeof IPC_CONTRACT;
export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcParsedInput<C extends IpcChannel> = z.output<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;

export type AppInfo = IpcOutput<'app.info'>;
export type SessionUser = IpcOutput<'session.current'>;
export type LibraryQueryInput = IpcInput<'library.query'>;
export type LibraryPage = IpcOutput<'library.query'>;
export type AssetSummary = LibraryPage['items'][number];
export type AssetDetail = IpcOutput<'assets.get'>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export type ConnectorInfo = z.infer<typeof connectorInfoSchema>;
export type AddSourceInput = z.infer<typeof addSourceInputSchema>;
export type SyncState = (typeof SYNC_STATES)[number];
export type PluginSummary = z.infer<typeof pluginSummarySchema>;
export type StagedPackageSummary = z.infer<typeof stagedPackageSchema>;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/**
 * Narrows an arbitrary string to a known IPC channel.
 *
 * @param name - The candidate channel name.
 * @returns True when the name is declared in the contract.
 */
export function isIpcChannel(name: string): name is IpcChannel {
  return Object.hasOwn(IPC_CONTRACT, name);
}
