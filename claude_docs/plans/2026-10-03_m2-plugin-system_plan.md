# M2 Plugin System - Implementation Plan

## Context

M1 is merged (`7423f00`, CI green on macOS, Windows and Ubuntu). Today `connector-local` runs in-process: `ConnectorRegistry` (`apps/desktop/src/main/core/connectors/registry.ts`) calls the plugin directly and builds its `ctx`.

SPEC 12 says M2 delivers:
- the SDK, manifest validation and a plugin host per plugin (`utilityProcess`)
- JSON-RPC over a MessagePort with streaming and cancellation, and the host API (`ctx`)
- permission enforcement, plus health and crash handling
- `connector-local` moved into its own host
- a Plugins screen
- install from a `.pbplugin` file, and dev mode (load unpacked plus hot reload)
- `create-photobeaver-plugin` and `pb-plugin` (`dev`, `validate`, `test`, `pack`) with a test harness

**Acceptance:**
- A plugin scaffolded with the CLI can be developed with hot reload, packed, and installed from a file on a clean machine.
- Killing a plugin host process doesn't affect the UI, and the job retries.

Relevant spec sections: 3.1, 5 (packaging, manifest, channels, tooling), 6.4 to 6.6, 7.6, 8.1 (Plugins screen), 9.1 (default plugins), 11.

Also included: `watch()` for `connector-local`, deferred from M1 (D24), because it depends on host lifecycle.

## Decisions that need your OK

1. **`pb-plugin` builds plugins with esbuild** (`pb-plugin build`). The scaffold doesn't use tsup as the spec says. One bundled tool means a scaffolded project needs only the SDK and CLI, and builds are identical in dev, `pack` and CI. Output is a single ESM file, `dist/index.js`.
2. **Plugin Inspector is deferred to M6.** That's the live RPC trace, job history and per-host CPU/memory (SPEC 5.5). M2's Plugins screen shows health, a host restart count and per-plugin logs. Not in the M2 bullet list.
3. **Uninstalling a connector that still has sources, while keeping its data,** keeps the `plugins` row with `install_path = NULL`, shown as "Uninstalled, data kept" with a Reinstall button. `sources.plugin_id` has a foreign key to `plugins`, so the row can't be deleted while sources exist. "Remove data" deletes the sources first, through `SourceService.remove`.
4. **Watch batches don't move the sync cursor.** Batches from `watch()` are written with the normal batch writer but leave `sync_cursor` alone, so they never interrupt a resumable full scan. Local sources default to mode `watch` with a 24h safety full scan (SPEC 9.2).
5. **The SDK isn't published to npm in M2.** It becomes buildable (types plus `dist`) and the scaffolder can point at it with `--sdk <path|version>`. Publishing comes with the registry in M6.

## Architecture

```
Core (main)                                   Plugin host (utilityProcess, one per plugin)
PluginManager --start/stop/crash-restart-->   plugin-host/index.ts (Electron glue: parentPort)
  PluginHostHandle --RpcPeer over MessagePort--> host runtime (no Electron):
  RemoteConnector (implements ConnectorPlugin)     loads plugin main, RpcPeer, builds ctx proxies,
  CallContexts (contextId -> isKnown, progress,    permission patches (net, fs), ctx.fetch
                pickDirectory, onChange, ...)
```

**Keep core services unchanged.** `RemoteConnector` implements the SDK's `ConnectorPlugin` interface by RPC. `SyncRunner`, `OriginalSource`, `ThumbnailService` and `SourceService` keep calling `entry.plugin.sync(ctx, cursor)` and friends. The ctx they pass is registered as a call context, so host-side `ctx.isKnown` and the other proxies route back to the right hooks. In-process entries stay available for unit tests.

### `packages/shared`
- **`rpc/peer.ts`, `RpcPeer`:** JSON-RPC 2.0 over a minimal `RpcPort` interface (`postMessage`, `onMessage`, `close`).
  - Requests, responses and notifications.
  - Per-call timeouts, plus inactivity timeouts for streams (sync: 10 minutes between batches).
  - `$/cancel` from an AbortSignal.
  - Streams: async iterables go out as `stream/next` with credit-1 acks for backpressure. Byte streams go as chunks of up to 1 MB. MessagePortMain only transfers ports, so `ArrayBuffer`s are copied.
- **`rpc/contract.ts`:** method names and zod schemas for both directions.
  - Core to host: `plugin.activate`, `plugin.deactivate`, `connector.setupSource`, `connector.testSource`, `connector.sync` (stream), `connector.getOriginal` and `connector.getThumbnail` (byte stream), `connector.watch`, `connector.unwatch`.
  - Host to core: `ctx.log`, `ctx.storage.get/set/delete`, `ctx.settings`, `ctx.secret.*` (not available until M4), `ctx.ui.pickDirectory`, `ctx.ui.notify`, `ctx.sync.isKnown`, `ctx.sync.progress`, plus a `watch.change` notification.
  - Core validates every incoming payload; invalid data gets an error and is dropped (SPEC 6.5).
