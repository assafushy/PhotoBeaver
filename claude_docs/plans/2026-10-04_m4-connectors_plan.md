# M4 Cloud and export connectors - Implementation Plan

## Context

M3 is merged (`46c14a9`, CI green on all three OSes). SPEC 12 M4 delivers:
- the OAuth broker, the secrets service, and `ctx.fetch` rate limiting (the rate limiting already exists from M2)
- `connector-dropbox`, `connector-onedrive`, `connector-google-photos` (Picker + Takeout), `connector-facebook-export`, `connector-instagram-export`
- cross-source dedup: the same file on local + Dropbox is one asset with two instances, via Dropbox's content hash

**Acceptance:** each connector passes the SDK contract suite, plus a manual test against a real account or archive.

**Relevant spec:** 5.2, 6.1, 6.2, 6.4, 6.6, 7.4, 8.1 #5, 9.2, 9.5, 10 (Security), 11.

### Where the code stands

- `setupSource` returns `secret`, but `SourceService.add` drops it. `sources.secret_ref` exists and is unused, and there is no secrets storage.
  - Files: `source-service.ts:134-153`, `packages/db/src/schema/sources.ts:12`.
- `ctx.secret` is stubbed in `connectors/registry.ts:120`. The RPC path for it already exists: `core-handlers.ts:70-82` and `plugin-host/context.ts:83-88`.
- `ctx.oauth` is stubbed in `registry.ts:121` and `plugin-host/context.ts:89`.
- `AuthRequiredError` and `RateLimitedError` already cross RPC and drive `auth_required` and backoff (`sync-runner.ts:136-150`). However, there is no Reconnect action or UI.
- `ctx.fetch` already has the per-plugin allowlist, a token bucket from `connector.rateLimit`, and 429 retries (`plugin-host/permissions/rate-limited-fetch.ts`).
- Setup has no cancel: the abort signal is thrown away (`source-service.ts:142`), and the Add Source dialog has no waiting state.
- Dedup already publishes `src:dropbox` and `src:quickxor` keys. It also computes both hashes for local originals when sizes collide (`plugins/enricher-dedup/src/keys.ts`, `hashes/`).

## Decisions

1. **Sign-in is once per source.** Setup runs the browser OAuth flow, and the tokens go into the secrets service. They refresh silently after that. If refresh fails, the source moves to `auth_required` and shows **Reconnect**, which runs `setupSource` again with the same config.
2. **OAuth client IDs come from plugin settings.**
   - Additive manifest field `settingsSchema` holds plugin-wide settings. For connectors, `configSchema` stays per source. The settings are read with `ctx.settings()`.
   - Each cloud connector has `clientId`, plus `clientSecret` for Google: Google "Desktop app" clients require it, and Google says it is not confidential.
   - Until a client ID is set, setup fails with "Set your app's client ID in the plugin's settings first".
   - Each plugin README is a step-by-step app-registration guide with the exact redirect URI to register.
3. **The Google Photos Picker keeps thumbnails and metadata only.**
   - **Sync is manual.** It opens a new Picker session in the browser and waits up to 30 minutes for the selection. Within the hour while links are valid, it stores metadata and a 1024 px preview of each picked item in the plugin's data folder.
   - **Viewing.** `getThumbnail` and `getOriginal` serve that preview. The original is not kept: links expire after 60 minutes and can't be re-fetched.
   - **No deletions.** Sync only adds items. It never sends full scans, so it never deletes.
   - **Full resolution** comes from Takeout, using the same plugin with `mode: takeout`.
4. **Archives are read from a folder or from .zip files, without extracting.**
   - The source config is a folder that holds either an extracted export or the downloaded .zip parts.
   - A pure-JS zip reader in the SDK reads the central directory (including ZIP64) and inflates entries with `node:zlib`. All parts are read as one tree, because Takeout sidecars and media can land in different parts.
   - .tgz is not supported.
5. **Redirect URIs.** `ctx.oauth.authorize` gets additive options:
   - `redirectHost` (`127.0.0.1` by default; Microsoft needs `localhost`)
   - `redirectPorts` (a fixed list to try in order; Dropbox needs exact registered ports)
   - `clientSecret`

   The default ports are 53682, 53683 and 53684, and the guides list the URIs to register. Microsoft ignores the port for localhost, so a random port is fine there.
6. **Secrets.**
   - A `secrets` table (`ref`, `ciphertext` blob, `updated_at`) holds blobs encrypted with Electron `safeStorage`, through a `SecretCipher` interface that is injected so the core stays headless and testable.
   - **Linux without a keyring.** If the backend is `basic_text`, storing a secret fails with "Install a system keyring (GNOME Keyring or KWallet)". SPEC 10 allows tokens only in safeStorage.
   - **Cleanup.** Removing a source deletes its secret.
