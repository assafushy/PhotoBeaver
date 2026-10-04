import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const devRequestSchema = z.object({
  cmd: z.enum(['load', 'reload']),
  path: z.string().min(1),
});

export type DevRequest = z.infer<typeof devRequestSchema>;
export type DevResponse = { ok: true; pluginId: string } | { ok: false; error: string };

/**
 * Where a running Photo Beaver in developer mode listens for `pb-plugin dev`
 * (SPEC 5.5): a per-user Unix socket, or a named pipe on Windows.
 * `PB_DEV_SOCKET` overrides it (tests, several profiles).
 *
 * @returns Socket path or pipe name.
 */
export function devSocketPath(): string {
  if (process.env.PB_DEV_SOCKET) return process.env.PB_DEV_SOCKET;
  const user = userInfo().username.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (process.platform === 'win32') return `\\\\.\\pipe\\photobeaver-dev-${user}`;
  return path.join(tmpdir(), `photobeaver-dev-${user}.sock`);
}

/**
 * Parses one line of the dev socket protocol (newline-delimited JSON).
 *
 * @param line - Raw line.
 * @returns The request, or an error message.
 */
export function parseDevRequest(line: string): { request: DevRequest } | { error: string } {
  try {
    const result = devRequestSchema.safeParse(JSON.parse(line));
    return result.success ? { request: result.data } : { error: 'Invalid request' };
  } catch {
    return { error: 'Invalid JSON' };
  }
}
