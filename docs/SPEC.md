# Photo Beaver - Project Specification

> Status: v1 spec, ready for implementation
> Audience: Claude Code (implementer) and future plugin developers
> Rule for the implementer: follow this spec. Where it doesn't cover something, pick the simplest option that keeps the plugin contract stable, and add the decision to `docs/DECISIONS.md`.

---

## 1. Product summary

Photo Beaver is a cross-platform desktop app (macOS, Windows, Linux) that pulls all of a user's photos and videos from every place they live (local disks, Dropbox, OneDrive, Google Photos, Facebook, Instagram, and so on) into **one index**. The user browses, searches and maintains the whole library in one place.

Photo Beaver **indexes**. It does not replace the sources. By default, originals stay where they are. The app stores metadata, thumbnails and enrichment data locally, and fetches originals when needed.

Everything that touches an external source or adds meaning to media is a **plugin**:

| Plugin type | Job | Examples |
|---|---|---|
| **Connector** | Connects to a media source and finds, indexes and keeps in sync the media items there | Local folder, Dropbox, OneDrive, Google Photos, Facebook export, Instagram export, S3, NAS/SMB |
| **Enricher** | Takes indexed media items and adds data to them | EXIF/metadata reader, GPS reverse geocoding, face detection and recognition, object/scene tagging, duplicate detection, OCR |

Plugins can be built by third parties, installed by users, and developed locally with hot reload.

### 1.1 Goals (v1)

1. One-click install. No external database, service or runtime for the user to install.
2. A unified timeline/grid view across all sources, with search and filters (date, source, location, tag, person, media type).
3. A stable, documented, versioned plugin API with a TypeScript SDK, a scaffolding CLI and a local dev mode.
4. A reliable background sync loop that runs every configured connector, survives crashes and restarts, and never corrupts the index.
5. An enrichment pipeline that processes new and changed items automatically and can be re-run when an enricher is upgraded.
6. A set of **default plugins** that ship with the app and give a complete experience out of the box (section 9), including duplicate detection across sources (the same photo on Dropbox and on local disk shows up as one asset with two locations).

### 1.2 Non-goals (v1)

- Photo editing beyond rotate/favorite/tag.
- Writing changes back to remote sources (deleting on Facebook, for example). The API leaves room for this (see `capabilities.write`), but v1 is read-only against sources, except for the local folder connector.
- Cloud sync of the Photo Beaver library between devices, and remote users signing in from other devices. Local users with roles on one library are in v1 (section 3.3).
- Archiving originals locally (true backup of a source). Planned for a later version, see section 13.
- Plugin types other than connector and enricher (e.g. "actions" / exporters). Not planned for now, see section 13.
- Mobile apps.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | One language for core, UI and plugins |
| Desktop shell | **Electron** (latest stable) | Web UI, mature, Node APIs in main process |
| Build tooling | **electron-vite** + **Vite** | Fast dev loop, handles main/preload/renderer builds |
| Packaging | **electron-builder** | DMG/NSIS/AppImage + auto-update |
| UI | **React 18 + TypeScript**, **TanStack Query**, **TanStack Virtual** (virtualized grid), **Tailwind CSS**, **Radix UI** primitives | Handles 100k+ item grids smoothly |
| UI state | **Zustand** | Small, simple |
| Database | **SQLite** via **better-sqlite3** | See section 4 |
| ORM / migrations | **Drizzle ORM** + drizzle-kit migrations | Typed schema, plain SQL migrations |
| Full-text search | SQLite **FTS5** | Built in, no extra service |
| Vector search (faces, similar images) | **sqlite-vec** extension | Embedded, loads as a SQLite extension |
| Image processing | **sharp** (libvips) | Thumbnails, format conversion |
| Video thumbnails / metadata | **ffmpeg-static** + **ffprobe-static** | Bundled binaries |
| EXIF | **exifr** | Fast, pure JS |
| File watching | **chokidar** | Cross-platform |
| Secrets | Electron **safeStorage** (OS keychain backed) | OAuth tokens never stored in plain text |
| Validation | **zod** | Plugin manifest, config and RPC payload validation |
| Monorepo | **pnpm workspaces** + **turborepo** | Core, SDK, CLI and default plugins in one repo |
| Tests | **Vitest** (unit), **Playwright** (Electron e2e) | |
| Lint/format | ESLint + Prettier | |

---

## 3. Architecture

### 3.1 Processes

```
+-----------------------------------------------------------------------+
| Renderer (React UI)                                                   |
|   talks ONLY to preload bridge (contextIsolation: true,               |
|   nodeIntegration: false, sandbox: true)                              |
+-------------------------------+---------------------------------------+
                                | typed IPC (window.pb.*)
+-------------------------------v---------------------------------------+
| Main process = "Core"                                                 |
|  - Library service (queries, mutations)                               |
|  - Database (single writer, better-sqlite3)                           |
|  - Plugin Manager (install, load, enable, disable, update)            |
|  - Scheduler / Plugin Loop (section 7)                                |
|  - Job Queue (SQLite-backed)                                          |
|  - Thumbnail service                                                  |
|  - Secrets service (safeStorage)                                      |
|  - OAuth broker (loopback redirect + PKCE)                            |
|  - Local media server (custom protocol pb-media://)                   |
+-------+-------------------------+-------------------------+-----------+
        | MessagePort JSON-RPC    |                         |
+-------v--------+       +--------v-------+        +--------v-------+
| Plugin Host    |       | Plugin Host    |  ...   | Plugin Host    |
| (utilityProc.) |       | (utilityProc.) |        | (utilityProc.) |
|  dropbox conn. |       |  exif enricher |        |  faces enricher|
+----------------+       +----------------+        +----------------+
```

- **Every plugin runs in its own Electron `utilityProcess`** (a Node child process managed by Electron). A plugin crash, hang or memory leak can't take down the app or damage the DB.
- Plugins **never touch the database, the filesystem outside their granted paths, or secrets directly**. Everything goes through the host API (section 6.4) over JSON-RPC on a `MessagePort`.
- The **Core is the single writer** to SQLite. Plugins return data; Core validates it and writes it inside transactions.

Heavy core work (thumbnail generation, image decoding) runs in a small `worker_threads` pool in the main process so the main event loop never blocks.

### 3.2 Repository layout

```
photo-beaver/
  apps/
    desktop/
      src/main/            # Core: services, db, plugin manager, scheduler
      src/preload/         # contextBridge API (window.pb)
      src/renderer/        # React UI
      src/plugin-host/     # Entry for utilityProcess that loads one plugin
  packages/
    plugin-sdk/            # @photobeaver/plugin-sdk (types + helpers), published to npm
    plugin-cli/            # create-photobeaver-plugin + `pb-plugin` dev tool
    shared/                # Shared types, zod schemas, RPC contracts
    db/                    # Drizzle schema + migrations
  plugins/                 # Default plugins (section 9), written against the public SDK only
    connector-local/
    connector-dropbox/
    connector-onedrive/
    connector-google-photos/
    connector-facebook-export/
    connector-instagram-export/
    enricher-metadata/     # EXIF / XMP / video metadata, capture date, GPS
    enricher-geocode/      # offline reverse geocoding
    enricher-dedup/        # cross-source duplicate detection (exact + near)
    enricher-faces/        # face detection + embeddings + clustering (milestone M5)
  docs/
    plugin-guide.md
    plugin-api-reference.md   # generated from SDK types (typedoc)
    DECISIONS.md
  SPEC.md
```

**Hard rule:** default plugins import only from `@photobeaver/plugin-sdk`. No imports from `apps/desktop`. That keeps the public API honest: if a default plugin needs something, the SDK has to expose it.

### 3.3 Users, roles and access control

A library can have several users (a family sharing one computer, or a library kept on a shared drive). Each user has a role.

**Roles**

| Permission | Viewer | Editor | Admin |
|---|:-:|:-:|:-:|
| Browse, search, view photos/videos, map, people, albums | yes | yes | yes |
| Open in source, view original | yes | yes | yes |
| Export / download originals | no | yes | yes |
| Favorite, tag, edit date/location, rotate, hide | no | yes | yes |
| Create and edit albums | no | yes | yes |
| Name people, merge/split face clusters | no | yes | yes |
| Merge/unmerge duplicates, act on duplicate suggestions | no | yes | yes |
| "Sync now" on existing sources, re-run enrichment on selected items | no | yes | yes |
| Add, remove, reconnect, configure sources | no | no | yes |
| Install, uninstall, enable, disable, configure plugins; developer mode | no | no | yes |
| Manage users, roles and scopes | no | no | yes |
| Library settings (move library, backup/restore, cache), Activity, logs | no | no | yes |

