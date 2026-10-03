import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CliArgs } from '../args';
import type { Output } from '../output';

export interface SpawnCommand {
  command: string;
  args: string[];
}

export const MISSING_VITEST_HINT =
  'Vitest is not installed in this project. Run "npm install --save-dev vitest" and try again.';

function localBin(dir: string): string {
  const name = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';
  return path.join(dir, 'node_modules', '.bin', name);
}

function vitestInstalledAbove(dir: string): boolean {
  for (let current = dir; ; current = path.dirname(current)) {
    if (existsSync(path.join(current, 'node_modules', 'vitest', 'package.json'))) return true;
    if (path.dirname(current) === current) return false;
  }
}

/**
 * Picks how to run Vitest for a project: its own `node_modules/.bin/vitest`, else `npx vitest`
 * when Vitest is installed in a parent folder.
 *
 * @param dir - Plugin project folder.
 * @returns The command to spawn, or null when Vitest is missing.
 */
export function resolveVitest(dir: string): SpawnCommand | null {
  const bin = localBin(dir);
  if (existsSync(bin)) return { command: bin, args: ['run'] };
  if (vitestInstalledAbove(dir)) return { command: 'npx', args: ['vitest', 'run'] };
  return null;
}

function spawnInherit(command: SpawnCommand, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * `pb-plugin test`: runs `vitest run` in the project.
 *
 * @param args - Parsed CLI arguments.
 * @param out - CLI output.
 * @returns Vitest's exit code, or 1 when Vitest is missing.
 */
export async function runTest(args: CliArgs, out: Output): Promise<number> {
  const command = resolveVitest(args.dir);
  if (!command) {
    out.error(MISSING_VITEST_HINT);
    return 1;
  }
  return spawnInherit(command, args.dir);
}
