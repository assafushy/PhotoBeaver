# M5 Faces and people - Implementation Plan

## Context

M4 is merged (`93d4f3a`, CI green on all three OSes). SPEC 12 M5 delivers:
- sqlite-vec integration
- `enricher-faces`
- a People screen where you can name, merge and split clusters

Related spec text:
- SPEC 9.3 describes `enricher-faces`: off by default, uses the 1024 thumbnail, runs `onnxruntime-node`, downloads its models when turned on, and shows their license.
- SPEC 8.1 #2, #3 and #5 add people to the viewer, to search and filters, and the People screen.
- SPEC 3.3 says People needs `people.edit` to change anything.
- SPEC 4.2 defines `people`, `faces` and `faces_vec` (FLOAT[512]).

M5 has no acceptance line in the spec, so I propose this one:
- Turning on Faces finds faces in the library and groups them into people.
- You can name, merge and split people.
- Naming a person makes their photos searchable and filterable.
- Undoing a merge and re-running the enricher never lose your edits.

### Where the code stands
- **Faces are stored but incomplete.** `faces` and `people` exist in `packages/db/src/schema/organization.ts` but have no indexes. `apply-result.ts:114-131` drops embeddings, and re-runs replace face ids, which would lose manual assignments.
- **Unmerge can lose faces.** `unmerge.ts:51-52` moves faces back by id, and those ids may be gone after a re-run.
- **No vector search yet.** No sqlite-vec, and nothing loads extensions. The DB opens in `packages/db/src/open.ts:43-53`.
- **Native plugin code isn't supported.** Plugins bundle into one file (`packages/plugin-cli/src/bundle.ts`) with no externals. `nativeModules` is only displayed, never enforced. Plugin hosts can load `.node` files from their install folder.
- **The settings modal from M3 can't show a license.** It also isn't shown when you turn a plugin on.

## Decisions (yours, from the questions)

1. **Models are InsightFace `buffalo_l`, downloaded when you turn Faces on.** That is SCRFD-10G detection plus ArcFace `w600k_r50`, giving 512-d embeddings as the spec says.
   - They are never committed to the MIT repo, because InsightFace models are for non-commercial research only.
   - When you turn the plugin on, a consent dialog shows the license and the download size.
   - The plugin downloads the official `buffalo_l.zip` (about 280 MB) and extracts only the two models it needs with the M4 zip reader. It checks SHA-256 hashes before use.
2. **Native `onnxruntime-node`.** The plugin is flagged "Runs native code", and the binaries for the build's own platform ship with it.
3. **Clustering lives in core.** The plugin only detects faces and computes embeddings. A core `PeopleService` clusters faces and owns names, merges and splits, so user edits are never overwritten. This differs from SPEC 6.3/9.3, which put clustering in `finalize()`, and gets recorded in DECISIONS.

## Other decisions (mine, to record)

4. **Loading sqlite-vec.**
   - `openLibrary` gets an `extensions` option, and the vector extension loads right after the pragmas, before migrations run.
   - Migration `0006_m5` creates `faces_vec USING vec0(face_id TEXT PRIMARY KEY, embedding float[512] distance_metric=cosine)`. It also adds the missing indexes on `faces(asset_id)`, `faces(person_id)` and `faces(plugin_id)`, and a `face_rejections(face_id, person_id)` table.
   - `packages/db` depends on `sqlite-vec`, so its own tests load the extension.
   - Packaging: the per-platform sqlite-vec packages go in `asarUnpack`, and the extension path is rewritten from `app.asar` to `app.asar.unpacked`.
5. **Native dependencies in plugins.**
   - A plugin `package.json` can list `"photobeaver": { "nativeDependencies": ["onnxruntime-node"] }`.
   - `pb-plugin build` then marks them external and copies them into `dist/node_modules/`, keeping only the current platform's binaries. This is the same esbuild pipeline, now with externals.
   - `pb-plugin pack` refuses a plugin whose `nativeDependencies` don't match `permissions.nativeModules: true`.
   - Default plugins are built on each CI OS, so each installer carries its own platform's binaries.