7. **New `ctx.ui.openExternal(url)` (https only).** The Picker needs it to open its `pickerUri`. It is additive, and core checks the host against the plugin's allowlist.
8. **Shared helpers live in the SDK.** Default plugins import only the SDK.
   - **HTTP and tokens:** `@photobeaver/plugin-sdk/http` has `fetchJson`, which turns a final 429 into `RateLimitedError` and a 401 into a single token refresh, then `AuthRequiredError`. It also has `tokenStore(ctx, refresh)`, which refreshes before expiry and saves the new tokens with `ctx.secret.set`.
   - **Archives:** `@photobeaver/plugin-sdk/archive` has the archive tree (folder and zips), `fixMojibake` (latin-1 to UTF-8 for Meta exports), and a JSON sidecar matcher.

## Core work (`apps/desktop/src/main/core`)

- **`secrets/`:**
  - `SecretsService` with `get(ref)`, `set(ref, value)` and `delete(ref)` over the `secrets` table and a `SecretCipher`.
  - The Electron cipher lives in `src/main/secrets/safe-storage-cipher.ts`.
  - Tests use a reversible fake cipher.
- **`oauth/`:**
  - **`OAuthBroker.authorize(pluginManifest, opts, signal)`:**
    - Checks `permissions.oauth`, https URLs, and that the token host is in `permissions.network`.
    - Starts a loopback `node:http` server on the chosen host and port, builds the PKCE S256 challenge and `state`, and opens the browser through the injected `openExternal`.
    - Waits for `/callback` until a 5-minute timeout or the abort signal, then serves a small "You can close this tab" page.
    - Exchanges the code at `tokenUrl` and returns `OAuthTokens`.
  - **`refresh()`** does the same token-endpoint checks.
- **Contexts:** `registry.sourceContext` wires `secret` to `SecretsService`, using the key `source:<id>` stored in `sources.secret_ref`. It also wires `oauth` to the broker and adds `ui.openExternal`. Remote hosts reach these through new RPC methods `ctx.oauth.authorize`, `ctx.oauth.refresh` and `ctx.ui.openExternal`, which are added to `CORE_METHODS` with zod schemas.
- **`SourceService`:**
  - **Setup secret:** `add` stores `setup.secret` in the same transaction as the source row. Setup still runs before that transaction, so a failed or cancelled setup leaves nothing behind.
  - **Cancel:** `add` is cancellable through a setup id (`sources.cancelSetup`).
  - **Reconnect:** new `reconnect(id)` runs `setupSource` again with the stored config. It replaces the secret, sets the state to idle, and calls `syncNow`.
  - **Remove:** `remove` deletes the secret.
- **Plugin settings for connectors:** the M3 `PluginSettings` storage and settings form are reused, driven by `settingsSchema` (`hasSettings` in `plugin-summary.ts`).
- **IPC:**
  - `sources.add` gains a `setupId`.
  - New `sources.cancelSetup` (permission `sources.manage`) and `sources.reconnect` (`sources.manage`).
  - New push event `sources.setupStatus` with `{ setupId, message }`, for "Waiting for you to sign in in your browser".

## Plugins (subagents, in parallel once the SDK and core contract are in place; I verify each)

Each plugin gets:
- `photobeaver-plugin.json`, with network hosts, `oauth`, `settingsSchema` and `rateLimit`
- a README with the app-registration guide and its privacy notes
- tests that run against a fake provider API, implemented as a `fetch` function with no network
- the contract suite

The plugins:
- **`connector-dropbox`:**
  - **Listing:** `list_folder` (recursive) and `list_folder/continue`; the cursor is the Dropbox cursor. Media is filtered by extension, since `include_media_info` has been dead since 2019.
  - **Change detection:** `etag` is the `rev`, and `contentHash` is `{ algo: 'dropbox' }`.
  - **Reads:** `get_thumbnail_v2` and `files/download`.
  - **Resets:** a `reset` error triggers a full scan.
  - **Config:** an optional folder path.
- **`connector-onedrive`:**
  - **Listing:** Graph `/me/drive/root/delta` with `@odata.nextLink` and `deltaLink`. A 410 restarts as a full scan, and deleted facets become deletes.
  - **Metadata:** the `photo` facet gives `takenDateTime`, plus the `location` facet.
  - **Change detection:** `contentHash` is `{ algo: 'quickxor' }`.
  - **Reads:** thumbnails by size, and originals from `@microsoft.graph.downloadUrl` (no auth header).
  - **Sign-in:** the `common` tenant with `Files.Read offline_access`.
- **`connector-google-photos`:**
  - The config sets `mode: picker | takeout`.
  - **Picker:** as in decision 3 (`sessions.create`, then poll `sessions.get`, then `mediaItems.list` with `=w1024-h1024` previews, then `sessions.delete`).
  - **Takeout:**
    - Uses the archive tree.
    - Sidecars may be `.supplemental-metadata.json`, the older `.json`, clipped at 46 characters, or carry `(n)` suffixes.
    - Fields: `photoTakenTime`, `geoData` (where 0,0 means none), and `description`.
    - Album folders become albums. The duplicate copy of a photo in "Photos from YYYY" shares one `externalId` (the path in the year folder), so it is one instance.
