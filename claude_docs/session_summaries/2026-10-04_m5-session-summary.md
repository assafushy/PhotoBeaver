# Session summary: M5 Faces and people (2026-10-04)

Branch: `m5-faces`. Plan: `claude_docs/plans/2026-10-04_m5-faces_plan.md`. Decisions D114 to D132 in `docs/DECISIONS.md`.

## What was built

- **Database:**
  - sqlite-vec loads on every open.
  - Migrations `0006_m5` and `0007_faces_vec` add face indexes, `face_rejections` and `faces_vec` (512-d, cosine).
- **Core:**
  - `FaceStore`: face ids stay stable across re-runs (IoU matching), and embeddings are stored in sqlite-vec.
  - `PeopleService`:
    - Incremental clustering as a debounced `cluster_faces` job.
    - Rename, merge, move faces (split), "not this person" and cover.
    - Cleanup of empty people.
  - Faces-aware asset merge and undo.
  - People names in search, a person filter and facet, and faces in the asset detail.
  - `pb-media://face/<id>` crops.
- **Plugin system:**
  - `ctx.status()` for progress shown on the plugin card.
  - An `enableNotice` consent dialog when turning a plugin on.
  - Native dependencies in `pb-plugin build`, `validate` and `pack`.
  - Installing a plugin now keeps `dist/node_modules`.
- **`enricher-faces`** (subagent, verified by me):
  - Off by default. Turning it on shows the license.
  - Downloads InsightFace `buffalo_l` with checksums and progress.
  - Detection (SCRFD-10G) and 512-d embeddings (ArcFace) on native onnxruntime.
- **UI:**
  - People screen and person page, with an inline name editor, face selection, move, reject, cover and merge.
  - A People row in the viewer.
  - A person filter.
  - The plugin consent dialog and the activity line on the plugin card.

## Verification

- **Tests:** all workspace unit, plugin and integration tests, lint, typecheck, Prettier and the 20-line function check pass.
  - New core tests cover stable ids, clustering, user moves and rejections, rename and merge with search and filter, empty-person cleanup, and merging copies of a photo then undoing.
  - The integration test runs sync, a fake face enricher, the real clustering job and search.
- **Real-model test** on public-domain portraits:
  - Same person: cosine distance 0.14 to 0.34.
  - Different people: 1.06 to 1.12.
  - Each portrait gives exactly 1 face, the group photo 3 and the landscape 0.
- **E2E:** all 21 tests pass, 2 of them new for People (cluster, name, search, viewer, split).
- **Packaged macOS smoke test with the real plugin:**
  - Turning it on shows the license dialog.
  - onnxruntime loads in the packaged plugin host and sqlite-vec loads from `app.asar.unpacked`.
  - The 8 fixture photos produce exactly the two expected people (3 photos each), and face crops render.

## AI Rationale

- **Spike first.** I checked onnxruntime-node in an Electron 44 utility process with the real models, and sqlite-vec with the repo's better-sqlite3, before designing on them. Both were risks noted in the plan.
- **Core owns people.** Keeping clustering in core, rather than in the plugin's `finalize` as the spec says, means user edits are plain database state that clustering respects (`assigned_by='user'`, rejections). Stable face ids make "Re-run" safe.
- **License hygiene.** You chose ArcFace in an MIT project. To keep the repo MIT-clean, the non-commercial weights are downloaded only when you turn the plugin on, after you accept their license; only public-domain photos are committed as test fixtures.
- **The packaged smoke test found a real bug.** Installing a plugin into the profile stripped every `node_modules`, so `dist/node_modules` was lost. Fixed and covered by a unit test. It also showed onnxruntime ships a duplicate 45 MB dylib on macOS; pruning it halved the plugin to 46 MB.
- **Parallel work.** Subagents built the CLI native-dependency support and the plugin against a fixed SDK surface (`ctx.status`, `enableNotice`, the face result shape), and one split the long functions. I verified each and integrated them.

## Next

- PR CI on all three OSes (Ubuntu also runs the real-model test with cached models), then M5.5 (users and roles).
