import type { DeveloperMode } from '../../core/plugins/developer-mode';
import type { PluginManager } from '../../core/plugins/plugin-manager';
import type { IpcRegistry } from '../registry';

export interface PluginHandlerDeps {
  plugins: PluginManager;
  developerMode: DeveloperMode;
  pickPackage(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
}

function registerLifecycle(registry: IpcRegistry, { plugins }: PluginHandlerDeps): void {
  registry.handle('plugins.list', () => plugins.list());
  registry.handle(
    'plugins.setEnabled',
    async ({ id, enabled }, ctx) => (await plugins.setEnabled(id, enabled, ctx.user.id), null),
  );
  registry.handle('plugins.reEnable', ({ id }, ctx) => (plugins.reEnable(id, ctx.user.id), null));
  registry.handle(
    'plugins.uninstall',
    async ({ id, removeData }, ctx) => (await plugins.uninstall(id, removeData, ctx.user.id), null),
  );
  registry.handle('plugins.logs', ({ id, lines }) => plugins.logs(id, lines));
  registry.handle(
    'plugins.restoreDefaults',
    (_input, ctx) => (plugins.restoreDefaults(ctx.user.id), null),
  );
}

function registerSettings(registry: IpcRegistry, { plugins }: PluginHandlerDeps): void {
  registry.handle('plugins.getSettings', ({ id }) => plugins.settingsOf(id));
  registry.handle(
    'plugins.setSettings',
    ({ id, values }, ctx) => (plugins.setSettings(id, values, ctx.user.id), null),
  );
  registry.handle(
    'plugins.rerun',
    ({ id }, ctx) => (plugins.rerunOnLibrary(id, ctx.user.id), null),
  );
}

function registerInstall(registry: IpcRegistry, deps: PluginHandlerDeps): void {
  const { plugins } = deps;
  registry.handle('plugins.pickPackage', () => deps.pickPackage());
  registry.handle('plugins.inspectPackage', ({ path }) => plugins.inspectPackage(path));
  registry.handle('plugins.installStaged', ({ token }, ctx) =>
    plugins.installStaged(token, ctx.user.id),
  );
  registry.handle('plugins.discardStaged', ({ token }) => (plugins.discardStaged(token), null));
}

function registerDeveloper(registry: IpcRegistry, deps: PluginHandlerDeps): void {
  const { plugins, developerMode } = deps;
  registry.handle('plugins.getDeveloperMode', () => developerMode.enabled);
  registry.handle(
    'plugins.setDeveloperMode',
    async ({ enabled }) => (await developerMode.set(enabled), null),
  );
  registry.handle('plugins.loadUnpacked', async (_input, ctx) => {
    developerMode.assertEnabled();
    const dir = await deps.pickDirectory();
    return dir ? plugins.loadUnpacked(dir, ctx.user.id) : null;
  });
  registry.handle('plugins.reload', async ({ id }) => (await plugins.reload(id), null));
}

/**
 * Registers the Plugins screen channels (SPEC 8.1 #9). All require `plugins.manage`.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Plugin manager, developer mode and file pickers.
 */
export function registerPluginHandlers(registry: IpcRegistry, deps: PluginHandlerDeps): void {
  registerLifecycle(registry, deps);
  registerSettings(registry, deps);
  registerInstall(registry, deps);
  registerDeveloper(registry, deps);
}
