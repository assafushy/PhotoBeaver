import type { LibraryDb } from '@photobeaver/db';
import { net, protocol } from 'electron';
import { appSettings } from '../core/enrich/app-settings';
import { PB_TILES_SCHEME, providerTileUrl } from './tile-url';

/**
 * Serves map tiles through the main process (SPEC 8.1 #4, decision on privacy):
 * nothing is fetched unless the user set an online tile URL, and the renderer
 * never talks to the internet directly, so its CSP stays strict.
 *
 * @param db - Library database (for the tile setting).
 */
export function handleTileProtocol(db: LibraryDb): void {
  protocol.handle(PB_TILES_SCHEME, async (request) => {
    const url = providerTileUrl(request.url, appSettings.get(db).mapTileUrl);
    if (!url) return new Response(null, { status: 404 });
    return net.fetch(url).catch(() => new Response(null, { status: 502 }));
  });
}
