import type { SyncProgress } from './media';

export interface Logger {
  debug(msg: string, data?: object): void;
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginContext {
  pluginId: string;
  log: Logger;
  storage: PluginStorage;
  dataDir: string;
  fetch: typeof fetch;
  settings<T>(): Promise<T>;
  signal: AbortSignal;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

export interface OAuthAuthorizeOptions {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  extraParams?: Record<string, string>;
}

export interface OAuthRefreshOptions {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}

export interface SourceContext<Config> extends PluginContext {
  sourceId: string;
  config: Config;
  secret: {
    get(): Promise<Record<string, unknown> | undefined>;
    set(value: Record<string, unknown>): Promise<void>;
  };
  oauth: {
    authorize(opts: OAuthAuthorizeOptions): Promise<OAuthTokens>;
    refresh(opts: OAuthRefreshOptions): Promise<OAuthTokens>;
  };
  ui: {
    pickDirectory(): Promise<string | null>;
    notify(msg: string, level?: 'info' | 'warn' | 'error'): void;
  };
}

export interface KnownItemState {
  etag?: string;
  modifiedAt?: string;
}

export interface SyncContext<Config> extends SourceContext<Config> {
  reportProgress(progress: SyncProgress): void;
  isKnown(externalIds: string[]): Promise<Record<string, KnownItemState>>;
}
