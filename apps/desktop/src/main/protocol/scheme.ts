import { protocol } from 'electron';
import { PB_MEDIA_SCHEME } from './media-url';
import { PB_TILES_SCHEME } from './tile-url';

/**
 * Registers `pb-media` and `pb-tiles` as privileged schemes. Must run before the app is ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PB_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: PB_TILES_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}
