# Duplicate finder (`com.photobeaver.enricher-dedup`)

A default Photo Beaver enricher (SPEC 9.4). It makes the same photo on Dropbox, on a local disk
and in a Facebook export show up as one item with several locations, and it suggests look-alike
copies (resized or re-compressed) for you to merge or dismiss.

## What it does

For each new or changed photo or video:

1. **Cheap keys.** Publishes the file size of every copy and any hash the source already reports
   (for example Dropbox or OneDrive hashes). A matching source hash is an exact match.
2. **Hashes only when needed.** When another item has exactly the same size, it reads the original
   once and computes SHA-256, the Dropbox content hash and the OneDrive QuickXorHash. That lets a
   local file match a Dropbox or OneDrive file without downloading anything from them. Videos over
   200 MB get a sampled hash (size plus the first, middle and last 1 MiB) instead.
3. **Exact matches** are merged into one item, or suggested when "When files are byte-identical"
   is set to "ask". Sampled video matches are only ever suggested.
4. **Look-alikes.** Computes a 64-bit perceptual hash (DCT pHash) and a difference hash (dHash) of
   the thumbnail. After a batch, a library-wide scan links items within the chosen Hamming
   distance (looking at each item's 20 nearest look-alikes) and suggests each connected group
   once, in groups of at most 50. When a group gains a new look-alike later, only the new item
   is suggested, together with one item it matches. Look-alikes are never merged automatically.
5. **Burst protection.** Shots taken under 2 seconds apart that are not pixel-identical are treated
   as a burst, not duplicates.

Pairs you unmerged are never merged or suggested again, and a suggestion you dismissed is not
repeated. Merging only changes how the library is shown: no file is ever deleted or moved.

## Identity keys

| Key                  | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `size:<bytes>`       | Size of a copy                                                 |
| `src:<algo>:<value>` | Hash reported by a source, or `src:dropbox:` / `src:quickxor:` |
| `sha256:<hex>`       | SHA-256 of the original                                        |
| `vsample:<hex>`      | Sampled hash of a video over 200 MB                            |
| `phash:<16 hex>`     | 64-bit DCT perceptual hash of the thumbnail                    |
| `dhash:<16 hex>`     | 64-bit difference hash of the thumbnail                        |

## Settings

| Setting             | Default | Meaning                                                          |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `exactMerge`        | `auto`  | `auto` merges byte-identical files, `ask` suggests them instead  |
| `nearDuplicates`    | `true`  | Suggest look-alike copies                                        |
| `nearThreshold`     | `6`     | Largest pHash Hamming distance (0 to 16) counted as a look-alike |
| `downloadToCompare` | `true`  | Read cloud originals when a same-size file needs confirming      |

## Privacy

Everything runs on this computer. The plugin has no network access. Originals are read only when
another item has the same size (and `downloadToCompare` is on). Its index of perceptual hashes,
capture times and computed hashes lives in the plugin's private data folder.

## Development

```sh
pnpm --filter @photobeaver/enricher-dedup test
pnpm --filter @photobeaver/enricher-dedup build
```

Tests use `sharp` only to generate fixture images and PNG thumbnails. The plugin itself decodes
PNG with `pngjs` and has no native modules.