- **`manifest.ts`:** zod schema for `photobeaver-plugin.json` (SPEC 5.2 plus the `default` field). Supported `apiVersion` is `['1']`; anything else is "Incompatible" (SPEC 5.3). Includes a JSON-Schema-subset type for `configSchema`.

### Plugin host (`apps/desktop/src/plugin-host/`, a second main-build entry)
- **`index.ts`:** receives the port from `process.parentPort`, then starts the runtime.
- **`runtime.ts`:** dynamic-imports the plugin `main`, wraps its methods as RPC handlers, builds `ctx` from proxies, and manages `watch()` subscriptions.
- **`permissions/network.ts`:**
  - Host allowlist matching (exact host and `*.domain`).
  - Patches global `fetch`, `http`/`https` `request`/`get`, and `net.connect`/`tls.connect` to refuse other hosts.
  - `ctx.fetch` adds a token-bucket rate limit from `manifest.connector.rateLimit` and retries 429s using `Retry-After`.
- **`permissions/filesystem.ts`:** patches `fs` and `fs/promises` path functions, then calls `syncBuiltinESMExports()`.
  - Plugins with `filesystem: "none"` may only touch `dataDir` and temp input files.
  - `user-selected` plugins may also touch granted folders (config fields with `format: "directory"`, and `pickDirectory` results).
  - Documented as defense in depth, not a sandbox (SPEC 6.6).
- **Process limits:** `--max-old-space-size` of 1024 MB, or 4096 MB for `gpu`/`cpu-heavy` plugins. A minimal environment (no inherited secrets). stdout and stderr go to `logs/plugin-<id>.log`.

### Core (`apps/desktop/src/main/core/plugins/`)
- **`plugin-store.ts`:** install folders `<userData>/plugins/<id>/<version>/` and `plugin-data/<id>/`.
  - Install flow (SPEC 5.4): unzip `.pbplugin` (fflate) into a temp folder, sha256, validate the manifest, move into place, keep the previous version until the new one loads (rollback on failure).
- **`plugin-manager.ts`:**
  - Install, load, enable, disable, uninstall; installs bundled defaults on first run and upgrades them when the app ships newer versions.
  - "Restore default plugins" button.
  - Builds `ConnectorEntry`s for the registry.
  - Audit-log entries for install, uninstall, enable and disable.
- **`plugin-host-handle.ts`:**
  - Starts hosts lazily and stops them after 10 minutes idle, unless a watch is active (SPEC 7.6).
  - On an unexpected exit, in-flight calls reject with `HostCrashedError`, and the host restarts with backoff (1s, 5s, 30s, 2m).
  - 5 crashes in 10 minutes sets `health='crashed'` and emits `plugins.changed`.
  - A call that times out kills the host and counts as a crash.
- **Job retry on crash:** `SyncRunner` rethrows `HostCrashedError`, so the lane fails the job: it goes back to the queue and counts as an attempt (SPEC 7.6). `queue.fail` gets an optional delay, and crash retries use the restart backoff, not 30s.
- **`watch-manager.ts`:**
  - Subscribes watch-mode sources that aren't paused when their host starts.
  - Resubscribes after a restart, and unsubscribes on pause or remove.
  - Writes watch batches without moving the cursor (decision 4).
  - The scheduler's due-source query also includes `watch` mode for the safety poll.
- **`dev-mode.ts`:**
  - Developer mode setting in `settings` (`developerMode`).
  - "Load unpacked" registers `install_source='dev'` with `install_path` pointing at the folder.
  - chokidar watches `dist/` and reloads the host on change.
  - A local dev socket (`<userData>/dev.sock`, a named pipe on Windows) accepts `{"cmd":"load"|"reload","path"}` lines, only while developer mode is on. This is what `pb-plugin dev` talks to (SPEC 5.5).
- **Migration `0003_m2`:** `plugins.install_path`.

### `connector-local` changes
- `watch()` with chokidar (bundled), emitting upserts and deletes; it pauses while the root folder is missing.
- The manifest gets `syncModes: ["watch","poll","manual"]` and `build`/`pack` scripts via `pb-plugin`.
- The desktop build copies the built plugin (manifest, `dist`, assets) into `out/main/default-plugins/`. On first run it's installed into userData like any other plugin (SPEC 9.1).

### CLI packages
- **`packages/plugin-sdk`:** adds a `./testing` export.
  - `createConnectorHarness(plugin, { config, known })`: in-memory store, fake OAuth, fake UI; runs a full sync or a resume from a cursor.
  - `connectorContract(...)`: checks cursor resume, batch shape (100 to 1000 items, cursor required), delete handling and idempotency (SPEC 11).
  - `connector-local` runs the contract in its tests.
- **`packages/plugin-cli`** (`@photobeaver/plugin-cli`, bin `pb-plugin`, built with esbuild):
  - `build`: bundles the plugin with esbuild.
  - `dev`: watch build, then load/reload through the dev socket.
  - `validate`: manifest plus the default export's shape.
  - `test`: runs `vitest run` in the project.
  - `pack`: writes `<id>-<version>.pbplugin` and a `.sha256` file.
