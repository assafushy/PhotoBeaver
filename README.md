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

## Layout

- `apps/desktop`: Electron app (`src/main` Electron glue, `src/main/core` headless core services, `src/preload` bridge, `src/renderer` React UI)
- `packages/shared`: permissions, roles, IPC contract
- `packages/db`: Drizzle schema, migrations, database open/migrate/backup
- `packages/plugin-sdk`: `@photobeaver/plugin-sdk`, the types and helpers plugins build against
- `packages/plugin-cli`: `pb-plugin` (build, dev, validate, test, pack)
- `packages/create-photobeaver-plugin`: `npm create photobeaver-plugin` project scaffolder
- `apps/desktop/src/plugin-host`: the process each plugin runs in
- `plugins/connector-local`: the default local folder connector (imports only from the SDK)
- `plugins/enricher-metadata`, `plugins/enricher-geocode`, `plugins/enricher-dedup`: the default enrichers (capture date, camera and GPS; offline place names; duplicate detection and merging)
- `docs/plugin-guide.md`: how to write, test, pack and install a plugin
- `docs/DECISIONS.md`: implementation decisions not covered by the spec
