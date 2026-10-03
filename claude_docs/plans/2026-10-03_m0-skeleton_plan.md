# M0 Skeleton - Implementation Plan

## Context

The repo currently holds only `CLAUDE.md` and `Docs/SPEC.md` (not a git repo). SPEC section 12 says M0 must deliver: a pnpm/turborepo monorepo with an electron-vite app, React shell with routing, preload bridge, lint/test/CI; SQLite via Drizzle with migrations, WAL settings and backup-before-migrate; a permission-check middleware on every IPC handler with a single implicit Admin session, and users/roles tables in the first migration.

**Acceptance:** app launches on macOS/Windows/Linux, DB file is created, empty Library screen renders.

Environment found: Node 25.9, npm 11, git, Xcode CLT. **pnpm is not installed.** Latest compatible stack: Electron 44, electron-vite 5 (needs Vite 7, so `@vitejs/plugin-react` 5.x), better-sqlite3 12, drizzle-orm 0.45 / drizzle-kit 0.31, Tailwind 4, React 18 (spec pins 18, not 19).

## Setup steps

1. Rename `Docs/` to `docs/` (CLAUDE.md and spec reference lowercase; matters on Linux CI).
2. `git init` + `.gitignore` (no commit unless you ask).
3. Install pnpm globally (`npm i -g pnpm`), pin it via `packageManager` in root `package.json`.

## Repo layout created in M0

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json
eslint.config.js (flat, typescript-eslint, react-hooks), .prettierrc, .editorconfig, .nvmrc
.github/workflows/ci.yml
apps/desktop/
  electron.vite.config.ts, electron-builder.yml, playwright.config.ts
  src/main/       index.ts, window.ts, paths.ts, logger.ts (pino),
                  db/ (open + pragmas + migrate + backup), session/ (implicit admin),
                  ipc/ (registry + permission middleware + handlers/)
  src/preload/    index.ts (contextBridge -> window.pb)
  src/renderer/   index.html (strict CSP), main.tsx, App.tsx (HashRouter),
                  layout/Shell.tsx (sidebar), routes/ (Library, Sources, Plugins, Activity, Settings),
                  i18n/ (i18next, en.json), lib/pb.ts (TanStack Query hooks)
  tests/e2e/      launch.spec.ts
