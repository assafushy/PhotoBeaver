import path from 'node:path';
import { build, context, type BuildOptions, type Message, type Plugin } from 'esbuild';
import { copyNativeDependencies, type NativeCopyOptions } from './native-copy';
import { nativeExternals, readNativeDependencies } from './native-deps';

export const ENTRY = 'src/index.ts';
export const OUTFILE = 'dist/index.js';

const REQUIRE_SHIM =
  "import { createRequire as __pbCreateRequire } from 'node:module'; const require = __pbCreateRequire(import.meta.url);";

export type BuildResult = { ok: true; outfile: string } | { ok: false; errors: string[] };

/**
 * esbuild options for a plugin: one ESM file for Node 22 with every dependency bundled
 * except the declared native packages.
 *
 * @param dir - Plugin project folder.
 * @param plugins - Extra esbuild plugins (watch hooks).
 * @param external - Packages left as runtime imports.
 * @returns Build options.
 */
export function bundleOptions(
  dir: string,
  plugins: Plugin[] = [],
  external: string[] = [],
): BuildOptions {
  return {
    absWorkingDir: dir,
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    mainFields: ['module', 'main'],
    banner: { js: REQUIRE_SHIM },
    logLevel: 'silent',
    plugins,
    external,
  };
}

/**
 * Formats esbuild messages as `file:line:column: text`.
 *
 * @param messages - esbuild errors or warnings.
 * @returns One readable line per message.
 */
export function formatMessages(messages: Message[]): string[] {
  return messages.map((m) =>
    m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ${m.text}` : m.text,
  );
}

function failureMessages(error: unknown): string[] {
  const errors = (error as { errors?: Message[] }).errors;
  return errors?.length ? formatMessages(errors) : [String((error as Error).message ?? error)];
}

/**
 * Bundles `src/index.ts` into `dist/index.js` and copies native dependencies into
 * `dist/node_modules`.
 *
 * @param dir - Plugin project folder.
 * @param native - Prune rules and target platform for native dependencies.
 * @returns The absolute output path, or readable errors.
 */
export async function buildPlugin(
  dir: string,
  native: NativeCopyOptions = {},
): Promise<BuildResult> {
  try {
    const names = readNativeDependencies(dir);
    await build(bundleOptions(dir, [], nativeExternals(names)));
    copyNativeDependencies(dir, names, native);
    return { ok: true, outfile: path.join(dir, OUTFILE) };
  } catch (error) {
    return { ok: false, errors: failureMessages(error) };
  }
}

function nativeCopier(dir: string, names: string[], native: NativeCopyOptions): () => string[] {
  let copied = false;
  return () => {
    if (copied) return [];
    try {
      copyNativeDependencies(dir, names, native);
      copied = true;
      return [];
    } catch (error) {
      return failureMessages(error);
    }
  };
}

function onEndPlugin(
  dir: string,
  onBuild: (result: BuildResult) => void,
  copyNative: () => string[],
): Plugin {
  const outfile = path.join(dir, OUTFILE);
  return {
    name: 'pb-plugin-watch',
    setup(pluginBuild) {
      pluginBuild.onEnd((result) => {
        const errors = formatMessages(result.errors);
        if (errors.length === 0) errors.push(...copyNative());
        onBuild(errors.length > 0 ? { ok: false, errors } : { ok: true, outfile });
      });
    },
  };
}

/**
 * Rebuilds on every source change until disposed. Native dependencies are copied after the
 * first successful build only, so restart after installing or upgrading one.
 *
 * @param dir - Plugin project folder.
 * @param onBuild - Called after every build, successful or not.
 * @param native - Prune rules and target platform for native dependencies.
 * @returns A function that stops watching.
 */
export async function watchPlugin(
  dir: string,
  onBuild: (result: BuildResult) => void,
  native: NativeCopyOptions = {},
): Promise<() => Promise<void>> {
  const names = readNativeDependencies(dir);
  const plugin = onEndPlugin(dir, onBuild, nativeCopier(dir, names, native));
  const ctx = await context(bundleOptions(dir, [plugin], nativeExternals(names)));
  await ctx.watch();
  return () => ctx.dispose();
}