6. **Stable face ids.**
   - A re-run matches new faces to existing ones on the same asset by box overlap (IoU at least 0.5). A match keeps its id, person and `assigned_by`, and the embedding is updated. Faces that disappeared are deleted, from `faces_vec` too.
   - Unmerge restores faces by asset, not by stale id.
   - `faces_vec` rows are deleted explicitly wherever faces are deleted (purge, re-run, uninstall with data removal), because virtual tables have no foreign-key cascade.
7. **Clustering method** (Immich-style incremental, on sqlite-vec KNN):
   - **Which faces count:** detection score at least 0.7 and face at least 40 px in the thumbnail.
   - **Core faces:** a face with at least 3 neighbours within cosine distance 0.5 is a core face.
   - **Assignment:** a face joins the person of its nearest assigned neighbour, unless that pairing is in `face_rejections`. Otherwise a core face starts a new unnamed person. Faces that aren't core are retried at the end.
   - **When it runs:** as a durable core job (`cluster_faces`), debounced after face results arrive and after "Re-run".
   - **What it never touches:** it never moves a face you assigned (`assigned_by='user'`).
   - **Tunable:** distance and minimum cluster size are in the plugin settings.
8. **What you can do with people** (all need `people.edit`):
   - Rename. Names are free text, and there is no duplicate-name check.
   - Merge person A into B. All of A's faces become B's, and A is deleted.
   - Split: move selected faces to a new person or an existing one. Those faces become `assigned_by='user'`.
   - "Not this person": unassign the face and record the rejection.
   - Set the cover face.

   People left with no faces are deleted by maintenance. Every change refreshes search text for the affected assets, and people's names join `assets_fts`.
9. **Face crops.** `pb-media://face/<faceId>` serves a 256 px square crop. It is cut from the 1024 thumbnail with sharp and cached under `thumbs/faces/`. The face id is validated like asset ids.
10. **A plugin "enable notice".** An additive manifest field `enableNotice: { title, body, url? }` is shown in a consent dialog the first time a plugin is turned on, or when it is installed with that field. The Faces plugin uses it for the InsightFace license.
11. **Model download progress.**
    - The plugin downloads in `activate()`, in the background, to `dataDir/models/` through a temp file and a rename.
    - Until the models are ready, `enrich` throws `RateLimitedError({ retryAfterSec: 30 })`, so jobs wait without counting as failures.
    - The plugin card shows a status line, through a new additive `ctx.status(text)` (for example "Downloading face models: 45%"), carried in the plugin summary.

## Plugin: `plugins/enricher-faces` (subagent; I verify)
- **Manifest:**
  - Off by default, with `nativeModules: true`.
  - Network access to `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com`, for the model download only.
  - `input: thumbnail`, `resourceClass: cpu-heavy`, `concurrency: 1`, `dependsOn` metadata, `accepts: image/*`.
  - `produces: ["faces"]`.
  - Settings: minimum face size, detection threshold, clustering distance, minimum faces per person.
- **Detection:** `getInput(asset, { format: 'png' })` gives the 1024 thumbnail. The plugin decodes the PNG with the bundled `pngjs`, letterboxes to 640 for SCRFD, then decodes anchors at strides 8, 16 and 32 with keypoints and runs NMS (ported from `scrfd.py`).
- **Embeddings:** each face is warped to 112x112 with a 5-point similarity transform onto the ArcFace template (bilinear). ArcFace takes RGB normalized as (x - 127.5) / 127.5. The 512-d output is L2-normalized.
- **Result:** `faces: [{ bbox (normalized 0..1), confidence, embedding }]`.
- **Batching:** `enrichBatch` covers up to 8 assets per session run.
- **Tests:**
  - Pure-JS pieces, using known vectors: anchor decoding, NMS, the similarity transform, warping and PNG decoding.
  - A real-model test, run only when the models are available (`PB_FACE_MODELS_DIR`). It checks that two public-domain photos of the same person are within 0.5 and that different people are apart.

## Core work (`apps/desktop/src/main/core`)
- **`faces/face-store.ts`:**
  - Stable-id upsert by IoU.
  - `faces_vec` writes and deletes.
  - KNN through `embedding MATCH ? AND k = ?`.
- **`faces/people-service.ts`:**
  - Clustering, with a `cluster_faces` job kind and a debounce.
  - Rename, merge, split, reject and cover.
  - Search-text refresh for every asset an operation touches.
