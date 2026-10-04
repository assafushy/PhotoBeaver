import path from 'node:path';
import { build, context, type BuildOptions, type Message, type Plugin } from 'esbuild';

export const ENTRY = 'src/index.ts';
export const OUTFILE = 'dist/index.js';

const REQUIRE_SHIM =
  "import { createRequire as __pbCreateRequire } from 'node:module'; const require = __pbCreateRequire(import.meta.url);";

export type BuildResult = { ok: true; outfile: string } | { ok: false; errors: string[] };

/**
 * esbuild options for a plugin: one ESM file for Node 22 with every dependency bundled.
 *
 * @param dir - Plugin project folder.
 * @param plugins - Extra esbuild plugins (watch hooks).
 * @returns Build options.
 */
export function bundleOptions(dir: string, plugins: Plugin[] = []): BuildOptions {
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
 * Bundles `src/index.ts` into `dist/index.js`.
 *
 * @param dir - Plugin project folder.
 * @returns The absolute output path, or readable errors.
 */
export async function buildPlugin(dir: string): Promise<BuildResult> {
  try {
    await build(bundleOptions(dir));
    return { ok: true, outfile: path.join(dir, OUTFILE) };
  } catch (error) {
    return { ok: false, errors: failureMessages(error) };
  }
}

function onEndPlugin(dir: string, onBuild: (result: BuildResult) => void): Plugin {
  const outfile = path.join(dir, OUTFILE);
  return {
    name: 'pb-plugin-watch',
    setup(pluginBuild) {
      pluginBuild.onEnd((result) => {
        const errors = formatMessages(result.errors);
        onBuild(errors.length > 0 ? { ok: false, errors } : { ok: true, outfile });
      });
    },
  };
}

/**
 * Rebuilds on every source change until disposed.
 *
 * @param dir - Plugin project folder.
 * @param onBuild - Called after every build, successful or not.
 * @returns A function that stops watching.
 */
export async function watchPlugin(
  dir: string,
  onBuild: (result: BuildResult) => void,
): Promise<() => Promise<void>> {
  const ctx = await context(bundleOptions(dir, [onEndPlugin(dir, onBuild)]));
  await ctx.watch();
  return () => ctx.dispose();
}