Permissions are defined in code as named strings (`assets.view`, `assets.edit`, `assets.export`, `albums.edit`, `people.edit`, `duplicates.merge`, `sources.sync`, `sources.manage`, `plugins.manage`, `users.manage`, `library.admin`). Roles are fixed sets of these permissions. Custom roles are not in v1, but the model must allow them later without schema changes.

**Scopes (optional, per user)**

- An admin can limit a Viewer or Editor to certain **sources** and/or **albums** (e.g. kids see only the "Family" album and the shared Dropbox, not someone's private Instagram export).
- No scope = the whole library. Admins are never scoped.
- Scopes are applied in core at the SQL level on every library query (search, map, people, duplicates, counts), not in the UI. An asset is visible if any of its instances is in a visible source, or it's in a visible album.
- People/face clusters only show faces from assets the user can see.

**Accounts and sign-in**

- **Single-user by default.** First run creates one Admin account with no password, and the app opens straight in. Nothing about users shows in the UI until the admin turns on "Multiple users" in Settings > Users.
- Turning on multiple users requires the admin to set a password, and shows a one-time **recovery key** (for a forgotten admin password).
- Local accounts: display name, avatar, role, and a password or 4 to 8 digit PIN (stored as an argon2id hash). Optional OS biometrics to unlock (Touch ID on macOS via `systemPreferences.promptTouchID`, Windows Hello later).
- Startup shows a user picker. "Switch user" is in the app menu. Auto-lock after a configurable idle time (default 15 minutes, off in single-user mode).
- There must always be at least one Admin. The last Admin can't be demoted or deleted.

**Enforcement**

- All checks happen in **core** (main process). Every IPC handler declares the permission it needs (`handle('sources.add', { requires: 'sources.manage' }, fn)`) and a middleware checks the current session before running it. The renderer also hides controls the user can't use, but that's only for convenience.
- Per-user state: the `pb-media://` protocol checks the session too, so a Viewer can't load a thumbnail or original outside their scope by guessing an asset id.
- **Background work isn't tied to a user.** Sync and enrichment run as the system, keep running while the app is locked, and plugins never see who is signed in.
- **Audit log:** admin and editor actions that change the library (source added/removed, plugin installed, merge/unmerge, role changes, bulk edits) are written to `audit_log` and shown to Admins in Activity.

**Threat model (stated honestly in the docs):** roles control what people can do *through the app*. They don't protect the library files from someone with direct access to the disk or the OS account. Encrypting the library at rest (e.g. SQLCipher, key derived from the admin password) is listed as future work. OAuth tokens stay in the OS keychain of the OS user who added the source.

**Not in v1:** remote users on other devices (that needs a server or peer-to-peer sync; see 1.2), and two computers opening the same library at the same time. Core takes a lock file (`library.lock`, with hostname and pid) and refuses to open a library that another running instance holds, with an option to take over if the lock is stale.

---

## 4. Database

### 4.1 Choice: SQLite (embedded, WAL mode)

- **Zero install:** SQLite is a library linked into the app. Nothing to run, configure or upgrade separately.
- **Single file:** `<userData>/library/photobeaver.db` is easy to back up, move or reset.
- **Scales enough:** millions of rows are fine with the right indexes. FTS5 handles text search and sqlite-vec handles embeddings.
- **Settings:** `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `temp_store=MEMORY`, `mmap_size` ~256MB.
- Migrations run automatically at startup with drizzle-kit migrations. A backup copy (`photobeaver.db.bak-<version>`) is taken before any migration.

Files that don't belong in the DB:

- Thumbnails: `<userData>/library/thumbs/<first 2 chars of asset id>/<asset id>_<size>.webp` (sizes: 256, 1024)
- Original cache (LRU, user-configurable cap, default 5 GB): `<userData>/library/cache/originals/`
- Plugins: `<userData>/plugins/<plugin-id>/<version>/`
- Plugin private storage: `<userData>/plugin-data/<plugin-id>/`

### 4.1.1 Library location (decided: user can choose, including external drives)

- The **library** = the DB file + `thumbs/` + `cache/`. Default location is `<userData>/library/`. Plugins and plugin data stay in `<userData>` regardless.
- Settings > Library > "Move library" lets the user pick any folder, including an external or network drive. Core closes the DB, copies the library folder, verifies the copy (SQLite `PRAGMA integrity_check` + file counts), switches the path, then offers to delete the old copy.
- The chosen path is stored outside the DB in `<userData>/library-location.json` (with the volume's id/label where the OS provides it).
- **Startup check:** if the library folder is missing (drive unplugged, network share down), the app does **not** create a new empty library. It shows a "Library not found" screen with: Retry, Locate library (pick the folder elsewhere), or Create a new library. The scheduler doesn't start until a library is open.
- If the drive disappears while the app is running, core stops the scheduler, puts the UI in a read-only "Library offline" state and retries every 10 seconds.
- Warn (don't block) when the chosen location is on a network share, because SQLite WAL mode isn't safe on most network filesystems. On network shares, core switches to `journal_mode=DELETE`.

### 4.2 Core data model

Key idea: **Asset** (a unique piece of media, identified by content) vs **Instance** (where that asset lives, in a specific source). One photo stored in Dropbox and on local disk = 1 asset, 2 instances.

```sql
-- Installed plugins
plugins (
  id TEXT PRIMARY KEY,              -- "com.photobeaver.connector-dropbox"
  version TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'connector' | 'enricher'
  enabled INTEGER NOT NULL DEFAULT 1,
  manifest_json TEXT NOT NULL,
  granted_permissions_json TEXT NOT NULL,
  install_source TEXT NOT NULL,     -- 'builtin' | 'registry' | 'file' | 'dev'
  health TEXT NOT NULL DEFAULT 'ok',-- 'ok' | 'degraded' | 'crashed' | 'disabled_by_system'
  installed_at INTEGER, updated_at INTEGER
)

-- A configured account/folder for a connector. One connector can have many sources
-- (two Dropbox accounts, three local folders).
sources (
  id TEXT PRIMARY KEY,              -- ulid
  plugin_id TEXT NOT NULL REFERENCES plugins(id),
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL,        -- validated against the plugin's config schema
  secret_ref TEXT,                  -- key into secrets service, never the token itself
  sync_cursor TEXT,                 -- opaque, owned by the plugin
  sync_state TEXT NOT NULL DEFAULT 'idle', -- 'idle'|'queued'|'running'|'error'|'auth_required'|'paused'
  schedule_json TEXT NOT NULL,      -- { intervalSec, mode: 'poll'|'watch'|'manual' }
  last_sync_started_at INTEGER, last_sync_finished_at INTEGER,
  last_error TEXT, consecutive_failures INTEGER DEFAULT 0,
  next_run_at INTEGER,
  created_at INTEGER
)

-- A piece of media as the user sees it. Starts as 1 asset per instance; plugins
-- (e.g. the default dedup plugin) can merge assets that are the same media.
assets (
  id TEXT PRIMARY KEY,              -- ulid
  media_type TEXT NOT NULL,         -- 'image' | 'video'
  mime TEXT,
  width INTEGER, height INTEGER, duration_ms INTEGER,
  captured_at INTEGER,              -- best-known capture time (UTC ms)
  captured_at_source TEXT,          -- 'exif'|'source'|'filename'|'mtime'
  lat REAL, lon REAL,
  favorite INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  thumb_state TEXT DEFAULT 'pending',
  created_at INTEGER, updated_at INTEGER
)
INDEX assets(captured_at), assets(lat, lon), assets(media_type)

-- Where an asset lives
instances (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,        -- id in the source (path, Dropbox id, FB photo id)
  external_url TEXT,                -- link to view on the source, if any
  path TEXT,                        -- human-readable location/album path
  size_bytes INTEGER,
  source_modified_at INTEGER,
  source_metadata_json TEXT,        -- raw metadata from the connector (captions, album...)
  etag TEXT,                        -- change detection
  deleted_at INTEGER,               -- tombstone
  UNIQUE(source_id, external_id)
)

-- Enrichment output. Namespaced by plugin so plugins can't collide.
enrichments (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  plugin_version TEXT NOT NULL,
  key TEXT NOT NULL,                -- e.g. "location", "exif", "scene"
  value_json TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY(asset_id, plugin_id, key)
)

-- Identity keys published by plugins (e.g. "sha256:<hex>", "phash:<hex>").
-- Core stores and indexes them; it attaches no meaning to them.
asset_identity (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY(asset_id, plugin_id, key)
)
INDEX asset_identity(key)

-- Duplicate suggestions waiting for the user (merges a plugin isn't sure about)
duplicate_suggestions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  asset_ids_json TEXT NOT NULL,     -- 2+ asset ids
  kind TEXT NOT NULL,               -- 'exact' | 'near'
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'merged' | 'dismissed'
  created_at INTEGER
)

-- Merge history, so any merge can be undone
asset_merges (
  id TEXT PRIMARY KEY,
  surviving_asset_id TEXT NOT NULL,
  merged_asset_id TEXT NOT NULL,
  moved_instance_ids_json TEXT NOT NULL,
  merged_by TEXT NOT NULL,          -- plugin id or 'user'
  created_at INTEGER,
  undone_at INTEGER
)

-- Tags (from users or enrichers)
tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, -- 'user'|'auto'|'place'
      UNIQUE(name, kind))
