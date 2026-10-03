# Session summary: M1 Core pipeline and local connector (2026-10-03)

Branch: `m1-core-pipeline`. Plan: `claude_docs/plans/2026-10-03_m1-core-pipeline_plan.md`.

## What was built

- **Plugin SDK** (`packages/plugin-sdk`): MediaItem, SyncBatch, ConnectorPlugin, plugin contexts, `defineConnector`, `AuthRequiredError`, `RateLimitedError`.
- **`plugins/connector-local`**:
  - Imports only from the SDK.
  - Sorted recursive walk; cursor resume after the last committed path.
  - `isKnown` etag skip, full-scan final batch.
  - Folder picker config; guard against reading outside the root.
- **Core** (`apps/desktop/src/main/core`, no Electron imports):
  - SQLite job queue: leasing, heartbeat, retry and dead states, dedupe key release, cleanup.
  - Worker lanes; scheduler with jitter, backoff, auth and rate-limit paths.
  - Sync runner and batch writer: one transaction per batch with its cursor; run id on the source; `missing_since`.
  - Merge and unmerge with snapshot, plus the never-merge check.
  - Thumbnail service (sharp, plus an ffmpeg frame for videos); LRU original cache.
  - Source service with audit log; maintenance timer.
- **Electron layer**:
  - `pb-media://` protocol: validation, session check, Range support.
  - Event forwarding (throttled and batched); 11 new IPC channels.
  - Lazy app import so native load failures surface.
- **Renderer**:
  - Virtualized justified grid grouped by day, timeline scrubber, keyboard navigation.
  - Viewer overlay: zoom, video, info panel, open in source.
  - Sources screen with an add-source dialog driven by `configSchema`.
- **Schema migration `0002_m1`**: `missing_since`, D14 expression index, `plugin_kv.value_json` NOT NULL, `sources.sync_run_id`, `asset_merges.snapshot_json`.
- **M0 follow-ups resolved**: D10, D14, D17.

## Verification

- 102 unit and integration tests, plus 8 Playwright e2e tests, all pass locally on macOS.
  - The integration test runs the real Core with connector-local over about 300 generated files.
  - The e2e tests include a SIGKILL mid-sync, relaunch and resume that ends with exactly 1500 instances and no duplicates.
  - They also cover deleting a file then Sync now, and viewer keyboard navigation.
- **Scale check** (production build, 10,005 generated files):

  | Metric | Result |
  |---|---|
  | First tile | 0.28 s |
  | Fully indexed | 9.2 s |
  | All thumbnails | 21.8 s |
  | Scroll frame time | p50 16.7 ms, p95 18.9 ms |

  The fixtures are tiny images, so real photos will take longer to thumbnail.
- **Packaged macOS build**: sync, image and video thumbnails worked, and backup-before-migrate ran on an existing M0 database (`photobeaver.db.bak-0001_assets_fts`).
- **Not verified yet**: Windows and Linux. CI runs on pushes to `main` and on pull requests.

## AI Rationale

- **Headless core.** Every service under `core/` takes its dependencies as arguments, so the full sync pipeline is tested in Vitest without Electron. It also maps cleanly onto M2, where connector calls move behind RPC.
- **Run id on the source, not the job.** At first the plan stored it in the job payload. A resume from a new job, for example after a dead job or a reinstall, would then have started a new run and wrongly tombstoned files committed before the crash.
- **`isKnown` marks items as seen.** Without this, a connector skipping unchanged files makes every full scan delete them. This interaction between two spec features is not covered by the spec.
- **Deferred queue notifications.** Lanes woke synchronously on enqueue. That could lease a job inside the batch transaction, and a rollback would then leave a phantom lease.
- **Rich `thumbs.ready`.** Patching tiles in place instead of refetching the library keeps a 10k-file thumbnail pass from causing thousands of 10-page reloads.
- **Viewer position in a ref.** React Router v7 renders navigations as transitions, and an e2e test exposed that a fast second arrow key acted on the old position. Fixed at the root, not with test delays.
- **Packaging bugs found by the smoke test.** sharp's platform binaries were missing from the asar, and an ESM main that fails while importing exits silently. Both are fixed (D48). Unit and e2e tests on the unpackaged app could not have caught either.
- **Refactor pass.** A subagent split every function over 20 lines (global rule). I verified the result independently: length check, full pipeline, and a review of the merge transaction order and the viewer key handling.

## Next

- Run CI on Windows and Linux with a PR from this branch.
- Then M2: plugin system, plugin hosts, `connector-local` in its own host, and `watch()`.