- **`connector-facebook-export`:**
  - Reads `your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_*.json` and `posts/album/*.json`.
  - Fields: `uri` (relative to the export root), `creation_timestamp`, `exif_data` (`taken_timestamp`, lat/long) and the caption.
  - Albums come from the album files, and all text goes through `fixMojibake`.
- **`connector-instagram-export`:**
  - Reads `your_instagram_activity/media/posts_*.json`, `stories.json`, `reels.json` and `profile_photos.json`.
  - Timestamps and titles can be on the post or on `media[0]`.
  - EXIF location is used when present, and all text goes through `fixMojibake`.
- **Archive connectors:**
  - All three are full scans every sync (`isFullScan` on the last batch), with stable `externalId` = the path within the export.
  - Pagination is by sorted path, which keeps the cursor resumable.
  - They also handle a missing root like connector-local does: no deletions when the folder is gone.

**Default plugins:** add all five to `DEFAULT_PLUGINS` in `apps/desktop/build/copy-default-plugins.ts`. They are enabled, but each needs setup to do anything (SPEC 9.2).

## UI (`apps/desktop/src/renderer/src`)

- **Add Source:**
  - While setup runs, the dialog shows the `sources.setupStatus` message and a Cancel button that calls `sources.cancelSetup`.
  - Errors such as "Set the client ID first" link to the plugin's settings.
- **Source card:** an `auth_required` source shows a **Reconnect** button. It shows the same waiting state and Cancel.
- **Plugin card:** connectors with `settingsSchema` get the Settings button from M3.
- **Text:** all strings are added to i18n, with no em dashes.

## SDK and contract suite

- `ConnectorFixture` gains optional `context` options (`fetch`, a pre-seeded `secret`, OAuth tokens), so HTTP connectors run the same contract checks against fake APIs.
- The fake context records `oauth.authorize` calls and `ui.openExternal` URLs.
- All additions are additive minor changes; `apiVersion` stays "1".

## Tests

- **Unit:**
  - `SecretsService`: round trip, delete on source removal, and refusal on a `basic_text` backend.
  - `OAuthBroker`, against a fake provider on 127.0.0.1 with a fake browser that follows the authorize URL. Covers: PKCE verifier/challenge, state mismatch rejected, timeout, abort, fixed-port fallback when a port is busy, and token host not in the allowlist rejected.
  - Archive zip reader: stored and deflate entries, ZIP64, and multiple parts.
  - `fixMojibake` and the sidecar matcher, including clipped and `(n)` names.
  - `fetchJson` and `tokenStore` (429 becomes `RateLimitedError`, 401 refreshes once and then `AuthRequiredError`).
- **Plugin suites:** each connector runs the contract suite and its own tests against its fake API or fixture archive. Fixtures are generated in tests (zip parts, sidecars, mojibake strings), not committed binaries.
- **Integration (headless core):** a Dropbox fake API plus a local folder holding the same file gives one asset with two instances, through `src:dropbox`. Also covered: the secret is stored and survives a restart, an expired token refreshes, a revoked token moves the source to `auth_required`, and Reconnect restores sync.
- **E2E:**
  - Add a Facebook export source and an Instagram export source from zip fixtures through the UI: the grid fills, a caption with an accent displays correctly, and the place shows on the map.
  - A Takeout source from multi-part zips.
  - Add Source shows the waiting state and Cancel works. This uses a dev-only test hook that makes the OAuth broker wait without opening a browser.
  - Existing e2e tests still pass.
- **Manual (you, per SPEC acceptance):** with your app registrations, run a checklist for each cloud connector against a real account (sign in, sync, view, reconnect after revoking), and for each archive connector against a real export. It goes in `docs/manual-tests/m4.md`.

## Docs and delivery

- **DECISIONS.md:** D91 onward, covering the decisions above plus the details found while building.
- **Plugin READMEs:** registration guides, the privacy notes, and the Picker limitation.
- **Records:** a session summary, and a copy of the plan in `claude_docs/plans/2026-10-04_m4-connectors_plan.md`.
- **Delivery:** branch `m4-connectors`, then a PR with auto-fix and squash auto-merge, merged when green.

## Verification

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` pass, `pnpm format:check` is clean, and `node /tmp/fnlen.cjs` reports nothing.
2. A packaged macOS smoke test: the five new default plugins load, an archive source syncs, and Add Source shows the OAuth waiting state.
3. CI green on all three OSes.
4. Your manual checklist against real accounts and exports.

## Risks

- **Provider app registration and review.** Dropbox needs exact redirect URIs. Google's Photos Picker scope may need OAuth verification for public use, though test users work unverified. The guides cover both.
- **Meta export formats drift.** The parsers are tolerant: they try several known paths, skip what they don't recognize, and log it to the plugin log.
- **Large Takeout zips.** The reader reads only the central directory up front and streams entries on demand. It is tested with a generated ZIP64 archive.
- **Linux keyring.** Missing in CI. Tests inject the cipher, so only real Linux desktops without a keyring see the error message.
