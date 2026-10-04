# Faces (`com.photobeaver.enricher-faces`)

A default Photo Beaver enricher (SPEC 9.3). It finds faces in your photos and computes a
512-number description (an embedding) of each one. Photo Beaver core then groups similar faces
into people, which you can name, merge and split on the People screen.

**It is off by default.** Turning it on shows the model license (below) and starts a one-time
download of the face models.

## What it does

For each photo:

1. Asks core for the 1024 px thumbnail as PNG and decodes it.
2. **Detection** with SCRFD-10G: the image is letterboxed to 640 x 640, and the model's outputs
   are decoded at strides 8, 16 and 32 (2 anchors per location) with five landmarks per face
   (eyes, nose tip, mouth corners), then merged with non-maximum suppression (IoU 0.4). This is a
   port of InsightFace's `scrfd.py`.
3. Drops faces below the detection threshold or smaller than the minimum face size, and keeps at
   most 50 faces per photo, largest first.
4. **Alignment:** each face is warped to 112 x 112 with a similarity transform that maps its
   landmarks onto the standard ArcFace template, with bilinear sampling.
5. **Recognition** with ArcFace `w600k_r50`: all faces of one photo go through the model in a
   single batch, and each 512-d output is scaled to unit length.
6. Returns `faces: [{ bbox, confidence, embedding }]`, with the box normalized to 0..1 of the image.

The plugin does not group faces into people itself. Core clusters the embeddings (see
`claude_docs/plans/2026-10-04_m5-faces_plan.md`, decision 3), so your names, merges and splits
are never overwritten by a re-run.

## Models and their license

The plugin uses the InsightFace `buffalo_l` model pack: SCRFD-10G (`det_10g.onnx`) and ArcFace
`w600k_r50` (`w600k_r50.onnx`).

- **License:** the InsightFace pretrained models are available for **non-commercial research
  purposes only**. See https://github.com/deepinsight/insightface/tree/master/model_zoo.
- **Not part of this repository.** The models are not covered by Photo Beaver's MIT license and
  are never committed or bundled. They are downloaded from InsightFace's GitHub release
  (`https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip`) when you
  turn the plugin on.
- **Checked before use.** The archive and both extracted models are verified against fixed
  SHA-256 hashes. A file that does not match is discarded.

## Privacy

Everything runs on this computer. The only network access is the model download from GitHub
(`github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com`). No
photo, face or embedding ever leaves your computer.

## Download and disk use

- The download is about 290 MB. Progress shows on the plugin's card ("Downloading face models:
  45%").
- Only the two needed models are kept, about 190 MB in the plugin's data folder under `models/`.
  The archive is deleted after extraction.
- If the download fails, the plugin retries with growing delays (30 seconds up to 30 minutes).
- Until the models are ready, face jobs wait and are retried every 30 seconds. They are not
  counted as failures.
- On later starts the models are not hashed again unless their size or modification time changed.

## Performance

- Runs on the CPU with `onnxruntime-node`, using up to 4 threads (half the cores).
- Roughly 0.3 seconds per photo with a few faces on an Apple M1 Max. Older or smaller machines
  can be several times slower.
- The plugin is marked `cpu-heavy` and processes one photo at a time, so core can keep it from
  slowing down the rest of the app.

## Native code

The plugin is flagged "Runs native code" (`nativeModules: true`). `onnxruntime-node` is listed in
`package.json` under `photobeaver.nativeDependencies`, so `pb-plugin build` keeps it out of the
bundle and copies it, with the current platform's binaries only, into `dist/node_modules`.

## Settings

| Setting              | Default | Meaning                                                                               |
| -------------------- | ------- | ------------------------------------------------------------------------------------- |
| `minFaceSize`        | 40      | Smallest face to keep, in pixels of the 1024 px thumbnail (shorter side of the box).  |
| `detectionThreshold` | 0.7     | Minimum detector score for a face.                                                    |
| `clusterDistance`    | 0.5     | How similar faces must be to be grouped (cosine distance). Used by core's clustering. |
| `minFacesPerPerson`  | 3       | Faces needed before core creates a new person. Used by core's clustering.             |

## Development

```sh
pnpm --filter @photobeaver/enricher-faces test
```

The unit tests need no network and no models. The real-model test runs only when
`PB_FACE_MODELS_DIR` points to a folder holding `det_10g.onnx` and `w600k_r50.onnx`:

```sh
PB_FACE_MODELS_DIR=/path/to/models pnpm --filter @photobeaver/enricher-faces test
```

It uses the public-domain photos in `tests/fixtures` (see `tests/fixtures/ATTRIBUTION.md`).
