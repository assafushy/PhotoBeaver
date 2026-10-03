# M1 Core Pipeline + Local Connector - Implementation Plan

## Context

M0 is done: CI passed on macOS, Windows and Ubuntu, including e2e, and you reviewed the decisions in `4fe76be`. M1 (SPEC 12) adds the core pipeline:

- the job queue, the scheduler and sync execution
- the instance/asset model with the merge primitive
- a thumbnail service and the `pb-media://` protocol
- a virtualized library grid with a timeline, a viewer and a Sources screen
- `connector-local`, written against the SDK types but loaded in-process

**Acceptance:** add a folder of 10k photos, the grid fills progressively, a restart mid-sync resumes, and deleting a file on disk removes it from the grid after the next sync.

Relevant spec sections: 4.1-4.3, 6.1, 6.2, 6.7, 7.2-7.4, 7.7 (quit), 8.1 (screens 1, 2, 8), 8.3, and section 11 (unit tests for the scheduler, the queue and merge/unmerge).

The M0 review follow-ups D10, D14 and D17 are included because M1 touches the same code.

## Decisions that need your OK (deviate from or fill gaps in the spec)

1. **No `worker_threads` pool for thumbnails in M1.** SPEC 3.1 asks for one. sharp already does its decoding and resizing on libvips' own thread pool, off the JS thread, so the event loop isn't blocked. Running sharp inside worker threads also has known native-crash pitfalls on Linux. Instead, the "core lane" caps concurrent thumbnail jobs at `cores - 1`. I'll revisit if profiling shows main-thread stalls.
2. **`connector-local` `watch()` moves to M2.** M1 uses poll mode (default every hour) plus "Sync now". The spec ties watch subscriptions to the plugin host lifecycle ("hosts with an active watch() stay alive"), which arrives in M2. The acceptance criterion only needs the deletion to show "after the next sync".
3. **The grid loads every asset summary progressively** in keyset pages of 1000 (id, time, w, h, type, thumb state), then lays out and virtualizes on the client. Jumping to an arbitrary month with keyset-only paging would need estimated section heights. Loading all summaries keeps the scrubber exact. At 200k assets this is about 12 MB, streamed after the first page renders.
4. **Originals go through the original cache** (`cache/originals/`, LRU, default 5 GB) for the viewer and video thumbnails, including local files. The service interface stays swappable for the future archive store (decision #2 in the spec). Image thumbnails stream straight into sharp with no cache copy.

## Schema changes (migration `0002_m1`)

- `assets.missing_since` (INTEGER, NULL means present). It is set when the last live instance is tombstoned and cleared when an instance reappears. The grid excludes missing assets, and they're purged after 30 days with their thumbnails (SPEC 4.3).
- **D14:** a partial expression index on `(COALESCE(captured_at, -9007199254740991) DESC, id DESC) WHERE hidden = 0 AND missing_since IS NULL`, so grid pages come from an index scan. The sentinel becomes `Number.MIN_SAFE_INTEGER`. Add a test that checks `EXPLAIN QUERY PLAN` uses the index.
- **D10:** `plugin_kv.value_json` becomes NOT NULL (drizzle-kit handles the SQLite table rebuild). Deleting a key removes the row.
- `asset_merges.snapshot_json`: the merged asset's row plus its album, tag and face memberships, so unmerge can restore them exactly. The spec's columns can't restore a deleted asset.
- **D17:** `PB_USER_DATA_DIR` is honored only when `!app.isPackaged`. e2e tests run the unpackaged build, so they're unaffected.

## New package: `packages/plugin-sdk` (`@photobeaver/plugin-sdk`)

M1 version: types and helpers only, from SPEC 6.1, 6.2 and 6.4:
- `MediaItem`, `ItemRef`, `SyncBatch`, `ConnectorPlugin`, `PluginContext`, `SourceContext`, `SyncContext`, `Logger`
- `defineConnector`, `AuthRequiredError`, `RateLimitedError`

Enricher types and the test harness come in M2 and M3. `plugins/connector-local` imports only from this package.

## `plugins/connector-local`

- Manifest `photobeaver-plugin.json`: poll mode, `defaultIntervalSec` 3600, and `configSchema` with `root` (`format: "directory"`) and `includeVideos`.
- **Directory config:** the spec's example picks the root inside `setupSource` but never returns it. Instead, a `format: "directory"` field renders as a folder picker in the config form, and `setupSource` validates it. Recorded in DECISIONS.
- **Sync:** a deterministic, sorted recursive walk over the image, RAW and video extensions. It calls `ctx.isKnown` to skip unchanged files (etag = `size-mtimeMs`) and yields batches of 500.
- **Cursor:** `{ lastPath }` while a scan is in progress, so a crash resumes after the last committed path. `{ done: true }` after a scan, so the next sync starts a fresh full scan. The final batch sets `isFullScan`.
- `getOriginal` streams the file; `externalUrl` is a `file://` URL.

## Core (`apps/desktop/src/main/core/`, no Electron imports so Vitest can run it headless)

- **`jobs/job-queue.ts`** (SPEC 7.3):
  - enqueue with `ON CONFLICT(dedupe_key) DO NOTHING`, plus an option to bump priority to 10
  - atomic `UPDATE ... RETURNING` leasing by kind
  - heartbeat (extend lease) and lease-expiry recovery
  - retry with backoff, then `dead` after `max_attempts`
  - cleanup: delete `done` jobs after 24h and `dead` jobs after 30 days
  - **Gap filled:** completing a job (`done` or `dead`) clears its `dedupe_key`, so a source can be queued again on its next run. Otherwise the UNIQUE key blocks it for 24h.
- **`jobs/lanes.ts`:** a lane runner that leases jobs of given kinds with concurrency N and wakes on enqueue. Lanes: sync N=3, core (thumbnail) N=`cores-1`. On quit it stops leasing and waits up to 5s.
- **`scheduler.ts`** (SPEC 7.2):
  - 15s tick, plus immediately on start and on "Sync now"
  - selects due sources (`idle`/`error`, `next_run_at <= now`, plugin enabled and `ok`, mode `poll`) and enqueues `sync:<sourceId>`
  - success: `next_run_at = now + intervalSec + 0..10% jitter`
  - failure: `min(intervalSec, 60s * 2^failures)` capped at 6h, and `error` after 10 failures
  - `AuthRequiredError` sets `auth_required`; `RateLimitedError` reschedules without counting a failure
  - pure timing functions, unit-tested with an injected clock and random source
- **`sync/sync-runner.ts`** (SPEC 7.4): `runSyncJob` stores a `runId` in the job payload, so a resumed job keeps it. Each batch is one transaction that:
  - upserts instances (unchanged etag or modifiedAt only refreshes `seen_run_id`)
  - creates an asset for each new instance and marks the asset changed when its content changed
  - tombstones deletes and keeps `missing_since` up to date
  - upserts albums and the source's album memberships, and saves the cursor
  - enqueues `thumbnail` jobs (priority 50) for new or changed assets

  After the batch commits it emits progress and heartbeats the lease. When the final batch has `isFullScan`, it tombstones instances whose `seen_run_id` differs from the run's.
  - **Gap filled:** `ctx.isKnown` also marks the instances it returns as seen in this run. Otherwise files a connector skips as unchanged would be tombstoned by the full scan.
- **`assets/capture-date.ts`:** precedence for M1: source `capturedAt` (`'source'`), then a date parsed from the filename (`'filename'`: `IMG_20230105_...`, `2023-01-05 ...`, `PXL_...`), then `modifiedAt` (`'mtime'`). EXIF comes with M3.
- **`assets/merge.ts`** (SPEC 4.3): `mergeAssets` and `unmergeAssets` (each one transaction) and `isMergeBlocked`, which treats an undone merge as a "never merge" pair, so no extra table is needed. No UI or callers until M3; covered by unit tests as section 11 requires.
- **`thumbnails/thumbnail-service.ts`:**
  - Images: `connector.getThumbnail` if provided, else the original stream, through sharp `.rotate()`. Writes WebP 256 and 1024 to `thumbs/<id[0..2]>/<id>_<size>.webp` and fills `assets.width`/`height` from the oriented metadata.
  - Videos: original through the cache, an ffmpeg-static frame at 1s, then sharp.
  - Formats sharp can't decode (HEIC, most RAW) set `thumb_state='failed'` and the grid shows a placeholder tile. Recorded in DECISIONS; real previews come with M3's metadata work.
- **`originals/original-cache.ts`:** `ensureLocal(assetId)`, which picks a live instance and asks its connector for the original. LRU eviction by mtime, with a touch on each hit.
- **`connectors/registry.ts`:** an in-process builtin registry. At startup it upserts a `plugins` row for `connector-local` (`install_source='builtin'`) and builds `SourceContext`/`SyncContext` objects backed by core (log, storage over `plugin_kv`, `isKnown`, `reportProgress`, `signal`).
- **`sources/source-service.ts`:**
  - add: validate config, run `setupSource`, insert the source, queue an immediate sync
  - remove: cascade instances, delete orphan assets and their thumbnails
  - pause and resume; sync now (priority 10)
- **`maintenance.ts`:** a one-minute timer that recovers expired leases, cleans up old jobs, and purges assets missing for 30+ days.

## Electron layer

- **`protocol/pb-media.ts`:** registered as a privileged, secure, streaming scheme before `ready`.
  - `pb-media://thumb/<ulid>/<256|1024>` serves the WebP. If it's missing, it bumps the thumbnail job to priority 10 and returns 404.
  - `pb-media://original/<ulid>` serves from the original cache with HTTP Range support, so video seeking works.
  - Every request validates the ULID and size and checks the session for `assets.view`.
- **Events:** a typed event contract in `packages/shared` (`library.changed`, `sync.progress`, `thumbs.ready`, `sources.changed`), sent by main with `webContents.send`. `window.pb.events.on(channel, cb)` returns an unsubscribe function. `library.changed` is debounced to 1s.
- **New IPC channels** (each declares its permission in the contract):

  | Channel | Permission |
  |---|---|
  | `assets.get` | `assets.view` |
  | `assets.openInSource` | `assets.view` |
  | `sources.list` | `assets.view` |
  | `sources.connectors` | `sources.manage` |
  | `sources.add` | `sources.manage` |
  | `sources.remove` | `sources.manage` |
  | `sources.pickDirectory` | `sources.manage` |
  | `sources.syncNow` | `sources.sync` |
  | `sources.pause` / `sources.resume` | `sources.sync` |

  `assets.openInSource` shows a `file://` URL in the folder and opens `https://` URLs in the browser.

## Renderer

- **Library:** loads pages progressively with `useInfiniteQuery`, refetches on `library.changed`.
  - `justifiedLayout()` is a pure function: groups by day, target row height ~180px, aspect ratio from w/h (1 when unknown); unit-tested.
  - Rows are virtualized with `@tanstack/react-virtual`. Tiles are `<img src=pb-media://thumb/...>` with a placeholder on error and a cache-bust on `thumbs.ready`.
  - Timeline scrubber on the right: year/month marks from the loaded data, drag or click to scroll.
  - Keyboard: arrow keys move focus, Enter opens the viewer.
- **Viewer** (`#/viewer/:assetId`): full screen with prev/next (arrow keys) and Esc to close.
  - Images show the 1024 thumbnail, then the original. Zoom with wheel and double-click (respects reduced motion).
  - Videos use `<video>` with the original.
  - The info panel shows date and its source, dimensions, type, size, and instances (source, path, "Open in source"). EXIF, tags and people come in M3 and M5.
- **Sources:** a list with status, item count, last sync, live progress, and Sync now / Pause / Resume / Remove (confirm dialog).
  - "Add source" is a Radix Dialog: pick a connector, then a form rendered from `configSchema` by a small JSON-Schema form renderer (string, boolean, integer, enum, and `directory` as a folder picker).
- New dependencies: `@tanstack/react-virtual`, `@radix-ui/react-dialog`, and `zustand` (viewer navigation list). Main process: `sharp`, `ffmpeg-static` (add to `allowBuilds` and `asarUnpack`), `ulid`.

## Tests

- **Unit (Vitest):**
  - job queue: dedupe, priority/run_after order, lease, heartbeat, expiry recovery, backoff to dead, key release, cleanup
  - scheduler: due selection, jitter bounds, backoff formula and cap, error after 10 failures, auth and rate-limit paths
  - sync runner: etag skip, deletes, full-scan tombstoning, `isKnown` marks seen, `missing_since`, crash mid-iteration then resume with the same runId gives the same final state
  - merge and unmerge round-trip, `isMergeBlocked`
  - capture-date parsing, `justifiedLayout`, the D14 query plan
  - thumbnail service on sharp-generated JPEGs (EXIF orientation, dimensions, failure state) and an ffmpeg-generated mp4
  - connector-local: walk order, extension filter, cursor resume
- **Headless integration:** core with connector-local over ~300 generated fixtures (images, videos, duplicates, nested folders). Full sync plus thumbnails, delete a file and resync, check the DB state.
- **E2E (Playwright):**
  - generate ~1500 small JPEGs and add the source through `window.pb.sources.add`
  - check the grid shows tiles before the sync finishes
  - `SIGKILL` the app mid-sync, relaunch, and check it ends with exactly 1500 assets and no duplicate instances
  - delete a file, press Sync now in the UI, and check the grid count drops
  - open the viewer and step next/prev
- **Manual scale check:** `scripts/generate-fixtures.mjs --count 10000`; time the first tiles, full index and thumbnails, and check scroll smoothness. Results go in the session summary.

## Docs

- DECISIONS.md: the four decisions above, plus the dedupe-key release, `isKnown` marking items seen, the directory config field, `missing_since`, `snapshot_json`, the HEIC/RAW placeholder, the D10/D14/D17 resolutions and the never-merge-via-`asset_merges` approach.
- Plan copy in `claude_docs/plans/2026-10-03_m1-core-pipeline_plan.md` and a session summary.

## Verification

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` pass locally.
2. Manual run: `pnpm dev`, add a 10k fixture folder, watch the grid fill, quit mid-sync and relaunch, delete files and press Sync now, open videos and photos in the viewer.
3. Push the branch and check the CI matrix passes on all three OSes.

## Risks

- ffmpeg-static adds about 70 MB and needs `asarUnpack`. It's verified by the packaged-app smoke test.
- Loading all summaries at 200k could be slow on old machines. The first page still renders immediately, and if needed a later milestone can switch to section-estimated layout without changing the IPC contract.
- An e2e `SIGKILL` timing race is mitigated by waiting for a partial asset count before killing.
