import path from 'node:path';
import { parseArgs } from 'node:util';

export const COMMANDS = ['build', 'dev', 'validate', 'test', 'pack'] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface CliArgs {
  command: CommandName;
  dir: string;
  watch: boolean;
}

export type ParsedArgs = { ok: true; args: CliArgs } | { ok: false; error: string };

export const USAGE = `Usage: pb-plugin <command> [--dir <path>]

Commands:
  build [--watch]  Bundle src/index.ts into dist/index.js
  dev              Watch, rebuild and hot reload in a running Photo Beaver
  validate         Check the manifest and the built plugin's exports
  test             Run the project's tests with Vitest
  pack             Build, validate and write <id>-<version>.pbplugin`;

function isCommand(value: string | undefined): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value ?? '');
}

/**
 * Parses pb-plugin arguments.
 *
 * @param argv - Arguments after the executable and script.
 * @param cwd - Directory used when `--dir` is absent.
 * @returns The command, absolute project dir and flags, or an error message.
 */
export function parseCliArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { dir: { type: 'string' }, watch: { type: 'boolean', default: false } },
    });
    const command = positionals[0];
    if (!isCommand(command)) return { ok: false, error: `Unknown command: ${command ?? '(none)'}` };
    const dir = path.resolve(cwd, values.dir ?? '.');
    return { ok: true, args: { command, dir, watch: values.watch ?? false } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
