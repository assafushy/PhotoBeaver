/**
 * Normalizes an archive member name to a relative posix path.
 *
 * @param name - Path as stored in a zip or produced by a folder walk.
 * @returns The normalized path, or undefined when it is empty or escapes the root.
 */
export function normalizeEntryPath(name: string): string | undefined {
  const segments = name
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return undefined;
  return segments.join('/');
}

/**
 * Whether a file name is a zip archive to merge into the tree.
 *
 * @param name - File name or path.
 * @returns True for names ending in `.zip`, ignoring case.
 */
export function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}