asset_tags (asset_id, tag_id, plugin_id NULL, confidence REAL, PRIMARY KEY(asset_id, tag_id))

-- People / faces
people (id TEXT PRIMARY KEY, name TEXT, cover_face_id TEXT, created_at INTEGER)
faces (
  id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  plugin_id TEXT, bbox_json TEXT, confidence REAL,
  person_id TEXT REFERENCES people(id), assigned_by TEXT -- 'user' | 'auto'
)
faces_vec USING vec0(face_id TEXT PRIMARY KEY, embedding FLOAT[512])  -- sqlite-vec

-- Albums (user albums and albums imported from sources)
albums (id, name, source_id NULL, external_id NULL, created_at)
album_assets (album_id, asset_id, position)

-- Users and access control (section 3.3)
users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_path TEXT,
  role TEXT NOT NULL,               -- 'viewer' | 'editor' | 'admin'
  secret_hash TEXT,                 -- argon2id of password/PIN, NULL in single-user mode
  secret_kind TEXT,                 -- 'password' | 'pin'
  biometric_enabled INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  created_at INTEGER, last_login_at INTEGER
)
user_scopes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,         -- 'source' | 'album'
  scope_id TEXT NOT NULL,
  PRIMARY KEY(user_id, scope_type, scope_id)
)
audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,                     -- NULL for system/plugin actions
  action TEXT NOT NULL,             -- e.g. 'source.remove', 'asset.merge', 'user.role_change'
  target_type TEXT, target_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
)

-- Durable job queue
jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- 'sync_source' | 'enrich' | 'thumbnail' | 'plugin_task'
  plugin_id TEXT, source_id TEXT, asset_id TEXT,
  payload_json TEXT,
  priority INTEGER NOT NULL DEFAULT 100,  -- lower runs first; UI-triggered = 10
  status TEXT NOT NULL DEFAULT 'queued',  -- 'queued'|'leased'|'done'|'failed'|'dead'
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after INTEGER NOT NULL,
  lease_owner TEXT, lease_expires_at INTEGER,
  last_error TEXT,
  dedupe_key TEXT UNIQUE,           -- e.g. "enrich:<asset>:<plugin>@<version>"
  created_at INTEGER, updated_at INTEGER
)
INDEX jobs(status, priority, run_after)

-- Search
assets_fts USING fts5(asset_id UNINDEXED, text)  -- filename, captions, tags, place names, people

-- Settings (kv)
settings (key TEXT PRIMARY KEY, value_json TEXT)

-- Plugin key-value storage (served to plugins via ctx.storage)
plugin_kv (plugin_id TEXT, key TEXT, value_json TEXT, PRIMARY KEY(plugin_id, key))
```

### 4.3 Asset resolution and merging

Core does **not** decide what counts as a duplicate. That's a plugin's job (the default `enricher-dedup`, see section 9). Core only provides the mechanics:

1. When a connector reports an item, core upserts the **instance** on `(source_id, external_id)`.
2. A **new** instance gets its own new asset. An instance that's already known keeps its asset, even if its content changed.
3. Plugins with the `assets: "merge"` permission can publish **identity keys** for an asset, look up other assets by key, and ask core to **merge** assets or **suggest** a merge to the user (section 6.3).
4. **Merge primitive** (core, one transaction): pick the surviving asset (oldest by `created_at`), move all instances, album memberships, tags, faces and user edits (favorite, hidden) to it, keep the survivor's enrichments and fill gaps from the merged asset, re-point identity keys, delete the merged asset, write an `asset_merges` row. Then queue enrichment for the survivor so dependent plugins can update.
5. **Unmerge:** any merge can be undone from the asset's info panel or Settings > Activity, using `asset_merges`. Undoing restores the original asset and its instances, and adds the pair to a "never merge" list that plugins see through `ctx.assets.isMergeBlocked()`.

With no dedup plugin enabled, the app still works. Every instance just shows up as its own asset.

When all instances of an asset are tombstoned, the asset moves to "Missing" (kept 30 days, then purged along with its thumbnails).

---

## 5. Plugin packaging and installation

### 5.1 What a plugin is

A plugin is a **folder (or npm package) with a `photobeaver-plugin.json` manifest and a JS entry point** that default-exports a plugin definition built with the SDK.

```
my-plugin/
  photobeaver-plugin.json
  package.json
  dist/index.js          # built entry (CommonJS or ESM)
  assets/icon.png
  README.md
