# Photo metadata (`com.photobeaver.enricher-metadata`)

Default enricher, enabled on install. It reads the original of every photo and video and
proposes core fields: capture time, location and dimensions.

## What it reads

- **Photos:** EXIF through [exifr](https://github.com/MikeKovarik/exifr), reading only the file
  header chunks. Capture time comes from `DateTimeOriginal`, then `CreateDate`, then
  `ModifyDate` (with sub-seconds), as floating time (D41): the wall clock encoded as UTC, with
  `OffsetTimeOriginal` never applied. GPS becomes signed decimal degrees; (0, 0) and
  out-of-range values are dropped. Dimensions are swapped for orientations 5 to 8.
- **Videos (MP4, MOV, M4V, 3GP):** a small box parser reads only `moov` headers: `mvhd`
  (creation time, duration), the first video track's `tkhd` (size and rotation),
  `udta/©xyz` and QuickTime `meta` keys (`com.apple.quicktime.location.ISO6709`,
  `com.apple.quicktime.creationdate`, make, model, software). The Apple creation date wins and
  keeps the wall clock of its offset. The `mvhd` time is a true UTC instant, so it is
  converted to floating time with the wall clock of the machine running the plugin, the same
  way core converts file mtimes (D41). Other video formats return nothing.

Results: `capturedAt`, `location`, `dimensions` (with `durationMs` for videos),
`data.exif` (make, model, lens, exposure, ISO, focal length, orientation, software, only
fields present in the file) and `searchText` (camera make and model). Files without metadata
return `{}`; unreadable files return `{}` and log a warning.

## Permissions

- `originals: "read"`: core hands the plugin a local path to each original.
- `network: []`, `filesystem: "none"`: nothing leaves the machine and no other files are read.
