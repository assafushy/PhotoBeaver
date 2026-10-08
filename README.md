# Photo Beaver

Cross-platform desktop app that indexes photos and videos from every source into one library. See [docs/SPEC.md](docs/SPEC.md).

## Requirements

- Node 22 or newer
- pnpm (`npm i -g pnpm`)

## Commands

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm lint
pnpm typecheck
pnpm test         # unit tests (Vitest)
pnpm build
pnpm e2e          # Playwright against the built app
```

Package an unpacked app for the current OS: `pnpm --filter @photobeaver/desktop exec electron-builder --dir`.

Generate a folder of test photos (solid-color JPEGs with dated names, plus optional short videos):

```bash
pnpm --filter @photobeaver/desktop fixtures /tmp/photos --count 10000 --videos 5
```

Developer-only environment variables (ignored in packaged builds):

- `PB_USER_DATA_DIR`: use another userData folder, for example a throwaway library.
- `PB_SYNC_BATCH_DELAY_MS`: pause between sync batches, to watch the grid fill or test crash recovery.

Also available in any build: `PB_DEV_SOCKET` sets the developer socket path that `pb-plugin dev` and the app use.

## Users and roles

Photo Beaver starts in single-user mode: one Admin, no password. In **Settings**, an Admin can turn on **Multiple users**:

1. Set a password for the Admin account.
2. Save the recovery key that is shown once. It resets the Admin password if it is forgotten.
3. Add people in **Settings > Users** as Viewer, Editor or Admin, each with a password or a 4 to 8 digit PIN. A Viewer or Editor can be limited to chosen sources and albums.

With multiple users on, the app opens on a user picker and locks itself after the idle time set in Settings (and when the computer's screen locks). Sync and enrichment keep running while it is locked. On a Mac, an account can also sign in with Touch ID.

What roles protect: roles control what people can do through the app. They do not protect the library files from someone with direct access to the disk or the operating system account; encrypting the library at rest is future work. Sign-in tokens for cloud sources stay in the operating system keychain of the account that added them.

## Layout

- `apps/desktop`: Electron app (`src/main` Electron glue, `src/main/core` headless core services, `src/preload` bridge, `src/renderer` React UI)
- `packages/shared`: permissions, roles, IPC contract
- `packages/db`: Drizzle schema, migrations, database open/migrate/backup
- `packages/plugin-sdk`: `@photobeaver/plugin-sdk`, the types and helpers plugins build against
- `packages/plugin-cli`: `pb-plugin` (build, dev, validate, test, pack)
- `packages/create-photobeaver-plugin`: `npm create photobeaver-plugin` project scaffolder
- `apps/desktop/src/plugin-host`: the process each plugin runs in
- `plugins/connector-local`: the default local folder connector (imports only from the SDK)
- `plugins/connector-dropbox`, `plugins/connector-onedrive`, `plugins/connector-google-photos`: cloud connectors (sign in once per source; register your own app as each README explains)
- `plugins/connector-facebook-export`, `plugins/connector-instagram-export`: import Meta data downloads, read in place from a folder or the downloaded .zip files
- `plugins/enricher-metadata`, `plugins/enricher-geocode`, `plugins/enricher-dedup`: the default enrichers (capture date, camera and GPS; offline place names; duplicate detection and merging)
- `docs/plugin-guide.md`: how to write, test, pack and install a plugin
- `plugins/enricher-faces`: face detection and recognition (off by default; downloads InsightFace models, which are for non-commercial research only and are not part of this MIT repository)
- `docs/DECISIONS.md`: implementation decisions not covered by the spec
- `docs/manual-tests/m4.md`: manual checks against real accounts and exports