```

### 5.2 Manifest (`photobeaver-plugin.json`)

Validated with zod on install and on every load. Invalid manifest = plugin refused.

```jsonc
{
  "id": "com.example.connector-flickr",   // reverse-DNS, unique, immutable
  "name": "Flickr",
  "version": "1.2.0",                      // semver
  "type": "connector",                     // "connector" | "enricher"
  "apiVersion": "1",                       // Plugin API major version it targets
  "main": "dist/index.js",
  "description": "Index photos from your Flickr account",
  "author": { "name": "Jane Dev", "url": "https://..." },
  "license": "MIT",
  "icon": "assets/icon.png",
  "engines": { "photobeaver": ">=1.0.0" },

  "permissions": {
    "network": ["api.flickr.com", "*.staticflickr.com"],  // allowlisted hosts
    "filesystem": "none",          // "none" | "user-selected" (dirs the user picks in config)
    "oauth": true,                 // may use the OAuth broker
    "originals": "read",           // enrichers: "none" | "thumbnail" | "read"
    "assets": "none",              // enrichers: "none" | "merge" (publish identity keys,
                                   // merge assets, suggest duplicates; shown on install)
    "nativeModules": false,        // needs native .node binaries (flagged in UI)
    "gpu": false
  },

  // Connector-only
  "connector": {
    "syncModes": ["poll"],                // "poll" | "watch" | "manual"
    "defaultIntervalSec": 3600,
    "minIntervalSec": 600,
    "supportsIncremental": true,
    "providesContentHash": false,
    "rateLimit": { "requests": 3600, "perSec": 3600 },
    "multipleSources": true
  },

  // Enricher-only
  "enricher": {
    "accepts": ["image/*"],               // MIME globs
    "input": "thumbnail",                 // "metadata" | "thumbnail" | "original"
    "dependsOn": ["com.photobeaver.enricher-metadata"], // runs after these
    "produces": ["tags", "enrichment:scene"],            // declared outputs
    "concurrency": 2,
    "resourceClass": "cpu-heavy",         // "light" | "cpu-heavy" | "gpu"
    "runOn": ["new", "changed"]           // plus manual "re-run on library"
  },

  // JSON Schema for the per-source config (connectors) or global settings (enrichers).
  // The UI renders the form from this automatically.
  "configSchema": {
    "type": "object",
    "properties": {
      "includeVideos": { "type": "boolean", "default": true, "title": "Include videos" }
    }
  }
}
```

### 5.3 API versioning

- `apiVersion` is the **major** version of the plugin API. Core supports the current major and the previous one (N and N-1) through a compatibility shim in the plugin host.
- Additive changes (new optional methods, new ctx helpers) are minor SDK releases and don't bump `apiVersion`.
- A plugin whose `apiVersion` isn't supported is shown as "Incompatible" and not loaded.

### 5.4 Install channels

| Channel | How | Trust |
|---|---|---|
| **Default** | Bundled in the app under `resources/plugins`, installed on first run (section 9) | Trusted |
| **Registry** | In-app "Plugin Store" reads a registry index (a static JSON on GitHub Pages / CDN: `registry.photobeaver.app/index.json`) listing id, versions, tarball URL, sha256, signature, permissions. User clicks Install. | Verified (sha256 + signature check) |
| **File** | User drags in a `.pbplugin` file (a zip of the plugin folder) or picks it in Settings > Plugins > Install from file | Unverified, shown with a warning |
| **Dev** | Settings > Plugins > Developer > "Load unpacked plugin" points at a local folder. Watches `dist/` and hot-reloads on change. | Dev mode only |

Install flow (all channels):

1. Download or read the package, verify checksum (and signature for registry).
2. Unpack to a temp dir, validate the manifest.
3. Show a **permission consent dialog** (network hosts, filesystem, originals access, native modules).
4. Move to `<userData>/plugins/<id>/<version>/`. Keep the previous version until the new one loads successfully (rollback on failure).
5. Register in the `plugins` table, then start the plugin host.

Updates: check the registry daily. If an update requests **new** permissions, the user must approve again. Otherwise auto-update if the user enabled that.

Uninstall: stop the host, delete plugin files, and ask the user whether to keep or remove data the plugin produced (instances from its sources, enrichments, tags, faces).

Plugins with dependencies must ship them bundled (the scaffolder builds with esbuild/tsup into one file). Core never runs `npm install` on the user's machine.

### 5.5 Developer tooling

- **`npm create photobeaver-plugin@latest`** scaffolds a connector or enricher project: TypeScript, tsup build, Vitest, a sample test using the SDK's test harness, and the manifest.
- **`pb-plugin` CLI** (from `@photobeaver/plugin-cli`):
  - `pb-plugin dev` builds in watch mode and tells a running Photo Beaver (dev mode) to load or reload the plugin through a local dev socket.
  - `pb-plugin validate` checks the manifest and exports.
  - `pb-plugin test` runs the plugin against the **SDK test harness**: a fake host API with an in-memory store, fake OAuth and fixture media. Connector authors can run a full sync against a mock without the desktop app.
  - `pb-plugin pack` produces `<id>-<version>.pbplugin` with a sha256.
  - `pb-plugin publish` opens a PR to the registry repo (registry is a GitHub repo of JSON entries, reviewed by maintainers).
- **Plugin Inspector** (in the app, dev mode): live logs per plugin, RPC trace, job history, "run sync now", "re-enrich this asset", and memory/CPU of each plugin host.

---

## 6. Plugin API (the contract)

All types live in `@photobeaver/plugin-sdk`. Plugins export one definition:

```ts
import { defineConnector, defineEnricher } from '@photobeaver/plugin-sdk';
```

### 6.1 Shared types

```ts
export interface MediaItem {
  externalId: string;            // stable id within the source, required
  kind: 'image' | 'video';
  mime?: string;
  filename?: string;
  path?: string;                 // album / folder path for display
  sizeBytes?: number;
  width?: number; height?: number; durationMs?: number;
  capturedAt?: string;           // ISO 8601, if the source knows it
  modifiedAt?: string;           // for change detection
  etag?: string;                 // for change detection (preferred)
  contentHash?: { algo: string; value: string };  // whatever hash the source provides
                                                  // (passed to enrichers, e.g. lets dedup
                                                  // skip downloading the original)
  externalUrl?: string;          // "open in source" link
  location?: { lat: number; lon: number };
  caption?: string;
  albums?: { externalId: string; name: string }[];
  metadata?: Record<string, unknown>; // anything else, stored raw
}

export interface ItemRef {       // what core passes back to a plugin to act on an item
  sourceId: string;
  externalId: string;
  metadata?: Record<string, unknown>;
}

export type Logger = {
  debug(msg: string, data?: object): void;
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;
};
```

### 6.2 Connector interface

```ts
export interface ConnectorPlugin<Config = unknown> {
  /** Called once when the plugin host starts. */
  activate?(ctx: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;

  /**
   * Called when the user adds a source. Do the auth flow (via ctx.oauth) and validate config.
   * Return a display name and an opaque secret blob. Core stores the blob in the OS keychain.
   */
  setupSource(ctx: SourceContext<Config>): Promise<{
    displayName: string;
    secret?: Record<string, unknown>;
  }>;

  /** Quick health/auth check. Throw AuthRequiredError if the user must reconnect. */
  testSource?(ctx: SourceContext<Config>): Promise<void>;

  /**
   * THE core method. Enumerate changes since `cursor` (null = full scan).
   * Yield batches. After each batch core commits it AND the batch's cursor in one
   * transaction, so a crash resumes from the last committed batch.
   */
  sync(ctx: SyncContext<Config>, cursor: string | null): AsyncIterable<SyncBatch>;

  /** Stream thumbnail bytes if the source provides them (saves downloading originals). */
  getThumbnail?(ctx: SourceContext<Config>, item: ItemRef, size: number):
    Promise<ReadableStream<Uint8Array> | null>;

  /** Stream original bytes. Required. */
  getOriginal(ctx: SourceContext<Config>, item: ItemRef): Promise<ReadableStream<Uint8Array>>;

  /** Optional push-based change detection (local FS, webhooks). */
  watch?(ctx: SyncContext<Config>, onChange: (batch: SyncBatch) => void): Promise<() => void>;
}

export interface SyncBatch {
  upserts?: MediaItem[];          // new or changed items
  deletes?: string[];             // externalIds that are gone
  albums?: { externalId: string; name: string }[];
  cursor: string;                 // opaque cursor valid after this batch
  progress?: { done: number; total?: number; message?: string };
  isFullScan?: boolean;           // if true and this is the final batch, core tombstones
                                  // every instance of this source not seen in this scan
}

export const defineConnector = <C>(p: ConnectorPlugin<C>) => p;
```

Rules for connectors:

- `externalId` must be stable across syncs. Cursors are opaque to core. Core just stores and returns them.
- Batches should be 100 to 1000 items. Core applies backpressure: the async iterator isn't pulled again until the previous batch is committed.
- Honor `ctx.signal` (an `AbortSignal`) for cancellation, and use `ctx.fetch` for HTTP (it enforces the network allowlist, the rate limit from the manifest, and retries 429s with `Retry-After`).
- Throw `AuthRequiredError` to put the source into `auth_required`. The UI then shows a "Reconnect" button.
- Throw `RateLimitedError({ retryAfterSec })` to reschedule without counting as a failure.

### 6.3 Enricher interface

```ts
export interface EnricherPlugin<Settings = unknown> {
  activate?(ctx: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;

  /** Optional fast filter before a job is queued (e.g. skip screenshots). */
  shouldEnrich?(asset: AssetView): boolean;

  /** Process one asset and return results. Must be idempotent. */
  enrich(ctx: EnrichContext<Settings>, asset: AssetView): Promise<EnrichmentResult>;

  /** Optional batch variant (for GPU models). Core uses it if present. */
  enrichBatch?(ctx: EnrichContext<Settings>, assets: AssetView[]):
    Promise<Map<string, EnrichmentResult>>;

  /** Optional library-wide step after a batch run (e.g. cluster faces into people). */
  finalize?(ctx: EnrichContext<Settings>): Promise<void>;
}

export interface AssetView {
  id: string;
  kind: 'image' | 'video';
  mime?: string;
  width?: number; height?: number; durationMs?: number;
  capturedAt?: string;
  location?: { lat: number; lon: number };
  instances: {
    sourceId: string; filename?: string; path?: string; caption?: string;
    sizeBytes?: number; contentHash?: { algo: string; value: string };
  }[];
  enrichments: Record<string /* pluginId */, Record<string, unknown>>; // from dependsOn plugins
}

export interface EnrichmentResult {
  data?: Record<string, unknown>;              // stored in enrichments under this plugin's namespace
  tags?: { name: string; confidence?: number; kind?: 'auto' | 'place' }[];
  capturedAt?: string;                         // core fields an enricher may propose
  location?: { lat: number; lon: number };
  dimensions?: { width: number; height: number; durationMs?: number };
  faces?: {
    bbox: { x: number; y: number; w: number; h: number }; // normalized 0..1
    confidence: number;
    embedding?: number[];                      // stored in faces_vec
  }[];
  searchText?: string;                         // added to FTS index (place names, OCR text)

