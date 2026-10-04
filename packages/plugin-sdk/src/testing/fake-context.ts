import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  KnownItemState,
  Logger,
  OAuthTokens,
  PluginStorage,
  SourceContext,
  SyncContext,
} from '../context';
import type { SyncProgress } from '../media';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogLine {
  level: LogLevel;
  msg: string;
  data?: object;
}

export interface Notification {
  msg: string;
  level?: 'info' | 'warn' | 'error';
}

export interface FakeRecorder {
  logs: LogLine[];
  progress: SyncProgress[];
  notifications: Notification[];
  storage: Map<string, unknown>;
  secret: Record<string, unknown> | undefined;
}

export interface FakeContextOptions {
  pluginId?: string;
  sourceId?: string;
  known?: Record<string, KnownItemState>;
  pickDirectory?: string | null;
  oauthTokens?: OAuthTokens;
  signal?: AbortSignal;
  dataDir?: string;
  settings?: unknown;
  fetch?: typeof fetch;
}

export type FakeSourceContext<Config> = SourceContext<Config> & { recorded: FakeRecorder };
export type FakeSyncContext<Config> = SyncContext<Config> & { recorded: FakeRecorder };

const DEFAULT_TOKENS: OAuthTokens = {
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  tokenType: 'Bearer',
};

function emptyRecorder(): FakeRecorder {
  return { logs: [], progress: [], notifications: [], storage: new Map(), secret: undefined };
}

function recordingLogger(lines: LogLine[]): Logger {
  const write = (level: LogLevel) => (msg: string, data?: object) => {
    lines.push(data === undefined ? { level, msg } : { level, msg, data });
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

function memoryStorage(store: Map<string, unknown>): PluginStorage {
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  };
}

function fakeSecret(recorded: FakeRecorder): SourceContext<unknown>['secret'] {
  return {
    get: async () => recorded.secret,
    set: async (value) => void (recorded.secret = value),
  };
}

function fakeUi(recorded: FakeRecorder, options: FakeContextOptions): SourceContext<unknown>['ui'] {
  return {
    pickDirectory: async () => options.pickDirectory ?? null,
    notify: (msg, level) => void recorded.notifications.push({ msg, level }),
  };
}

function fakeOAuth(options: FakeContextOptions): SourceContext<unknown>['oauth'] {
  const tokens = options.oauthTokens ?? DEFAULT_TOKENS;
  return { authorize: async () => ({ ...tokens }), refresh: async () => ({ ...tokens }) };
}

/**
 * Builds a fake SourceContext: in-memory storage and secret, fixed OAuth tokens,
 * a configurable directory picker and a logger that records lines.
 *
 * @param config - Source config passed to the plugin.
 * @param options - Overrides for ids, picker result, tokens, signal and data dir.
 * @returns The context plus a `recorded` object with everything the plugin did.
 */
export function createFakeSourceContext<Config>(
  config: Config,
  options: FakeContextOptions = {},
): FakeSourceContext<Config> {
  const recorded = emptyRecorder();
  return {
    pluginId: options.pluginId ?? 'com.example.test-plugin',
    sourceId: options.sourceId ?? 'test-source',
    config,
    log: recordingLogger(recorded.logs),
    storage: memoryStorage(recorded.storage),
    dataDir: options.dataDir ?? mkdtempSync(path.join(tmpdir(), 'pb-plugin-data-')),
    fetch: options.fetch ?? globalThis.fetch,
    settings: async <T>() => (options.settings ?? {}) as T,
    signal: options.signal ?? new AbortController().signal,
    secret: fakeSecret(recorded),
    oauth: fakeOAuth(options),
    ui: fakeUi(recorded, options),
    recorded,
  };
}

function knownLookup(known: Record<string, KnownItemState>): SyncContext<unknown>['isKnown'] {
  return async (ids) => {
    const entries = ids.filter((id) => known[id] !== undefined).map((id) => [id, known[id]!]);
    return Object.fromEntries(entries) as Record<string, KnownItemState>;
  };
}

/**
 * Builds a fake SyncContext. `known` drives `isKnown`, and progress reports are recorded.
 *
 * @param config - Source config passed to the plugin.
 * @param options - Overrides, including the `known` map of externalId to etag/modifiedAt.
 * @returns The context plus a `recorded` object with everything the plugin did.
 */
export function createFakeSyncContext<Config>(
  config: Config,
  options: FakeContextOptions = {},
): FakeSyncContext<Config> {
  const source = createFakeSourceContext(config, options);
  return {
    ...source,
    reportProgress: (progress) => void source.recorded.progress.push(progress),
    isKnown: knownLookup(options.known ?? {}),
  };
}
