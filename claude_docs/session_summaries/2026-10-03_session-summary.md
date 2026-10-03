# Session summary: M0 Skeleton (2026-10-03)

## What was built

- pnpm 12 + turborepo monorepo: `apps/desktop`, `packages/shared`, `packages/db`.
- Electron 44 app via electron-vite 5: hardened window (contextIsolation, sandbox, no nodeIntegration, CSP, navigation lock), typed preload bridge `window.pb`, React 18 shell with HashRouter, sidebar, Library empty state, placeholder screens, i18next, Tailwind 4.
- SQLite via better-sqlite3 + Drizzle: full SPEC 4.2 schema (except `faces_vec`, M5), FTS5 table, WAL and other pragmas, backup-before-migrate.
- Permission middleware: every IPC channel is declared in a shared contract with its permission and zod schemas; implicit Admin session on first run.
- Tests: 24 Vitest unit tests (roles, contract, DB open/pragmas/tables/FTS, backup, registry allow/deny/invalid/internal, session bootstrap, keyset paging) and 3 Playwright Electron e2e tests (launch + DB file + empty Library, bridge isolation, navigation).
- CI: GitHub Actions matrix on macOS, Windows, Ubuntu (lint, typecheck, unit, build, e2e).
- electron-builder config (dmg / nsis / AppImage); unpacked macOS build verified.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` all pass on macOS (e2e stable over 3 repeats).
- `pnpm dev` checked over CDP: Library empty state renders, no console or CSP errors.
- Packaged app run: DB in WAL mode, one Admin row, both migrations applied.
- Windows and Linux are covered by the CI matrix only; not run locally.

## AI Rationale

- **Shared IPC contract over per-handler permission arguments.** The spec sketches `handle('x', { requires }, fn)`. Putting `requires` in a shared contract keeps the same guarantee, lets the renderer read the permission to hide controls, and makes "a handler without a permission" impossible to write. `assertComplete()` catches the opposite (a declared channel with no handler).
- **DB code in `packages/db`.** Considered keeping it in the main process. A package that only takes paths can be reused by the headless integration and crash tests in SPEC 11.
- **No electron-rebuild.** Planned to run Vitest under Electron's Node to avoid ABI mismatch, but better-sqlite3 13 ships N-API prebuilds that load in both runtimes, so the simpler setup was kept.
- **Migrations copied into `out/main`.** Resolving `packages/db/migrations` from `app.getAppPath()` broke when Electron was launched with a file path (Playwright). Copying at build time gives one lookup rule for dev, tests and packaged builds.
- **Initial route in the URL.** An intermittent e2e failure traced to the HashRouter redirect changing the URL during the first load, which made `loadFile` reject. Loading at `#/library` fixes the root cause; load failures are also no longer fatal.
- **Version pins.** TypeScript 6.0 (typescript-eslint lacks TS 7 support) and Vite 7 (electron-vite 5 lacks Vite 8 support).

All decisions are listed in `docs/DECISIONS.md`.

## Next

M1: job queue, scheduler, sync execution, merge primitive, thumbnails, `pb-media://`, virtualized grid, viewer, sources screen, in-process `connector-local`.
