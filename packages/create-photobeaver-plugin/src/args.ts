import { parseArgs } from 'node:util';
import { PLUGIN_TYPES, type PluginType, type ScaffoldOptions } from './options';

export type ParsedCreateArgs =
  { ok: true; options: ScaffoldOptions } | { ok: false; error: string };

export const USAGE = `Usage: npm create photobeaver-plugin@latest <dir> -- [options]

Options:
  --type connector|enricher  Plugin type (default: connector)
  --id <reverse-dns>         Plugin id (default: com.example.<folder>)
  --name <display name>      Display name (default: from the folder name)
  --sdk <version-or-path>    SDK version, or a path to a local packages/plugin-sdk`;

function isPluginType(value: string): value is PluginType {
  return (PLUGIN_TYPES as readonly string[]).includes(value);
}

function toOptions(
  dir: string | undefined,
  values: Record<string, string | undefined>,
): ParsedCreateArgs {
  if (!dir) return { ok: false, error: 'Missing target folder' };
  const type = values.type ?? 'connector';
  if (!isPluginType(type)) return { ok: false, error: `Unknown type: ${type}` };
  return { ok: true, options: { dir, type, id: values.id, name: values.name, sdk: values.sdk } };
}

/**
 * Parses create-photobeaver-plugin arguments.
 *
 * @param argv - Arguments after the executable and script.
 * @returns Scaffold options, or an error message.
 */
export function parseCreateArgs(argv: string[]): ParsedCreateArgs {
  try {
    const { values, positionals } = parseArgs({
      args: argv.filter((arg) => arg !== '--'),
      allowPositionals: true,
      options: {
        type: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
        sdk: { type: 'string' },
      },
    });
    return toOptions(positionals[0], values);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
