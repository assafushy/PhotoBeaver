/**
 * The plugin host went away during a call. Jobs that hit it go back to the queue
 * as a failed attempt and retry once the host can restart (SPEC 7.6).
 */
export class HostCrashedError extends Error {
  override readonly name = 'HostCrashedError';

  constructor(
    pluginId: string,
    readonly retryAfterMs: number,
  ) {
    super(`The plugin host for ${pluginId} stopped unexpectedly`);
  }
}

/**
 * The plugin is not running because it crashed too often, is disabled, or failed to load.
 */
export class PluginUnavailableError extends Error {
  override readonly name = 'PluginUnavailableError';
}

/**
 * Recognizes HostCrashedError by name.
 *
 * @param error - Any thrown value.
 * @returns True for HostCrashedError.
 */
export function isHostCrashedError(error: unknown): error is HostCrashedError {
  return error instanceof Error && error.name === 'HostCrashedError';
}
