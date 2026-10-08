import { protocol } from 'electron';
import { handleMediaRequest, type MediaProtocolDeps } from './media-request';
import { PB_MEDIA_SCHEME } from './media-url';

export type { MediaProtocolDeps } from './media-request';

/**
 * Registers `pb-media` as a privileged scheme. Must run before the app is ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PB_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/**
 * Serves thumbnails, originals and face crops to the renderer (SPEC 8.1). Every request is
 * validated and checked against the session and its scope. A missing thumbnail is queued at
 * UI priority and answered with 404; the renderer retries on `thumbs.ready`.
 *
 * @param deps - Database, core services, thumbs folder and session.
 */
export function handleMediaProtocol(deps: MediaProtocolDeps): void {
  protocol.handle(PB_MEDIA_SCHEME, (request) =>
    handleMediaRequest(deps, request).catch(() => new Response(null, { status: 500 })),
  );
}
