import type { CliArgs } from '../args';
import { buildPlugin, watchPlugin, type BuildResult } from '../bundle';
import type { Output } from '../output';
import { untilInterrupted } from '../interrupt';
import { reportErrors } from './validate';

/**
 * Prints the outcome of one build.
 *
 * @param out - CLI output.
 * @param result - Build result.
 * @returns Exit code for this build.
 */
export function reportBuild(out: Output, result: BuildResult): number {
  if (!result.ok) {
    out.error('Build failed:');
    return reportErrors(out, result.errors);
  }
  out.info(`Built ${result.outfile}`);
  return 0;
}

/**
 * `pb-plugin build [--watch]`.
 *
 * @param args - Parsed CLI arguments.
 * @param out - CLI output.
 * @returns Process exit code.
 */
export async function runBuild(args: CliArgs, out: Output): Promise<number> {
  if (!args.watch) return reportBuild(out, await buildPlugin(args.dir));
  const stop = await watchPlugin(args.dir, (result) => void reportBuild(out, result));
  out.info('Watching for changes. Press Ctrl+C to stop.');
  return untilInterrupted(stop);
}
