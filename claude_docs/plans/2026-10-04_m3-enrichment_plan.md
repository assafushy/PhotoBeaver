# M3 Enrichment - Implementation Plan

## Context

M2 is merged (`bf06110`, CI green on all three OSes, with `main` now protected by the three checks). Plugins run in `utilityProcess` hosts, but only connectors exist.

SPEC 12 says M3 delivers:
- the enrichment planner (`dependsOn`, lanes, batching, `finalize`) and core-field precedence
- `enricher-metadata`, `enricher-geocode` and `enricher-dedup`, plus the `assets: "merge"` host API
- search (FTS) and filters, the Map screen and the Duplicates screen

**Acceptance:**
- Photos show correct capture dates and places, and searching "Paris" finds geotagged Paris photos.
- The same photo copied into two local folders shows as one asset.
- Resized copies appear in Duplicates, and undoing a merge works.

Relevant spec sections: 4.2, 4.3, 6.3, 6.4 (EnrichContext), 7.1, 7.5, 7.7, 8.1 (screens 2, 3, 4, 7, 9), 9.3, 9.4, 11.

M1 already has the merge and unmerge primitives (`core/assets/merge.ts`, `unmerge.ts`, never-merge via `asset_merges`). The M2 host, RPC and manager pieces get enricher support.

## Decisions that need your OK

1. **Geocoding data.** A script (`plugins/enricher-geocode/scripts/build-dataset.ts`) downloads GeoNames `cities1000`, `admin1CodesASCII` and `countryInfo` (CC BY 4.0, about 11 MB zipped) and writes a compact gzipped file, about 3 MB.
   - I commit that file to the plugin (`assets/cities.bin.gz`), with the attribution in the plugin README and the About text.
   - Builds and CI then need no network; you regenerate it only to refresh the data.
   - Committing it means a one-time download from download.geonames.org now.
2. **Video metadata without ffprobe.** `enricher-metadata` reads MP4 and MOV headers in JavaScript (`mvhd` creation time, `tkhd` size and rotation, `©xyz` / Apple keys GPS). SPEC 9.3 names ffprobe, but a plugin can't ship a native ffprobe for every OS inside one `.pbplugin`, and phone videos are MP4 or MOV. Photos use exifr (pure JS), as specified.
3. **Additive SDK changes** (minor version, `apiVersion` stays "1"):
   - `ctx.getInput(asset, { input?: 'thumbnail' | 'original', format?: 'png' })`. Dedup needs both inputs (SPEC 9.4 "thumbnail + original when needed"), and pure-JS plugins can't decode WebP, so core can hand them a PNG. Access is still limited by `permissions.originals`.
   - Precedence rank comes from the manifest: an enricher whose `produces` includes `"exif"` ranks as EXIF for capture time and location. Every other enricher ranks below source-provided values (SPEC 6.3). That way a community metadata plugin can replace the default one without a private API.
4. **Map.** MapLibre GL with an offline default style: Natural Earth 110m countries (public domain, bundled), so nothing leaves the machine. An optional online tile URL, such as OpenStreetMap, can be set in a new `map.tileUrl` setting. The setting is off by default, because tiles would reveal where photos were taken (SPEC 10 privacy).
5. **Enriching an existing library.** When a default enricher is installed for the first time, or a user installs or enables an enricher, its jobs are queued for the existing library, so M2 libraries get dates and places after upgrading. A version bump still does not re-run automatically (SPEC 6.3); there is a "Re-run on library" button.

## Schema (migration `0004_m3`)

- **`enrichment_runs(asset_id, plugin_id, plugin_version, status, error, completed_at)`, primary key `(asset_id, plugin_id)`:** records that an enricher finished an asset, even when it produced no data. The planner uses it for `dependsOn`.
- **`assets.location_source`:** precedence for location; `captured_at_source` gains `'enricher'`.
- **Indexes:** `tags(kind, name)`, `duplicate_suggestions(status)`, `asset_merges(created_at)`.

## SDK and host (`packages/plugin-sdk`, `apps/desktop/src/plugin-host`)

- **SDK:** `EnrichContext.getInput` options, `defineEnricher` already exists from M2, and harness helpers `createFakeEnrichContext` and `runEnrich` for plugin tests.
- **Host runtime:**
  - Enricher handlers: `enricher.enrich` (the host runs `shouldEnrich` first, so filtering costs no extra round trip), `enricher.enrichBatch` and `enricher.finalize`.
  - `ctx` proxies for `getInput`, `settings`, and `assets.*`. Each input path core hands out is added to the host's filesystem grants.
