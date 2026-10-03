import path from 'node:path';
import pino, { type Logger } from 'pino';

export type CoreLogger = Logger;

/**
 * Creates the core logger writing to `<logsDir>/core.log`.
 *
 * @param logsDir - Directory for log files (created if missing).
 * @returns A pino logger.
 */
export function createCoreLogger(logsDir: string): CoreLogger {
  const destination = pino.destination({
    dest: path.join(logsDir, 'core.log'),
    mkdir: true,
    sync: false,
  });
  return pino({ level: process.env.PB_LOG_LEVEL ?? 'info' }, destination);
}

/**
 * Creates a plugin's logger writing to `<logsDir>/plugin-<id>.log` (SPEC 10).
 *
 * @param logsDir - Directory for log files.
 * @param pluginId - Plugin id.
 * @returns The logger and its file path.
 */
export function createPluginLogger(
  logsDir: string,
  pluginId: string,
): { log: CoreLogger; file: string } {
  const file = path.join(logsDir, `plugin-${pluginId}.log`);
  const destination = pino.destination({ dest: file, mkdir: true, sync: false });
  return {
    log: pino({ level: process.env.PB_LOG_LEVEL ?? 'info', base: { pluginId } }, destination),
    file,
  };
}
