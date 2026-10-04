# Session summary: M3 Enrichment (2026-10-04)

Branch: `m3-enrichment`. Plan: `claude_docs/plans/2026-10-04_m3-enrichment_plan.md`. Decisions D69 to D89 in `docs/DECISIONS.md`.

## What was built

- **Enrichment pipeline (headless core):**
  - `EnricherRegistry` with MIME matching, topological order and cycle rejection.
  - `EnrichScheduler`: queues work when content changes, when a thumbnail is ready and when a dependency completes; records `enrichment_runs`.
  - `EnrichRunner` with batching (up to 32), and `apply-result` with the precedence user > exif > source > enricher > filename > mtime.
  - Lanes by resource class (light 4, cpu-heavy half the cores, gpu 1), per-plugin concurrency caps and a battery pause for heavy lanes.
  - Finalizer with drain detection and a 10-minute debounce.
  - Identity API (`findByIdentity`, `listIdentity`, merge requests and suggestions) gated by `assets: "merge"`; `MergeService` with "always ask"; `DuplicatesService`.
  - FTS search text refreshed on sync, enrichment, merge, unmerge and purge.
- **SDK and host:** additive `getInput` options, enricher RPC methods (`enrich`, `enrichBatch`, `finalize`), host-side `shouldEnrich`, fake enrich context in the testing harness.
- **Default enrichers (via subagents, verified by me):**
  - `enricher-metadata`: exifr plus a pure-JS MP4/MOV parser.
  - `enricher-geocode`: offline GeoNames dataset with a grid index.
  - `enricher-dedup`: exact hashes, pHash and dHash, BK-tree near-duplicates with burst protection.
- **UI:**
  - Search box and filter chips (photos, videos, favorites, several sources, place, tag, source) shared by the grid and the map.
  - Map screen: MapLibre with an offline Natural Earth basemap, clustered HTML markers, optional online tiles through `pb-tiles://`.
  - Duplicates screen: suggestions side by side with a keep choice, merge, "Not duplicates", and recent merges with Undo.
  - Viewer info: place with "Show on map", camera, tags, plugin data, Undo merge.
  - Plugin cards: settings form, "Re-run on library", queue size.

## Verification

- All unit and integration tests pass across the workspace, including a headless enrichment integration test with the three enrichers in-process.
- 16 Playwright Electron e2e tests pass, 4 of them new for M3 acceptance:
  - The viewer shows the EXIF date ("from the camera"), the camera and the place "Paris"; searching "Paris" returns exactly the two Paris photos.
  - The file copied into two folders is one item with two locations.
  - Duplicates lists the resized copy; merging and undoing restores both items.
  - The map shows all three geotagged photos as clusters or markers, with no console errors.
- **Packaged macOS build:** all four default plugins load from `resources/plugins`; sync, enrichment, search, Duplicates and the map (MapLibre worker under `file://`) work.
- `node /tmp/fnlen.cjs` reports no function over 20 lines; lint and typecheck are clean.

## AI Rationale

- **Plan first, plugins in parallel.** I defined the SDK and RPC contract for enrichers before handing the three plugins to subagents, so they built against a fixed interface. I then ran each plugin's tests and the integration test myself, and changed what the integration exposed (dedup concurrency, the resized fixture).
- **Drain detection over timing.** The finalizer first fired while thumbnails were still pending, because the queue looked briefly empty. Instead of a longer delay, it now checks the plugin's own jobs, its dependencies, running syncs and pending thumbnails. That is deterministic and testable.
- **Privacy by construction for the map.** The basemap is bundled, and online tiles are opt-in and proxied through the main process, so the CSP never needs an internet host and nothing about photo locations leaves the machine by default.
- **HTML markers instead of a symbol layer.** Cluster counts in MapLibre need glyph fonts, which an offline style does not have. HTML markers avoid that, are keyboard reachable and are easy to assert in e2e.
- **Worker under `file://`.** MapLibre 6 derives its worker URL only for http(s). I checked in a throwaway Electron app that both direct and blob-imported module workers load from a `file://` page, then set the worker URL explicitly from a Vite-bundled worker. The packaged smoke test confirms it.
- **Packaged smoke without touching the user's data.** Packaged builds ignore `PB_USER_DATA_DIR` (D30), and an orphaned dev process held the single-instance lock on the real profile. Chromium's `--user-data-dir` switch gave the packaged app a throwaway profile instead.

## Next

- PR CI on all three OSes, then M4.
