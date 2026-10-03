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
