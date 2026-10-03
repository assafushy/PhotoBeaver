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

## Layout

- `apps/desktop`: Electron app (`src/main` core, `src/preload` bridge, `src/renderer` React UI)
- `packages/shared`: permissions, roles, IPC contract
- `packages/db`: Drizzle schema, migrations, database open/migrate/backup
- `docs/DECISIONS.md`: implementation decisions not covered by the spec
