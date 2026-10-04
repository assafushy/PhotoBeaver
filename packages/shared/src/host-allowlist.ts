/**
 * Matches a hostname against manifest network patterns: an exact host, or
 * `*.example.com` for any subdomain of example.com (not example.com itself).
 *
 * @param hostname - Host being contacted.
 * @param patterns - `permissions.network` from the manifest.
 * @returns True when allowed.
 */
export function isHostAllowed(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();
    if (pattern.startsWith('*.'))
      return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
    return host === pattern;
  });
}

/**
 * Error thrown when a plugin contacts a host outside its allowlist.
 */
export class NetworkPermissionError extends Error {
  override readonly name = 'NetworkPermissionError';

  constructor(host: string) {
    super(`Network access to "${host}" is not allowed by this plugin's permissions`);
  }
}

/**
 * Throws unless the host is allowed.
 *
 * @param hostname - Host being contacted.
 * @param patterns - Allowlist.
 */
export function assertHostAllowed(
  hostname: string | null | undefined,
  patterns: readonly string[],
): void {
  const host = hostname ?? 'localhost';
  if (!isHostAllowed(host, patterns)) throw new NetworkPermissionError(host);
}