packages/shared/  permissions.ts, roles.ts, ipc-contract.ts (channel -> {requires, input zod, output zod}), types
packages/db/      schema/*.ts (Drizzle), migrations/ (drizzle-kit output + custom FTS SQL), drizzle.config.ts
docs/DECISIONS.md
claude_docs/plans/2026-10-03_m0-skeleton_plan.md (copy of this plan)
```
`plugin-sdk`, `plugin-cli` and `plugins/` are not created until M2.

## Key design

**Database (`packages/db` + `apps/desktop/src/main/db`)**
- Drizzle schema for all section 4.2 tables: plugins, sources, assets, instances (+ `seen_run_id` from 7.4), enrichments, asset_identity, duplicate_suggestions, asset_merges, tags, asset_tags, people, faces, albums, album_assets, users, user_scopes, audit_log, jobs, settings, plugin_kv, with the listed indexes/uniques/FKs.
- `assets_fts` (FTS5) added as a custom SQL migration (drizzle can't model virtual tables).
- `faces_vec` (sqlite-vec) deferred to M5 where sqlite-vec is introduced. Recorded in DECISIONS.
- `openDatabase(path)`: creates `<userData>/library/`, applies pragmas (WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000, temp_store=MEMORY, mmap_size=256MB).
- `runMigrations(db, path)`: reads drizzle journal vs `__drizzle_migrations`; if the DB already had applied migrations and new ones are pending, `db.backup()` to `photobeaver.db.bak-<lastAppliedTag>` first, then drizzle `migrate()`. Migrations folder shipped via electron-builder `extraResources`.

**Permissions and IPC**
- `packages/shared`: `PERMISSIONS` (the 11 named strings), `ROLE_PERMISSIONS` map for viewer/editor/admin (roles as data, so custom roles later need no schema change).
- `ipc-contract.ts`: each channel declares `requires` permission + zod input/output schemas. Shared types derive from it so preload and renderer are typed from one source.
- Main `handle(channel, fn)` registry: wraps `ipcMain.handle`, validates input with zod, checks `session.current()` has the channel's permission, else throws a typed `PermissionDenied`. Registration fails fast if a channel lacks a contract entry, so no handler can skip the check.
- `SessionService`: on startup ensures exactly one Admin user row exists (first run creates it, no password) and sets it as the implicit session.
- M0 channels: `app.info` (version, paths), `session.current`, `library.query` (keyset cursor shape `{capturedAt, id}`, returns an empty page now) so the Library screen exercises the full renderer -> preload -> middleware -> DB path.

**Electron hardening**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP meta, block navigation/new windows. Preload is a thin `invoke(channel, input)` wrapper exposed as `window.pb.app/session/library`.

**Renderer**: React 18, HashRouter, TanStack Query, Tailwind 4 (`@tailwindcss/vite`), i18next (all strings via `t()`, English only). Sidebar shell with placeholder routes; Library screen renders "No photos yet" empty state from `library.query`. Zustand/Radix/TanStack Virtual added when first needed (M1). No em dashes in UI text.

**Native module ABI**: better-sqlite3 must be built for Electron. `postinstall` runs `electron-builder install-app-deps`. Vitest suites touching SQLite run under Electron's Node (`ELECTRON_RUN_AS_NODE=1 electron vitest`) so one binary serves both app and tests. Recorded in DECISIONS.

**Test-friendly paths**: `PB_USER_DATA_DIR` env var overrides `app.setPath('userData')` so tests use a temp dir.

## Tests

- Vitest unit: role/permission map; IPC middleware (allow, deny, invalid input rejected, unknown channel rejected at registration); `openDatabase` sets pragmas and creates all tables incl. users/user_scopes and FTS; backup-before-migrate creates `.bak-*` only when pending migrations exist on an existing DB; session bootstrap creates one Admin and is idempotent.
- Playwright e2e (`_electron.launch` on the built app, temp userData): window opens, `photobeaver.db` exists, Library empty state visible.

## CI (`.github/workflows/ci.yml`)

Matrix `macos-latest`, `windows-latest`, `ubuntu-latest`: pnpm install, lint, typecheck, unit tests, build, Playwright e2e (`xvfb-run` on Linux). Turborepo pipeline: `build`, `lint`, `typecheck`, `test`, `e2e`. electron-builder config (dmg/nsis/AppImage, asarUnpack better-sqlite3) included but packaging not run in CI yet.

## Docs

- `docs/DECISIONS.md`: pnpm global install, faces_vec deferred to M5, FTS via custom migration, backup naming uses migration tag, Electron-as-Node for tests, `PB_USER_DATA_DIR`, HashRouter, React 18 per spec despite 19 existing, minimal M0 IPC channels, pino without rotation until M6 diagnostics.
- Session summary in `claude_docs/session_summaries/2026-10-03_session-summary.md`.

## Verification

1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test` all green.
2. `pnpm --filter desktop build && pnpm --filter desktop e2e` green locally on macOS.
3. `pnpm dev`: window shows sidebar + Library empty state; check `~/Library/Application Support/Photo Beaver/library/photobeaver.db` exists and `PRAGMA journal_mode` = wal; `users` has one admin row.
4. Windows/Linux launch is verified by the CI matrix once pushed to GitHub (I can't run those locally).

## Risks

- Electron 44 + better-sqlite3 12 prebuilt availability: fallback is source build (Xcode CLT present). If incompatible, pin Electron to the newest version better-sqlite3 supports.
- Node 25 locally vs CI: CI uses Node 22 LTS (`.nvmrc`); app runtime is Electron's Node either way.
