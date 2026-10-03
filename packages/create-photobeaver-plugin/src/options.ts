import path from 'node:path';

export const PLUGIN_TYPES = ['connector', 'enricher'] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

export const DEFAULT_SDK_VERSION = '^0.1.0';
const UNSAFE_NAME = /["'\\\n\r`]/;

export interface ScaffoldOptions {
  dir: string;
  type?: PluginType;
  id?: string;
  name?: string;
  sdk?: string;
}

export interface TemplateValues {
  id: string;
  name: string;
  packageName: string;
  sdkSpec: string;
  cliSpec: string;
}

/**
 * Turns a folder name into a lowercase, dash-separated slug.
 *
 * @param value - Any text.
 * @returns The slug, or `my-plugin` when nothing usable is left.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'my-plugin';
}

/**
 * Turns a slug into a display name: `my-flickr` becomes `My Flickr`.
 *
 * @param slug - Dash-separated slug.
 * @returns Title-cased words.
 */
export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Whether `--sdk` points at a folder rather than an npm version.
 *
 * @param sdk - The `--sdk` value.
 * @returns True for paths.
 */
export function isSdkPath(sdk: string): boolean {
  return sdk.startsWith('.') || sdk.startsWith('~') || /[\\/]/.test(sdk);
}

function fileSpec(fromDir: string, target: string): string {
  const relative = path.relative(fromDir, path.resolve(target)).split(path.sep).join('/');
  return `file:${relative}`;
}

/**
 * Dependency specifiers for the SDK and CLI. A path means a local checkout
 * (`packages/plugin-sdk`), and the CLI is taken from the sibling `plugin-cli` folder.
 *
 * @param dir - Absolute project folder.
 * @param sdk - The `--sdk` value (version or path).
 * @returns `sdkSpec` and `cliSpec`.
 */
export function dependencySpecs(
  dir: string,
  sdk = DEFAULT_SDK_VERSION,
): Pick<TemplateValues, 'sdkSpec' | 'cliSpec'> {
  if (!isSdkPath(sdk)) return { sdkSpec: sdk, cliSpec: sdk };
  const sdkDir = path.resolve(sdk);
  const cliDir = path.join(path.dirname(sdkDir), 'plugin-cli');
  return { sdkSpec: fileSpec(dir, sdkDir), cliSpec: fileSpec(dir, cliDir) };
}

/**
 * Applies defaults derived from the folder name and checks the inputs.
 *
 * @param options - Scaffold options.
 * @returns Values for template placeholders.
 * @throws Error when the type or name is not usable.
 */
export function templateValues(options: ScaffoldOptions): TemplateValues {
  const dir = path.resolve(options.dir);
  const packageName = slugify(path.basename(dir));
  const name = options.name ?? titleCase(packageName);
  if (UNSAFE_NAME.test(name))
    throw new Error('The name cannot contain quotes, backslashes or line breaks');
  const id = options.id ?? `com.example.${packageName}`;
  return { id, name, packageName, ...dependencySpecs(dir, options.sdk) };
}
