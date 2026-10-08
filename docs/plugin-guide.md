# Writing a Photo Beaver plugin

Photo Beaver gets everything that touches a media source (connectors) or adds meaning to media (enrichers) from plugins. This guide covers connectors; enrichers run from milestone M3. The full contract is in [SPEC.md](SPEC.md) sections 5 and 6.

## Create a project

```bash
npm create photobeaver-plugin@latest my-connector -- --type connector --id com.example.my-connector --name "My Connector"
```

Until the SDK is published, point the scaffold at a local checkout with `--sdk /path/to/photo-beaver/packages/plugin-sdk`.

The project contains:

- `photobeaver-plugin.json`: the manifest (id, version, permissions, sync modes, config form).
- `src/index.ts`: your connector, built with `defineConnector` from `@photobeaver/plugin-sdk`.
- `tests/plugin.test.ts`: tests using `@photobeaver/plugin-sdk/testing`.

## The development loop

1. In Photo Beaver open **Plugins > Developer** and turn on **Developer mode**.
2. In your project run `npm run dev` (`pb-plugin dev`). It builds `dist/index.js`, loads the plugin into the running app, and reloads it every time you save.
3. Add a source for your connector from **Sources > Add source** and watch it sync.

Logs from `ctx.log` and anything your plugin prints go to the plugin's log, shown under **View logs** on its card.

## Commands

| Command              | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `pb-plugin build`    | Bundles `src/index.ts` and its dependencies into `dist/index.js`.           |
| `pb-plugin dev`      | Builds on every change and tells Photo Beaver to load or reload the plugin. |
| `pb-plugin validate` | Checks the manifest and the shape of the default export.                    |
| `pb-plugin test`     | Runs your tests with the SDK test harness.                                  |
| `pb-plugin pack`     | Writes `<id>-<version>.pbplugin` and its SHA-256 file.                      |

## Testing without the app

`@photobeaver/plugin-sdk/testing` gives you fake contexts (storage, OAuth, folder picker, `isKnown`) and `runSync` to run a full sync in a test. `connectorContract(plugin, fixture)` returns ready-made checks for the rules every connector must follow: stable ids, batch size, cursor resume, idempotent re-sync and delete handling.

```ts
for (const check of connectorContract(connector, fixture)) it(check.name, check.run);
```

## Rules for connectors

- `externalId` must be stable across syncs. Cursors are opaque to Photo Beaver.
- Yield batches of 100 to 1000 items. The next batch is only requested after the previous one is saved, so a crash resumes from the last saved cursor.
- Use `ctx.isKnown` to skip unchanged items during a full scan.
- Honor `ctx.signal`, and use `ctx.fetch` for HTTP: it enforces your network allowlist and rate limit and retries 429 responses.
- Throw `AuthRequiredError` when the user must reconnect, and `RateLimitedError` to be rescheduled without counting a failure.

## Permissions and isolation

Each plugin runs in its own process. It talks to Photo Beaver only through `ctx`, never to the database or to secrets directly. Photo Beaver blocks network hosts that are not in `permissions.network` and file access outside the folders the plugin was granted: its data folder, temporary input files, and folders the user picked or entered in a source's configuration.

This protects the app from crashes and accidental overreach. It is not a security sandbox against malicious native code, which is why files installed from outside the store show a warning and `nativeModules: true` is shown prominently.

## Lifecycle

- `activate(ctx)` runs when the host starts, which happens lazily on the first call core makes.
- `deactivate()` runs when the plugin is disabled, uninstalled, reloaded or stopped after being idle.
- When the app quits, hosts are stopped at once and `deactivate()` is **not** called. Keep state in `ctx.storage` or `ctx.dataDir` as you go, not only on deactivate. Interrupted jobs run again on the next start.

## Native dependencies

Packages with compiled `.node` binaries (for example `onnxruntime-node`) cannot be bundled into `dist/index.js`. Install them as normal dependencies and list them in `package.json`:

```json
{
  "dependencies": { "onnxruntime-node": "^1.22.0" },
  "photobeaver": { "nativeDependencies": ["onnxruntime-node"] }
}
```

Then set `"permissions": { "nativeModules": true }` in `photobeaver-plugin.json`.

- `pb-plugin build` and `pb-plugin dev` leave these packages (and their subpaths) as runtime imports, and copy each one plus its production dependencies into `dist/node_modules/`. `dev` copies them after the first successful build, so restart it after installing or upgrading one.
- Binaries for other platforms are removed for known layouts (`onnxruntime-node` keeps only `bin/napi-v6/<platform>/<arch>/`). Set `PB_PLUGIN_TARGET_PLATFORM` and `PB_PLUGIN_TARGET_ARCH` to package for another platform, after installing that platform's binaries.
- `pb-plugin validate` and `pb-plugin pack` fail when native dependencies are declared without `nativeModules: true`, and warn when `nativeModules` is true but nothing is declared.
- A `.pbplugin` holds the binaries for one platform, so publish one package per platform. The unpacked package must stay under 512 MB.
- Most native packages are CommonJS. Import them with a default import (`import ort from 'onnxruntime-node'`).

## Install a packed plugin

Send the `.pbplugin` file to a user. In **Plugins > Installed > Install from file** they choose it, review the permissions it asks for, and install it. Plugins installed from a file are marked as not reviewed.
