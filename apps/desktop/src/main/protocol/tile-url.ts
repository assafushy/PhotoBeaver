export const PB_TILES_SCHEME = 'pb-tiles';

const TILE_PATH = /^\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;

/**
 * Turns a `pb-tiles://tile/{z}/{x}/{y}` request into the configured provider URL.
 *
 * @param requestUrl - The renderer's request.
 * @param template - The configured https template, or null when tiles are off.
 * @returns The provider URL, or null when the request is invalid or tiles are off.
 */
export function providerTileUrl(requestUrl: string, template: string | null): string | null {
  if (!template) return null;
  const parsed = new URL(requestUrl);
  const match = parsed.hostname === 'tile' ? TILE_PATH.exec(parsed.pathname) : null;
  if (!match) return null;
  const [, z, x, y] = match;
  if (Number(z) > 22) return null;
  return template.replace('{z}', z!).replace('{x}', x!).replace('{y}', y!);
}