- **RPC contract:** new methods with zod schemas, including the `EnrichmentResult` schema that core validates (SPEC 6.5).

## Core enrichment (`apps/desktop/src/main/core/enrich/`)

- **`planner.ts`:** for an asset, the enabled enrichers whose `accepts` globs match its MIME type, topologically sorted by `dependsOn`. Cycles are rejected when the plugin loads, and the plugin shows "Cannot load".
- **`enrich-queue.ts`:** queues work at three points:
  - **Asset created or changed** (batch writer, merge): enrichers whose dependencies are met and whose input is ready.
  - **Thumbnail ready:** enrichers with `input: thumbnail`.
  - **Enrich job done:** dependents that are now unblocked.

  Job dedupe key `enrich:<asset>:<plugin>@<version>` (SPEC 7.3). No polling: an input that isn't ready simply isn't queued yet.
- **`enrich-runner.ts`:**
  - Job handler: builds the `AssetView` (instances, enrichments from `dependsOn` plugins), calls the plugin through `RemoteEnricher` (the SDK interface over RPC, like `RemoteConnector`), applies the result, records `enrichment_runs`, and queues dependents.
  - For plugins with `enrichBatch`, it also leases up to 31 more queued jobs of the same plugin and runs them as one batch.
- **`apply-result.ts`, one transaction:**
  - `data` keys go to `enrichments`; tags go to `tags` and `asset_tags`.
  - Core fields follow precedence: user > exif > source > enricher > filename > mtime. Dimensions only fill gaps, because the thumbnail decode is authoritative.
  - `faces` are stored without embeddings until M5.
  - `searchText` feeds the FTS row.
  - `identityKeys`, `mergeWith` and `suggestDuplicates` are rejected unless `assets: "merge"`. Merge requests are skipped for never-merge pairs, and become suggestions when the "duplicates.alwaysAsk" setting is on.
- **`lanes`:** three enrich lanes by resource class: light (4), cpu-heavy (`max(1, cores/2)`), gpu (1). `JobQueue.lease` gains a plugin filter, and each lane skips plugins already at their manifest `concurrency`.
- **`finalizer.ts`:** when a plugin's enrich jobs drain, it queues a durable `plugin_task` `finalize:<plugin>` job, at most once per 10 minutes (SPEC 7.5).
- **`search-text.ts`:** rebuilds an asset's `assets_fts` row from file names, paths, captions, tags (including places) and enricher `searchText`. Runs on create, on enrichment and on merge.
- **Merge integration:**
  - `mergeAssets` takes an optional survivor, for the user's choice in Duplicates.
  - After a merge, the merged asset's queued jobs are dropped, the survivor is re-planned and its FTS row refreshed.
  - Unmerge re-plans both assets.
- **Battery:** heavy enrich lanes pause on battery (SPEC 7.7, default on). M3 enrichers are all `light`, but the rule lives in the lanes. Idle-based scaling stays in M6.

## Plugins (each imports only `@photobeaver/plugin-sdk`, built with `pb-plugin`)

- **`enricher-metadata`** (light, input original, `produces: ["exif", ...]`):
  - exifr reads only the file header.
  - Produces capture time (local wall clock, matching D41), GPS, camera, lens, exposure and orientation.
  - The MP4/MOV parser handles videos (decision 2).
- **`enricher-geocode`** (light, input metadata, `dependsOn` metadata):
  - Loads the compact dataset from its install folder.
  - A grid-indexed nearest-city lookup returns `{ city, region, country, countryCode }`, place tags and `searchText`.
- **`enricher-dedup`** (light, input thumbnail, `assets: merge`, `dependsOn` metadata). Implements SPEC 9.4:
  - Publishes `size:` and `src:` keys.
  - Computes sha256 only when another asset has the same size, and a sampled `vsample:` hash for videos over 200 MB (suggestion only).
  - Computes Dropbox content hash and OneDrive quickXorHash for local originals.
  - Exact match: merge (or suggest when `exactMerge: ask`).
  - pHash and dHash from a PNG of the 256 thumbnail (pngjs).
  - `finalize` runs BK-tree near-duplicate search within `nearThreshold`, with burst protection (capture times under 2s apart, and distance above 0).
  - Keeps its asset to pHash/capture-time index in `dataDir`.