- **Existing services:**
  - `apply-result` stores faces through the face store.
  - `merge` and `unmerge` keep faces with their assets.
  - `purge` and plugin uninstall clean up vectors.
  - Maintenance deletes people with no faces.
- **Library:**
  - `personIds` filter: an EXISTS subquery on `faces.person_id`.
  - `people` facet.
  - `searchText` includes people's names.
- **IPC:** these channels need `assets.view` to read and `people.edit` to change:
  - `people.list` (with counts and cover)
  - `people.get` (faces, paged)
  - `people.rename`, `people.merge`, `people.moveFaces`, `people.rejectFace`, `people.setCover`
  - `assets.get` also gains `faces: [{ id, bbox, personId, personName }]`.

## UI (`apps/desktop/src/renderer/src`)
- **People screen** (nav item shown while an enabled plugin produces faces):
  - Named people first, then unnamed clusters by size.
  - Each card shows a cover crop, the name (editable inline) and a count.
- **Person page:**
  - Their photos, through the library grid with `personIds`.
  - A faces strip with multi-select, and actions: "Move to new person", "Move to...", "Not this person", "Make cover" and "Merge into...".
- **Viewer info panel:** a People row with face crops and names, each linking to the person.
- **Filter bar:** a person select.
- **Plugin card:**
  - The enable-notice dialog appears before you turn the plugin on.
  - The status line shows download progress.

## SDK, CLI and packaging
- **Additive SDK changes:**
  - `ctx.status()` on PluginContext.
  - `enableNotice` in the manifest schema.
  - The face result shape is documented (normalized bbox, 512 floats), and core validates it with zod (embeddings at most 1024 floats, bbox within 0..1).
- **`pb-plugin build`:** native externals and copying the platform binaries.
- **`electron-builder.yml`:** `asarUnpack` gains `sqlite-vec-*`. Plugin native binaries already sit outside the asar, in `resources/plugins`.

## Tests
- **Unit:**
  - Face store: IoU matching keeps ids and assignments, and vectors are deleted.
  - Clustering, on synthetic 512-d vectors: three tight groups give three people; noise stays unassigned; a user assignment and a rejection are respected; re-running is stable.
  - People operations, and searching for a renamed person.
  - The `personIds` filter.
  - Merge and unmerge with faces.
  - The sqlite-vec KNN query.
- **db package:** the migration with the extension loaded, and KNN.
- **CLI:** a fixture plugin with a fake native dependency builds into `dist/node_modules`, and pack enforces the `nativeModules` flag.
- **Integration (headless core):** a fake faces enricher returns fixed embeddings for fixture photos. Core then clusters, renames, merges, splits, undoes an asset merge and re-runs, with no edits lost.
- **E2E:** the library is seeded with faces through the fake enricher. People shows clusters; you name one; searching the name finds the photos; you move a face to a new person; the viewer shows the people.
- **Real-model check (CI on Ubuntu only, models cached by checksum):**
  - The enricher-faces model test runs on a few public-domain portraits, NASA astronaut photos with attribution, committed small under `plugins/enricher-faces/tests/fixtures`.
  - It is skipped elsewhere and locally without models.
- **Packaged smoke test:** turning Faces on shows the license dialog, `onnxruntime-node` loads inside the packaged plugin host, and sqlite-vec loads from `app.asar.unpacked`.

## Delivery
- **Branch:** `m5-faces`.
- **Records:** DECISIONS D114 onward, the session summary and a copy of the plan.
- **README:** the license note for the Faces models.
- **Merge:** a PR with auto-fix and squash auto-merge, merged when green.

## Verification
1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`, `pnpm format:check` and `node /tmp/fnlen.cjs` are all clean.
2. Manual `pnpm dev`: turn Faces on, accept the license, the models download, then people appear, and naming, merging and splitting all work.
3. Packaged macOS smoke test, then CI green on all three OSes.

## Risks
- **onnxruntime-node inside a utilityProcess.** There is an open report of a SIGTRAP crash on macOS arm64. I'll check this first, with a spike that loads it in the packaged plugin host. If it fails, the fallback is onnxruntime-web (WASM) behind the same interface.
- **Size and download.** The models are about 280 MB downloaded once, and the onnxruntime binaries add tens of MB per platform. Both are noted in the plugin README.
- **Clustering quality depends on thresholds.** They are tunable in settings, and people can always be fixed by hand.
