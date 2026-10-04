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
  /** Short progress text shown on the plugin's card (e.g. "Downloading models: 45%"); null clears it. */
  status(text: string | null): void;
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
  /** Sent to the token endpoint for providers whose desktop clients have one (Google). */
  clientSecret?: string;
  /** Loopback host for the redirect URI. Defaults to 127.0.0.1. */
  redirectHost?: '127.0.0.1' | 'localhost';
  /** Ports to try in order, for providers that need an exact registered redirect URI. */
  redirectPorts?: number[];
}

export interface OAuthRefreshOptions {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
  clientSecret?: string;
  /** Sent with the refresh request; some providers (Microsoft) expect it. */
  scopes?: string[];
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
    /** Opens an https URL on a host in the plugin's network allowlist in the system browser. */
    openExternal(url: string): Promise<void>;
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
