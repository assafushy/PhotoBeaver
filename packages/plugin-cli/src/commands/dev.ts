import type { DevRequest, DevResponse } from '@photobeaver/shared/dev-socket';
import type { CliArgs } from '../args';
import { watchPlugin, type BuildResult } from '../bundle';
import { isNotListening, sendDevRequest } from '../dev-client';
import { untilInterrupted } from '../interrupt';
import type { Output } from '../output';
import { reportBuild } from './build';

export const NOT_LISTENING_MESSAGE =
  'Photo Beaver is not listening. Open Settings > Plugins > Developer and turn on Developer mode.';

export type SendDevRequest = (request: DevRequest) => Promise<DevResponse>;

function reportResponse(out: Output, cmd: DevRequest['cmd'], response: DevResponse): void {
  if (response.ok)
    out.info(`Photo Beaver: ${cmd === 'load' ? 'loaded' : 'reloaded'} ${response.pluginId}`);
  else out.error(`Photo Beaver could not ${cmd} the plugin: ${response.error}`);
}

function reportSendError(out: Output, error: unknown): void {
  out.error(
    isNotListening(error) ? NOT_LISTENING_MESSAGE : `Dev socket error: ${(error as Error).message}`,
  );
}

/**
 * Creates the after-build hook for `pb-plugin dev`: sends `load` until it succeeds,
 * then `reload` after every successful build. Failures are printed, never thrown.
 *
 * @param dir - Absolute plugin folder.
 * @param out - CLI output.
 * @param send - Dev socket client (injectable for tests).
 * @returns The hook to call with each build result.
 */
export function createDevNotifier(
  dir: string,
  out: Output,
  send: SendDevRequest = (request) => sendDevRequest(request),
): (result: BuildResult) => Promise<void> {
  let loaded = false;
  return async (result) => {
    if (reportBuild(out, result) !== 0) return;
    const cmd = loaded ? 'reload' : 'load';
    try {
      const response = await send({ cmd, path: dir });
      reportResponse(out, cmd, response);
      loaded = loaded || response.ok;
    } catch (error) {
      reportSendError(out, error);
    }
  };
}

/**
 * `pb-plugin dev`: watch build plus hot reload in a running Photo Beaver.
 *
 * @param args - Parsed CLI arguments.
 * @param out - CLI output.
 * @returns Process exit code once interrupted.
 */
export async function runDev(args: CliArgs, out: Output): Promise<number> {
  const notify = createDevNotifier(args.dir, out);
  const stop = await watchPlugin(args.dir, (result) => void notify(result));
  out.info('Watching for changes. Press Ctrl+C to stop.');
  return untilInterrupted(stop);
}