  // Requires permissions.assets = "merge"
  identityKeys?: string[];                     // e.g. ["sha256:ab12..", "phash:9f3c.."]
  mergeWith?: string[];                        // asset ids that are the SAME media: core merges
  suggestDuplicates?: {                        // possible duplicates: user decides
    assetIds: string[]; kind: 'exact' | 'near'; confidence: number;
  }[];
}

export const defineEnricher = <S>(p: EnricherPlugin<S>) => p;
```

Rules for enrichers:

- Input bytes come through `ctx.getInput()` which returns a local temp file path to the thumbnail or original, depending on `manifest.enricher.input`. Core handles fetching, caching and cleanup. Enrichers never talk to connectors.
- Core fields (`capturedAt`, `location`, `dimensions`) follow a **precedence order**: user edit > enricher-metadata (EXIF) > source-provided > other enrichers > filename > mtime. An enricher proposes values; core decides.
- `identityKeys`, `mergeWith` and `suggestDuplicates` are rejected unless the plugin has `assets: "merge"`. Core applies them after storing the rest of the result. `mergeWith` is skipped for pairs on the "never merge" list, and is turned into a suggestion instead if the user set merging to "always ask".
- A plugin version bump **doesn't** re-run automatically. The update dialog offers "Re-process library with the new version" and the enricher's settings page has a "Re-run" button. (The `dedupe_key` includes the version, so this is a matter of queueing jobs.)

### 6.4 Host API: `ctx` (what plugins can call)

```ts
export interface PluginContext {
  pluginId: string;
  log: Logger;                                  // shown in Plugin Inspector, written to log files
  storage: {                                    // per-plugin KV in plugin_kv
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  dataDir: string;                              // private dir for models, caches
  fetch: typeof fetch;                          // allowlist + rate limit + retry
  settings<T>(): Promise<T>;                    // enricher global settings
  signal: AbortSignal;
}

export interface SourceContext<Config> extends PluginContext {
  sourceId: string;
  config: Config;
  secret: {                                     // backed by safeStorage via core
    get(): Promise<Record<string, unknown> | undefined>;
    set(v: Record<string, unknown>): Promise<void>; // e.g. refreshed tokens
  };
  oauth: {
    /** Core opens the system browser, runs a loopback redirect with PKCE, returns tokens. */
    authorize(opts: {
      authUrl: string; tokenUrl: string; clientId: string;
      scopes: string[]; extraParams?: Record<string, string>;
    }): Promise<OAuthTokens>;
    refresh(opts: { tokenUrl: string; clientId: string; refreshToken: string }): Promise<OAuthTokens>;
  };
  ui: {
    pickDirectory(): Promise<string | null>;    // grants filesystem access to that dir
    notify(msg: string, level?: 'info' | 'warn' | 'error'): void;
  };
}

export interface SyncContext<Config> extends SourceContext<Config> {
  reportProgress(p: { done: number; total?: number; message?: string }): void;
  isKnown(externalIds: string[]): Promise<Record<string, { etag?: string; modifiedAt?: string }>>;
  //  ^ lets a connector skip unchanged items during a full scan without core leaking the DB
}

export interface EnrichContext<Settings> extends PluginContext {
  getInput(asset: AssetView): Promise<{ path: string; mime: string }>;
  settings(): Promise<Settings>;
  assets: {                                     // requires permissions.assets = "merge"
    /** Asset ids (excluding the given one) that have any of these identity keys. */
    findByIdentity(keys: string[], opts?: { excludeAssetId?: string }): Promise<Record<string, string[]>>;
    /** Asset ids with a key starting with the prefix, paged (for near-dup scans in finalize). */
    listIdentity(prefix: string, cursor?: string): Promise<{ items: { assetId: string; key: string }[]; cursor?: string }>;
    /** True if the user undid a merge of these two assets before. */
    isMergeBlocked(a: string, b: string): Promise<boolean>;
    /** Same as returning suggestDuplicates, usable from finalize(). */
    suggestDuplicates(s: { assetIds: string[]; kind: 'exact' | 'near'; confidence: number }[]): Promise<void>;
  };
}
```

### 6.5 Transport (core <-> plugin host)

- One `utilityProcess` per plugin. Core creates a `MessageChannelMain` and sends one port to the host.
- Protocol: **JSON-RPC 2.0** over the port, with request ids, cancellation (`$/cancel`) and streaming (async iterables are sent as a sequence of `stream/next` messages with acks for backpressure; binary streams go as transferable `ArrayBuffer` chunks of 1MB).
- Both directions are typed from `packages/shared/rpc.ts`. Every incoming payload is validated with zod on the core side. A plugin sending invalid data gets an error, and the data is dropped.
- The plugin host (`src/plugin-host/index.ts`) loads the plugin's `main`, wraps its methods as RPC handlers, and builds `ctx` as RPC proxies to core.

### 6.6 Isolation and permissions

- The plugin host process runs with a restricted environment. `ctx.fetch` enforces `permissions.network`. On top of that, the host patches `http`, `https`, `net` and global `fetch` to refuse hosts outside the allowlist (defense in depth, not a real sandbox; this is stated in docs).
- Filesystem: the host passes only granted directories (`ctx.ui.pickDirectory` results or config dirs) and `dataDir`. Plugins that declare `"filesystem": "none"` get a patched `fs` that throws outside `dataDir` and temp input files.
- Resource limits per host: `--max-old-space-size` (default 1024MB, 4096MB for `gpu` / `cpu-heavy`), RPC call timeout (default 5 min for `enrich`, no timeout for `sync` as long as batches keep arriving within 10 min).
- **Threat model (documented honestly):** v1 isolation protects stability and limits accidental overreach. It isn't a hardened security sandbox against malicious native code. That's why registry plugins are reviewed and signed, file installs show a warning, and `nativeModules: true` is shown prominently.

### 6.7 Example: minimal connector

```ts
import { defineConnector, AuthRequiredError } from '@photobeaver/plugin-sdk';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

type Config = { root: string };

export default defineConnector<Config>({
  async setupSource(ctx) {
    const root = ctx.config.root ?? (await ctx.ui.pickDirectory());
    if (!root) throw new Error('No folder selected');
    return { displayName: path.basename(root) };
  },

  async *sync(ctx, _cursor) {
    let batch = [];
    for await (const file of walk(ctx.config.root)) {
      const s = await stat(file);
      batch.push({
        externalId: file,
        kind: /\.(mp4|mov)$/i.test(file) ? 'video' : 'image',
        filename: path.basename(file),
        path: path.dirname(path.relative(ctx.config.root, file)),
        sizeBytes: s.size,
        modifiedAt: s.mtime.toISOString(),
        etag: `${s.size}-${s.mtimeMs}`,
      });
      if (batch.length === 500) {
        yield { upserts: batch, cursor: new Date().toISOString(), isFullScan: true };
        batch = [];
      }
    }
    yield { upserts: batch, cursor: new Date().toISOString(), isFullScan: true };
  },

  async getOriginal(_ctx, item) {
    return Readable.toWeb(createReadStream(item.externalId)) as ReadableStream<Uint8Array>;
  },
});
```

(The real `connector-local` also implements `watch()` with chokidar and skips unchanged files using `ctx.isKnown`.)

### 6.8 Example: minimal enricher

```ts
import { defineEnricher } from '@photobeaver/plugin-sdk';
import { reverseGeocode } from './geonames-offline';

export default defineEnricher({
  shouldEnrich: (a) => !!a.location,
  async enrich(_ctx, asset) {
    const place = await reverseGeocode(asset.location!.lat, asset.location!.lon);
    return {
      data: { location: place },       // { city, region, country, countryCode }
      tags: [place.city, place.country].filter(Boolean).map((name) => ({ name, kind: 'place' })),
      searchText: [place.city, place.region, place.country].join(' '),
    };
  },
});
```

---

## 7. The plugin loop (scheduler, sync and enrichment)

This is the heart of the system. It must be **durable** (state lives in SQLite, not memory), **resumable** (crash at any point resumes cleanly), and **polite** (respects rate limits, battery and CPU).

### 7.1 Components

```
                +--------------------+
   timer tick ->|   Scheduler        |-- enqueues sync_source jobs for due sources
   (every 15s)  +--------------------+
                          |
                          v
                +--------------------+      +-----------------------+
                |   Job Queue        |<---->|  Worker Lanes          |
                |  (jobs table)      |      |  - sync lane (N=3)     |
                +--------------------+      |  - enrich lane (per    |
                          ^                 |    resourceClass)      |
                          |                 |  - core lane (thumbs,  |
          new/changed     |                 |    decode) N=cores-1   |
          assets enqueue  |                 +-----------+-----------+
          enrich jobs     |                             |
                          +----------- Pipeline <-------+
                                     (on commit)
```

### 7.2 Scheduler

Runs in the main process on a 15 second tick (and immediately on app start, on network-online, and on user "Sync now").

On each tick:

1. Select sources where `sync_state IN ('idle','error')` AND `next_run_at <= now` AND the plugin is enabled and healthy AND schedule mode is `poll`.
2. For each, insert a `sync_source` job with `dedupe_key = "sync:<sourceId>"` (so a source is never queued twice) and set `sync_state='queued'`.
3. Sources with mode `watch` get a `watch()` subscription when their plugin host starts. They **also** get a safety poll (default every 24h, full scan) to catch missed events.
4. Next run time after a sync:
   - success: `next_run_at = now + intervalSec` (plus 0 to 10% jitter)
   - failure: exponential backoff `min(intervalSec, 60s * 2^consecutive_failures)`, capped at 6h. After 10 consecutive failures, `sync_state='error'` and the user is notified, with polling continuing at the cap.
   - `AuthRequiredError`: `sync_state='auth_required'`, no more runs until the user reconnects.
   - `RateLimitedError`: `next_run_at = now + retryAfterSec`, failure count unchanged.

### 7.3 Job queue semantics

- **Leasing:** a worker claims a job atomically:
  ```sql
  UPDATE jobs SET status='leased', lease_owner=?, lease_expires_at=?+?, attempts=attempts+1
  WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=? AND kind IN (...)
              ORDER BY priority, run_after LIMIT 1)
  RETURNING *;
  ```
- **Heartbeat:** long jobs (sync) extend their lease every 30s. On startup, and every minute, leases past expiry return to `queued` (crash recovery).
- **Retry:** failed jobs return to `queued` with `run_after = now + backoff(attempts)`. After `max_attempts` they go to `dead` and appear in Settings > Activity > Failed, with "Retry" and "Retry all" buttons.
- **Dedupe:** `dedupe_key` UNIQUE with `INSERT ... ON CONFLICT DO NOTHING`.
- **Priority:** UI-triggered work (user opened an asset that needs a thumbnail, pressed "Sync now") runs at priority 10. Background work runs at 100.
- **Cleanup:** `done` jobs are deleted after 24h. `dead` jobs are kept 30 days.

### 7.4 Sync job execution

```
runSyncJob(source):
  set sync_state='running', last_sync_started_at=now
  host = pluginManager.getHost(source.plugin_id)       // starts it if needed
  for await batch of host.sync(sourceCtx, source.sync_cursor):
     BEGIN TRANSACTION
       upsert instances (skip if etag/modifiedAt unchanged)
       resolve/create assets (section 4.3)
       apply deletes -> tombstone instances
       upsert albums
       UPDATE sources SET sync_cursor = batch.cursor
       enqueue follow-up jobs for new/changed assets:
          thumbnail (priority 50), enrich (per matching enricher)
     COMMIT
     emit progress event to UI
     heartbeat lease
  if last batch had isFullScan: tombstone instances of this source not seen in this run
     (tracked with a run id column `seen_run_id` on instances)
  set sync_state='idle', last_sync_finished_at=now, consecutive_failures=0
```

A crash mid-sync loses at most the uncommitted batch. The next run resumes from the last committed cursor.

### 7.5 Enrichment pipeline

- When an asset is created or changed (new instance, merge, core fields changed), core computes the **enrichment plan**: all enabled enrichers whose `accepts` matches the MIME type, sorted topologically by `dependsOn` (cycles are rejected at install time).
- Enrichers with no unmet dependencies are queued immediately. When an enrich job completes, core queues dependents whose dependencies are now all satisfied for that asset.
- If `input` is `thumbnail`, the job waits (`run_after` pushed out) until the thumbnail exists. If `original`, core fetches through the connector into the original cache first.
- **Lanes by resource class** so a heavy model doesn't starve light work:
  - `light`: up to 4 concurrent jobs
  - `cpu-heavy`: up to `max(1, cores/2)`
  - `gpu`: 1
  Per plugin concurrency is also capped by `manifest.enricher.concurrency`.
- Jobs are grouped for `enrichBatch` when the plugin supports it (up to 32 assets per call).
- `finalize()` is called when an enricher's queue drains, debounced to at most once per 10 minutes.

### 7.6 Plugin host lifecycle and health

- Hosts start lazily (when a job needs them) and stop after 10 minutes idle. Hosts with an active `watch()` stay alive.
- Crash handling: if a host exits unexpectedly, in-flight jobs go back to the queue (they count as an attempt). Core restarts the host with backoff (1s, 5s, 30s, 2m). **5 crashes in 10 minutes** sets `health='crashed'`, stops scheduling that plugin, and notifies the user with a "View logs" and "Re-enable" option.
- A hang is detected by RPC timeouts. The host is killed and treated as a crash.

### 7.7 Being a good citizen

- **Global pause** button in the status bar ("Pause all background work").
- **Battery:** on battery power, only `light` enrichers and sync run. Heavy enrichers wait for AC (setting, default on).
- **Idle-aware:** heavy lanes get more concurrency when the system has been idle for 5 min (`powerMonitor.getSystemIdleTime()`), and scale back when the user returns.
- **Metered network:** setting to skip downloading originals on metered connections.
- **Quit:** on app quit, stop leasing new jobs, give in-flight jobs 5 seconds, then shut down. Leases expire and jobs resume next launch.
- Optional: "Keep syncing in the background when the window is closed" (tray icon). Default off on Windows/Linux, and off on macOS.

---

## 8. UI

### 8.1 Screens

1. **Library (home):** virtualized justified grid grouped by day/month, with a scrubbable timeline on the right. Must stay at 60fps with 200k assets. Thumbnails served via the `pb-media://thumb/<assetId>/<size>` custom protocol.
2. **Viewer:** full-screen asset view, next/prev, zoom, video playback, info panel (sources/instances with "Open in source", EXIF, location map, tags, people, all enrichment data grouped by plugin).
3. **Search and filters:** search box (FTS over filenames, captions, tags, places, people) plus filter chips: date range, source, media type, place, person, tag, favorites, "in multiple sources".
4. **Map:** clustered map of geotagged assets (MapLibre GL with an offline-friendly default style; tile provider configurable).
5. **People:** face clusters, name a person, merge/split clusters (available once a faces enricher is installed).
6. **Albums:** user albums plus albums imported from sources.
7. **Duplicates:** shown when a plugin with `assets: "merge"` is enabled. Lists open `duplicate_suggestions` side by side (user merges, picks which to keep, or dismisses), plus recent automatic merges with an Undo button.
8. **Sources:** list of connected sources with status, item count, last sync, "Sync now", "Pause", "Reconnect", "Remove". "Add source" opens the list of installed connectors, then the connector's config form (rendered from `configSchema`) and its setup flow.
9. **Plugins:** Installed / Store / Developer tabs. Each plugin: enable/disable, permissions, settings form, version, update, logs, uninstall. Enrichers show queue size and a "Re-run on library" button.
10. **Activity:** live jobs, progress per source, per-lane queue depths, failed jobs with retry.
11. **Settings:** library location, cache size, background behavior (battery, idle, tray), language, theme (light/dark/system), backup/restore of the DB. Most settings are Admin only; each user can change their own theme, language, password/PIN and avatar.
12. **Users** (Admin, shown once multiple users is on): list of users, add/edit/disable, role picker, scope picker (sources and albums), reset password, recovery key, audit log.
13. **Sign-in / user picker** (multiple-users mode only): avatars, password/PIN/biometric unlock, lock screen.

### 8.2 First-run experience

1. Welcome screen, then "Where are your photos?" with big tiles for the default connectors.
2. Local folder is pre-suggested (Pictures folder).
3. Sync starts immediately. The grid fills in as batches commit, so there's something to look at within seconds.

### 8.3 Preload API (`window.pb`)

Typed, promise-based, no direct Node access in the renderer. Grouped by domain: `pb.library.query(...)`, `pb.assets.get(id)`, `pb.sources.*`, `pb.plugins.*`, `pb.jobs.*`, `pb.settings.*`, `pb.session.*` (current user, sign in/out, lock), `pb.users.*` (Admin), plus `pb.events.on(channel, cb)` for push updates (sync progress, new assets, job counts). All request/response types come from `packages/shared`.

Library queries are **cursor-paginated** (keyset on `captured_at, id`), never offset-based.

---

## 9. Default plugins (out of the box)

### 9.1 What "default" means

Core on its own only knows how to store, sync, schedule and display. Everything that makes Photo Beaver useful on day one comes from **default plugins**:

- They ship inside the installer (`resources/plugins`) and are installed automatically on first run. No download, no consent dialog (their permissions are listed in Settings > Plugins like any other plugin).
- They're **ordinary plugins**: same manifest, same SDK, same isolated plugin host, same update channel (the registry can ship fixes to them between app releases). No private APIs. If a default plugin needs something, it goes into the public SDK.
- Users can **disable** or **uninstall** any of them, and the app keeps working. They can be reinstalled from Settings > Plugins > "Restore default plugins".
- Community plugins can **replace** them (e.g. a smarter dedup plugin). If two enabled plugins hold the same `assets: "merge"` role, the UI warns and asks which one to keep enabled.
- Some defaults are **enabled on install**, some are **installed but off** until the user turns them on (because they download models or use a lot of CPU).

Each default plugin's manifest carries `"default": { "enabledOnInstall": true | false }`. Core ignores this field for non-bundled plugins.

### 9.2 Default connectors

| Plugin | Enabled | Notes |
|---|---|---|
| `connector-local` | yes | Folders on disk / external drives / mounted NAS. `watch()` with chokidar + daily full scan. Handles drives going offline (source shows "Offline", instances aren't tombstoned while the root is missing). |
| `connector-dropbox` | yes | OAuth2 PKCE. `files/list_folder` + `list_folder/continue` cursor for incremental sync. Passes Dropbox's `content_hash` as `contentHash: { algo: 'dropbox', ... }`. |
| `connector-onedrive` | yes | Microsoft Graph, OAuth2 PKCE, `delta` API for incremental sync. Passes the file hash Graph returns (`quickXorHash` / `sha256Hash` when present). |
| `connector-google-photos` | yes | See platform risk below. v1 uses the Google Photos **Picker API** (user picks items/albums) and also supports **Google Takeout** archives. |
| `connector-facebook-export` | yes | Imports the "Download Your Information" archive (JSON format). Reads captions, albums, timestamps, and GPS where present. |
| `connector-instagram-export` | yes | Imports the Instagram data download archive (JSON format). |

"Enabled" for a connector only means it appears under "Add source". Nothing is synced until the user adds a source.

### 9.3 Default enrichers

| Plugin | Enabled | Input | Notes |
|---|---|---|---|
| `enricher-metadata` | yes | original (header bytes) | EXIF/XMP/IPTC via exifr, video metadata via ffprobe. Produces capture date, GPS, camera, lens, dimensions, orientation. Runs first; most other enrichers depend on it. |
| `enricher-geocode` | yes | metadata | Offline reverse geocoding using a bundled GeoNames cities dataset (cities with population over 1000, around 10MB). No network. Adds place tags and search text. |
| `enricher-dedup` | yes | thumbnail + original (only when needed) | Cross-source duplicate detection. Details in 9.4. |
| `enricher-faces` | **no** (M5) | thumbnail (1024) | Face detection + 512-d embeddings via `onnxruntime-node`. Models are downloaded into `dataDir` when the user turns it on (license shown). `finalize()` clusters embeddings into people (DBSCAN/HDBSCAN on sqlite-vec). Everything runs locally. |

### 9.4 `enricher-dedup` (duplicate detection across sources)

Goal: the same photo on Dropbox, on local disk and in a Facebook export shows up as **one asset with several locations**, and look-alike copies (resized, re-compressed) are offered to the user to merge.

Manifest essentials:

```jsonc
{
  "id": "com.photobeaver.enricher-dedup",
  "type": "enricher",
  "default": { "enabledOnInstall": true },
  "permissions": { "originals": "read", "assets": "merge", "network": [] },
  "enricher": {
    "accepts": ["image/*", "video/*"],
    "input": "thumbnail",
    "dependsOn": ["com.photobeaver.enricher-metadata"],
    "produces": ["identity", "duplicates"],
    "resourceClass": "light",
    "runOn": ["new", "changed"]
  },
  "configSchema": {
    "properties": {
      "exactMerge": { "enum": ["auto", "ask"], "default": "auto",
                      "title": "When files are byte-identical" },
      "nearDuplicates": { "type": "boolean", "default": true,
                          "title": "Suggest look-alike copies (resized, re-compressed)" },
      "nearThreshold": { "type": "integer", "default": 6, "minimum": 0, "maximum": 16,
                         "title": "Look-alike sensitivity (Hamming distance)" },
      "downloadToCompare": { "type": "boolean", "default": true,
                             "title": "Download cloud originals when needed to confirm a match" }
    }
  }
}
```

How it works, per asset:

1. **Cheap keys first.** Publish `size:<bytes>` for each instance, plus any source hash as `src:<algo>:<value>` (e.g. `src:dropbox:...`). If another asset already has the same `src:` key, that's an exact match: go to step 4.
2. **Hash only when there's a candidate.** Look up `size:<bytes>`. If no other asset has the same size, there can't be a byte-identical copy, so skip hashing (no download). If there is one, get the original with `ctx.getInput()` and publish `sha256:<hex>`. Videos over 200MB use a sampled hash (size + first/middle/last 1MB) published as `vsample:<hex>`, which only produces a suggestion, never an auto-merge.
3. **Cross-algorithm hashes.** When the original is local, also compute the Dropbox content hash and OneDrive quickXorHash (both are cheap and documented) and publish them as `src:` keys. This lets a local file match a Dropbox file without downloading from Dropbox.
4. **Exact match:** return `mergeWith: [otherAssetId]` (or a `suggestDuplicates` entry of kind `exact` if `exactMerge` is `ask`). Skip pairs where `ctx.assets.isMergeBlocked()` is true.
5. **Near duplicates** (if enabled): compute a 64-bit pHash and dHash from the thumbnail, publish `phash:<hex>`. In `finalize()`, scan `phash:` keys with a BK-tree kept in `dataDir`, and for pairs within `nearThreshold` return `suggestDuplicates` of kind `near`. Near duplicates are **never merged automatically**.
6. **Burst protection:** pairs whose EXIF capture times differ by under 2 seconds but whose hashes differ are treated as burst shots, not duplicates, unless the pHash distance is 0.

Not done by this plugin: deleting files from sources. Merging only changes how the library is shown. The originals stay where they are.

### 9.5 Platform risk (important)

Social and cloud photo APIs have become more restrictive. The implementer should verify current API terms before building each connector. As of the writing of this spec:

- **Instagram:** the Instagram Basic Display API (personal accounts) was shut down in December 2024. The remaining Instagram APIs target business/creator accounts. That's why v1 uses the **data export archive**.
- **Facebook:** reading a user's photos via the Graph API requires the `user_photos` permission, which needs Meta app review. v1 uses the **data export archive**. A live Graph connector can be added later as a separate plugin if app review is approved.
- **Google Photos:** since March 2025 the Library API only returns media the app itself created. Reading a user's full library requires the **Picker API** (user-driven selection) or **Takeout** import.

Architecturally this is fine: an export-archive connector is just a connector whose `setupSource` asks for an archive file or folder and whose `sync` reads it. Being plugins, these can be swapped for live-API connectors later without core changes.

OAuth client IDs for default connectors are configured at build time via environment variables (`PB_DROPBOX_CLIENT_ID`, etc.). Third-party plugins bring their own.

---

## 10. Cross-cutting requirements

- **Performance targets:** cold start to interactive grid under 2s with 100k assets. Grid scroll at 60fps. Initial local scan of 50k photos: index visible in under 1 minute, thumbnails done in under 15 minutes on a mid-range laptop.
- **Logging:** pino, rotating files in `<userData>/logs/` (core.log, plugin-<id>.log). "Export diagnostics" button bundles logs + anonymized stats (no media, no tokens).
- **Privacy:** no telemetry by default. Opt-in anonymous crash reporting only. All processing is local. Plugins that send data off-device must declare network hosts, which are shown on install.
- **Security:** Electron hardening (contextIsolation, sandboxed renderer, strict CSP, no remote content in the renderer, `pb-media://` protocol validates asset ids). Tokens only in safeStorage.
- **Backup:** Settings > Backup creates a consistent copy with SQLite's online backup API. Thumbnails can be regenerated so they're excluded by default.
- **i18n:** all UI strings through i18next from day one (English only in v1).
- **Accessibility:** keyboard navigation in grid and viewer, ARIA labels, respects reduced motion.
- **Auto-update:** electron-updater with GitHub Releases.
- **Code signing:** macOS notarization and Windows signing hooks in the build config (credentials from CI secrets).

---

## 11. Testing

- **Unit (Vitest):** scheduler timing and backoff, job queue leasing/recovery, the merge/unmerge primitive and identity key index, manifest validation, enrichment plan ordering (including cycle detection), core-field precedence.
- **Plugin contract tests:** a shared suite in `@photobeaver/plugin-sdk/testing` that any connector can run (cursor resume, batch shape, delete handling, idempotency). All default plugins must pass it. `enricher-dedup` has its own fixture suite (same file in two sources, resized copy, re-encoded copy, burst shots that must NOT merge, undo then re-run).
- **Integration:** run core headless (no window) with the local connector against a fixture folder of ~500 media files (varied formats, EXIF, GPS, duplicates, videos). Assert final DB state.
- **Crash tests:** kill the main process and plugin hosts at random points during sync and enrichment, restart, and assert the final state matches an uninterrupted run.
- **E2E (Playwright + Electron):** first run, add local source, see grid, open viewer, search by place, install a plugin from file, disable a plugin.
- CI: GitHub Actions matrix on macOS, Windows and Linux.

---

## 12. Milestones (implement in this order)

Each milestone must end with passing tests and a runnable app.

**M0 - Skeleton**
- pnpm/turborepo monorepo, electron-vite app, React shell with routing, preload bridge, lint/test/CI.
- SQLite with Drizzle schema + migrations, WAL settings, backup-before-migrate.
- Permission-check middleware on every IPC handler from day one, with a single implicit Admin session (section 3.3). Users/roles tables in the first migration.
- Acceptance: app launches on all three OSes, DB file is created, empty Library screen renders.

**M1 - Core pipeline with the default local connector (no plugin isolation yet)**
- Job queue, scheduler, sync execution, instance/asset model with the merge primitive, thumbnail service, `pb-media://` protocol.
- Library grid (virtualized, timeline), viewer, sources screen.
- `connector-local` written against SDK types but loaded in-process.
- Acceptance: add a folder of 10k photos, grid fills progressively, restart mid-sync resumes, deleting a file on disk removes it from the grid after the next sync.

**M2 - Plugin system**
- `@photobeaver/plugin-sdk`, manifest validation, plugin host (`utilityProcess`), JSON-RPC transport with streaming and cancellation, host API (`ctx`), permissions enforcement, health/crash handling.
- Move `connector-local` into its own host. Plugins screen (installed list, enable/disable, settings form from `configSchema`, logs).
- Install from file (`.pbplugin`) and dev mode (load unpacked + hot reload).
- `create-photobeaver-plugin` and `pb-plugin` (dev, validate, test, pack) with the test harness.
- Acceptance: a plugin scaffolded with the CLI can be developed with hot reload, packed, and installed from file on a clean machine. Killing a plugin host process doesn't affect the UI, and the job retries.

**M3 - Enrichment**
- Enrichment planner (dependsOn, lanes, batching, finalize), core-field precedence.
- `enricher-metadata`, `enricher-geocode`, `enricher-dedup`, plus the `assets: "merge"` host API.
- Search (FTS) and filters, Map screen, Duplicates screen.
- Acceptance: photos show correct capture dates and places, searching "Paris" finds geotagged Paris photos, the same photo copied into two local folders shows as one asset, resized copies appear in Duplicates, and undoing a merge works.

**M4 - Cloud and export connectors**
- OAuth broker, secrets service, `ctx.fetch` rate limiting.
- `connector-dropbox`, `connector-onedrive`, `connector-google-photos` (Picker + Takeout), `connector-facebook-export`, `connector-instagram-export`.
- Cross-source dedup verified (same file on local + Dropbox = one asset, two instances, using Dropbox's content hash where possible).
- Acceptance: each connector passes the SDK contract suite plus a manual test against a real account/archive.

**M5 - Faces and people**
- sqlite-vec integration, `enricher-faces`, People screen (name, merge, split).

**M5.5 - Users and roles**
- Multiple-users toggle, local accounts, sign-in/user picker, auto-lock, recovery key, biometrics on macOS.
- Viewer/Editor/Admin enforcement on all IPC handlers and `pb-media://`, scopes applied in all library queries, audit log, Users screen.
- Acceptance: a Viewer scoped to one album can't see, search, or load (by guessing an asset id) anything outside it; an Editor can tag and merge but can't add sources or plugins; the last Admin can't be removed; sync keeps running while the app is locked.

**M6 - Plugin registry and polish**
- Registry index format, signature verification, in-app Store, update flow with permission diff, publish via `pb-plugin publish`.
- Battery/idle awareness, tray mode, auto-update, code signing, diagnostics export, docs site (`docs/plugin-guide.md` + generated API reference).

---

## 13. Decisions and future work

Record new decisions in `docs/DECISIONS.md` as they come up.

| # | Question | Decision |
|---|---|---|
| 1 | Can the library (DB + thumbnails) live on an external drive? | **Yes, v1.** See section 4.1.1, including the startup check. |
| 2 | "Archive originals locally" mode per source (true backup)? | **Not in v1. Planned for a future version.** Don't build it, but don't block it: keep the original cache (`cache/originals/`) behind a service interface so a later "archive" store can sit beside it, and keep `instances` able to point at a local archived copy. |
| 3a | User identity and roles in the app | **Yes, v1:** local users with Viewer / Editor / Admin roles and optional per-user scopes. See section 3.3. |
| 3b | Plugin registry hosting and signing | **Proposed, confirm before M6:** see 13.1. |
| 4 | A third plugin type (actions / exporters)? | **Not now.** The manifest `type` field stays an enum validated by zod, so adding a type later is a schema change plus a new host interface, not a redesign. Don't build anything for it in v1. |

### 13.1 Plugin registry: publishers and signing (proposal, M6)

- **Publisher accounts:** developers sign in to the registry (OAuth with GitHub to start; email/password not needed for v1) to publish plugins. Each plugin id belongs to one publisher account. A publisher can add other maintainers to a plugin, with two roles: **owner** (manage maintainers, transfer, unpublish) and **maintainer** (publish new versions).
- **Namespaces:** the reverse-DNS prefix of a plugin id is tied to its publisher (`com.photobeaver.*` is reserved for the core team). A publisher can claim a domain prefix by proving control of the domain (DNS TXT record).
- **Publish flow:** `pb-plugin publish` authenticates the developer, uploads the `.pbplugin`, the registry runs automated checks (manifest validation, permission diff vs the previous version, malware scan), and new plugins or new permissions go to manual review by maintainers.
- **Signing:** the **registry** signs each approved version (Ed25519) with a registry signing key. The app ships with the registry's public keys and verifies signatures on install and update. Signing keys live in a KMS/HSM, never on developer machines. Key rotation: the app trusts a small list of public keys; new keys are added in an app release before old ones are retired, and revoked keys are published in a signed revocation list the app checks daily.
- **App users don't need a registry account.** Browsing and installing plugins from the store is anonymous. (Who may install plugins inside a library is controlled by the Admin role, section 3.3.)
- Hosting: registry API + storage on a managed cloud service (implementation detail for M6; keep the in-app client talking to a documented HTTPS API so the backend can change).
