# {{name}}

A Photo Beaver connector plugin (`{{id}}`).

## Develop

```sh
npm install
npm run dev
```

`npm run dev` rebuilds `dist/index.js` on every change and asks a running Photo Beaver to load or reload the plugin. Turn on Developer mode first: Settings > Plugins > Developer.

## Test

```sh
npm test
```

Tests run with Vitest against the SDK test harness (`@photobeaver/plugin-sdk/testing`), so you don't need the desktop app.
The connector contract suite checks cursors, batch sizes, stable ids, resume, idempotency and delete handling.

## Build and validate

```sh
npm run build
npm run validate
```

## Pack and install from file

```sh
npm run pack
```

This writes `{{id}}-<version>.pbplugin` and a matching `.sha256` file. In Photo Beaver, open Settings > Plugins > Install from file and pick the `.pbplugin`.

Plugin settings live in `photobeaver-plugin.json`. Ask only for the permissions you need.