- **`packages/create-photobeaver-plugin`** (`npm create photobeaver-plugin`): connector or enricher templates.
  - Includes the manifest, `src/index.ts`, a sample test using the harness, a README and a tsconfig.
  - The enricher template is types-only until M3, where enrichers start running.

### IPC and UI
New channels, all requiring `plugins.manage`:

| Channel | Purpose |
|---|---|
| `plugins.list` | Manifest, enabled, health, install source, version, restart count, host running |
| `plugins.setEnabled` | Enable or disable |
| `plugins.reEnable` | Clear a crashed state |
| `plugins.uninstall` | Takes `removeData` |
| `plugins.logs` | Tail of the plugin's log |
| `plugins.pickPackage` | File picker |
| `plugins.inspectPackage` | Staged install: returns the manifest, permissions, sha256, unverified warning and upgrade info |
| `plugins.installStaged` | Install after consent |
| `plugins.restoreDefaults` | Reinstall default plugins |
| `plugins.devMode.get` / `.set` | Developer mode |
| `plugins.loadUnpacked` | Load a plugin folder |
| `plugins.reload` | Reload a plugin's host |

New event: `plugins.changed`.

**Plugins screen** with Installed, Store and Developer tabs; Store is a placeholder until M6.
- **Installed:** each card shows enable/disable, version, source, health with "Re-enable", the permissions list, logs and uninstall (asking whether to keep or remove data).
- **Install from file:** a consent dialog listing network hosts, filesystem, originals and native modules, with an "unverified" warning (SPEC 5.4).
- **Developer:** the developer mode toggle, "Load unpacked" and a reload button per dev plugin.
- **Sources screen:** a source whose connector is missing or crashed shows that state.

## Tests

- **Unit:**
  - RpcPeer over paired in-memory ports: request, error, timeout, cancel, stream backpressure, byte streams, closed port.
  - Manifest schema (valid and invalid fields, `apiVersion`, defaults).
  - Network allowlist matching and patching; filesystem guard path checks.
  - Crash backoff and the "5 in 10 minutes" policy (injected clock).
  - Plugin store install, rollback and sha256; `.pbplugin` pack and unpack round trip.
  - Watch-manager subscribe and resubscribe; the dev socket protocol parser.
- **Integration (no Electron):** run the host runtime in a `worker_threads` Worker over a MessageChannel with the built `connector-local`:
  - full sync, resume, `getOriginal` bytes and watch events through RPC
  - an injected crash makes in-flight calls reject with `HostCrashedError`
- **SDK contract suite** passes for `connector-local`.
- **E2E (Playwright):**
  - First run installs the default plugin and the Plugins screen lists it.
  - Kill the `connector-local` host process mid-sync (pid from `plugins.list`). The UI stays responsive, the host restarts, the job retries and the sync completes with no duplicates.
  - Disable then enable the plugin.
  - Scaffold a connector with `create-photobeaver-plugin` into a temp folder (SDK linked to the repo), `pb-plugin build`, then load it unpacked in developer mode. Change its source, rebuild through `pb-plugin dev` and the dev socket, and check the reloaded behavior. Then `pb-plugin pack` and install the `.pbplugin` from file into a fresh userData folder, accepting the consent dialog. This covers "on a clean machine".
- **Packaged smoke test** (macOS locally, all three OSes in CI): the default plugin installs and syncs inside a utilityProcess from the packaged app.

## Docs
- `docs/plugin-guide.md`: scaffold, dev loop, manifest, permissions, test harness, pack and install; the honest threat model (SPEC 6.6).
- DECISIONS.md: the five decisions above, plus RPC details (credit-1 backpressure, copied buffers), crash retry delay, dev socket and its security, `install_path`, default-plugin upgrade rule, and the M2 ctx coverage (secret and oauth still M4).
- Plan copy in `claude_docs/plans/2026-10-03_m2-plugin-system_plan.md` and a session summary.

## Delivery
- Branch `m2-plugin-system`.
- Build in this order: RPC, then host, then manager, then UI, then CLI. Keep commits small.
- Open a PR with auto-fix on and merge when green, as for M1.
- I'll hand the CLI and scaffolder (once the RPC and manifest contracts exist) to a subagent to run in parallel, then verify its work myself.

## Verification
1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` pass locally, and `node /tmp/fnlen.cjs` reports nothing over 20 lines.
2. Manual run:
   - `pnpm dev`: the library still syncs through the host.
   - `kill <host pid>` mid-sync, and the grid keeps working.
   - Scaffold, `pb-plugin dev` with hot reload, pack and install from file in a fresh profile.
3. PR CI green on all three OSes.

## Risks
- **utilityProcess on Windows/Linux CI:** process-tree kills and file locks, as in M1. E2E kills use `killApp`-style tree kills.
- **Patching `fs` in ESM plugins** depends on `syncBuiltinESMExports()`. Unit tests cover both `import` and `require` paths.
- **Scope is large.** If the PR gets too big to review, I can split it into "host and RPC" and "CLI, dev mode and UI".
