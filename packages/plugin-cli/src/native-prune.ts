import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export interface NativeTarget {
  platform: string;
  arch: string;
}

export type PruneRule = (packageDir: string, target: NativeTarget) => void;

export type PruneRules = Readonly<Record<string, PruneRule>>;

/**
 * The platform and architecture whose binaries are kept. `PB_PLUGIN_TARGET_PLATFORM` and
 * `PB_PLUGIN_TARGET_ARCH` override the current process values for cross-packaging.
 *
 * @param env - Environment to read overrides from.
 * @returns The target.
 */
export function nativeTarget(env: NodeJS.ProcessEnv = process.env): NativeTarget {
  return {
    platform: env.PB_PLUGIN_TARGET_PLATFORM || process.platform,
    arch: env.PB_PLUGIN_TARGET_ARCH || process.arch,
  };
}

function removeAllBut(dir: string, keep: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry !== keep) rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * A prune rule for packages laid out as `<binDir>/<platform>/<arch>/`: keeps only the target's
 * folder and deletes every other platform and architecture.
 *
 * @param binDir - Binary root relative to the package folder, for example `bin/napi-v6`.
 * @returns The prune rule.
 */
export function keepTargetBinaries(binDir: string): PruneRule {
  return (packageDir, target) => {
    const root = path.join(packageDir, binDir);
    removeAllBut(root, target.platform);
    removeAllBut(path.join(root, target.platform), target.arch);
  };
}

/**
 * A prune rule that deletes files matching a pattern inside the target's binary folder.
 *
 * @param binDir - Binary root relative to the package folder.
 * @param pattern - File names to delete.
 * @returns The prune rule.
 */
export function dropTargetFiles(binDir: string, pattern: RegExp): PruneRule {
  return (packageDir, target) => {
    const dir = path.join(packageDir, binDir, target.platform, target.arch);
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) if (pattern.test(entry)) rmSync(path.join(dir, entry));
  };
}

/**
 * Runs several prune rules in order.
 *
 * @param rules - Rules to combine.
 * @returns The combined rule.
 */
export function allOf(...rules: PruneRule[]): PruneRule {
  return (packageDir, target) => rules.forEach((rule) => rule(packageDir, target));
}

export const DEFAULT_PRUNE_RULES: PruneRules = {
  'onnxruntime-node': allOf(
    keepTargetBinaries('bin/napi-v6'),
    dropTargetFiles('bin/napi-v6', /^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/),
  ),
};
