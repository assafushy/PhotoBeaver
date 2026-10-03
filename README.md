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

## Layout

- `apps/desktop`: Electron app (`src/main` Electron glue, `src/main/core` headless core services, `src/preload` bridge, `src/renderer` React UI)
- `packages/shared`: permissions, roles, IPC contract
- `packages/db`: Drizzle schema, migrations, database open/migrate/backup
- `packages/plugin-sdk`: `@photobeaver/plugin-sdk`, the types and helpers plugins build against
- `plugins/connector-local`: the default local folder connector (imports only from the SDK)
- `docs/DECISIONS.md`: implementation decisions not covered by the spec