- Each has `connectorContract`-style unit tests with fixtures, and dedup has the SPEC 11 fixture suite: same file in two folders, resized copy, re-encoded copy, burst shots that must not merge, undo then re-run.

## UI and IPC

- **Search and filters:**
  - `library.query` gains `{ text, from, to, sourceIds, mediaTypes, placeTagIds, tagIds, favoritesOnly, multiSource }`. Text runs as an FTS5 prefix query; keyset paging and totals respect the filters.
  - New channel `library.facets` returns sources, places and tags with counts.
  - The search box plus filter chips sit above the grid (SPEC 8.1 #3).
- **Map screen:** `library.geoPoints` (visible geotagged ids and coordinates under the same filters), MapLibre clusters, and a click opens the viewer. The CSP gains `worker-src blob:`, and the tile host is allowed only when configured.
- **Duplicates screen**, shown when an enabled plugin has `assets: merge`:
  - Open suggestions side by side with thumbnails, size, date and location: merge (choose which to keep) or dismiss.
  - Recent automatic merges with Undo.
  - Channels: `duplicates.list`, `duplicates.merge`, `duplicates.dismiss`, `merges.recent`, `merges.undo`, all requiring `duplicates.merge` (SPEC 3.3).
- **Viewer info panel:**
  - Camera and lens, place name with "Show on map", tags.
  - Enrichment data grouped by plugin.
  - "Undo merge" when the asset came from a merge (SPEC 4.3 step 5).
- **Plugins screen, for enrichers:**
  - A settings form from `configSchema`, stored per plugin, so `ctx.settings()` returns real values (resolves D66).
  - Queue size, and "Re-run on library".

## Tests

- **Unit:**
  - planner: MIME globs, topological order, cycle rejection
  - enrich queue: trigger points, dependents, thumbnail gating
  - `apply-result`: precedence matrix, tags, the merge-permission gate, FTS text
  - lanes: resource classes and per-plugin caps; finalizer debounce
  - search filters plus keyset paging and the FTS prefix query; `geoPoints`
  - RPC enricher methods over memory ports
- **Plugin tests:** EXIF fixtures (date, GPS, orientation); an MP4 with `©xyz`; geocode lookups (Paris, a coastal point, an empty ocean point); hash algorithms against known vectors; BK-tree; the SPEC 11 dedup fixture suite.
- **Headless integration:** Core with `connector-local` and the three enrichers in-process. Generated fixtures with EXIF dates and GPS (Paris, Tokyo), one file copied into two folders, a resized copy and a burst pair. The test checks dates, places, FTS hits, one asset with two instances, a near-duplicate suggestion, no merge of the burst pair, and undo plus re-run.
- **E2E (Playwright), the acceptance:**
  - Sync the fixture folder through real plugin hosts.
  - The viewer shows the EXIF date and "Paris".
  - Searching "Paris" returns exactly the Paris photos.
  - The copied file shows one tile, with two locations in the info panel.
  - Duplicates lists the resized copy; merge it, undo it, and both come back.
  - The Map screen shows clusters.
- **Packaged smoke test** (macOS locally; CI on all three OSes runs the e2e tests).

## Docs and delivery

- DECISIONS.md: the five decisions above, plus `enrichment_runs`, precedence by `produces`, `getInput` grants, `shouldEnrich` in the host, finalizer job, auto-queueing on install, dimensions-from-thumbnail, alwaysAsk setting, and the CSP change. GeoNames attribution goes in the plugin README.
- Session summary, and the plan copy in `claude_docs/plans/`.
- Branch `m3-enrichment`. I'll hand the three plugins to subagents in parallel once the SDK and RPC contract for enrichers are in place, then verify them myself. Then a PR with auto-fix and auto-merge (now possible), and squash-merge when green.

## Verification

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` pass, and `node /tmp/fnlen.cjs` reports nothing.
2. Manual `pnpm dev` with the fixture folder: dates, "Paris" search, map, duplicates with merge and undo.
3. Packaged macOS smoke test, then PR CI green on all three OSes.

## Risks

- **Dataset size and licence:** about 3 MB committed, CC BY 4.0 with attribution. The alternative is downloading at build time.
- **Test fixtures:** building EXIF fixtures needs a writer. sharp can write EXIF (`withExif`), including GPS, and the tests confirm the round trip.
- **Scale:** the extra jobs from enrichment at 200k assets. Lanes are capped and the jobs are durable, and the 10k fixture run gets timed in the summary.
