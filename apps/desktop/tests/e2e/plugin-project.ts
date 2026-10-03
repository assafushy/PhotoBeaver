import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CREATE_BIN = path.join(
  REPO,
  'packages/create-photobeaver-plugin/bin/create-photobeaver-plugin.js',
);
const CLI_BIN = path.join(REPO, 'packages/plugin-cli/bin/pb-plugin.js');

/**
 * Scaffolds a connector with `create-photobeaver-plugin` and links the repo SDK
 * into it, as a plugin author would after `npm install`.
 *
 * @param dir - Empty target folder.
 * @param id - Plugin id.
 */
export function scaffoldConnector(dir: string, id: string): void {
  execFileSync(process.execPath, [
    CREATE_BIN,
    dir,
    '--type',
    'connector',
    '--id',
    id,
    '--name',
    'E2E Sample',
    '--sdk',
    path.join(REPO, 'packages/plugin-sdk'),
  ]);
  mkdirSync(path.join(dir, 'node_modules', '@photobeaver'), { recursive: true });
  symlinkSync(
    path.join(REPO, 'packages/plugin-sdk'),
    path.join(dir, 'node_modules', '@photobeaver', 'plugin-sdk'),
    'junction',
  );
}

/**
 * Runs a `pb-plugin` command to completion.
 *
 * @param args - Command and flags.
 * @returns stdout.
 */
export function pbPlugin(args: string[]): string {
  return execFileSync(process.execPath, [CLI_BIN, ...args], { encoding: 'utf8' });
}

/**
 * Starts `pb-plugin dev` against a dev socket.
 *
 * @param dir - Plugin project.
 * @param socket - Dev socket path.
 * @returns The running process.
 */
export function startDev(dir: string, socket: string): ChildProcess {
  return spawn(process.execPath, [CLI_BIN, 'dev', '--dir', dir], {
    env: { ...process.env, PB_DEV_SOCKET: socket },
    stdio: 'pipe',
  });
}

/**
 * Adds a third sample item to the scaffolded connector's source.
 *
 * @param dir - Plugin project.
 */
export function addSampleItem(dir: string): void {
  const file = path.join(dir, 'src', 'index.ts');
  const source = readFileSync(file, 'utf8').replace(
    'export const sampleItems: MediaItem[] = [',
    "export const sampleItems: MediaItem[] = [\n  { externalId: 'sample-3', kind: 'image', mime: 'image/jpeg', filename: 'meadow.jpg', etag: 'v1' },",
  );
  writeFileSync(file, source);
}
