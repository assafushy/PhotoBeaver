import { describe, expect, it } from 'vitest';
import { IPC_CONTRACT, PERMISSIONS, isIpcChannel } from '../src';

describe('ipc contract', () => {
  it('declares a known permission (or public) on every channel', () => {
    for (const contract of Object.values(IPC_CONTRACT)) {
      expect([...PERMISSIONS, 'public']).toContain(contract.requires);
    }
  });

  it('assigns every channel the permission SPEC 3.3 gives that action', () => {
    const actual: Record<string, string[]> = {};
    for (const [name, contract] of Object.entries(IPC_CONTRACT))
      (actual[contract.requires] ??= []).push(name);
    for (const list of Object.values(actual)) list.sort();
    expect(actual).toEqual(EXPECTED_ACCESS);
  });

  it('recognizes declared channels only', () => {
    expect(isIpcChannel('library.query')).toBe(true);
    expect(isIpcChannel('toString')).toBe(false);
  });

  it('applies library query defaults', () => {
    expect(IPC_CONTRACT['library.query'].input.parse({})).toEqual({
      cursor: null,
      limit: 200,
      filter: {},
    });
  });
});

const EXPECTED_ACCESS: Record<string, string[]> = {
  public: ['auth.recover', 'auth.signIn', 'auth.signInBiometric', 'auth.users', 'session.current'],
  'assets.view': [
    'albums.list',
    'app.capabilities',
    'app.info',
    'assets.get',
    'assets.openInSource',
    'auth.lock',
    'duplicates.list',
    'library.facets',
    'library.geoPoints',
    'library.query',
    'merges.recent',
    'people.faces',
    'people.list',
    'settings.get',
    'sources.list',
  ],
  'assets.edit': [
    'assets.addTag',
    'assets.removeTag',
    'assets.setDate',
    'assets.setFavorite',
    'assets.setHidden',
    'assets.setLocation',
  ],
  'albums.edit': [
    'albums.addAssets',
    'albums.create',
    'albums.delete',
    'albums.removeAssets',
    'albums.rename',
  ],
  'people.edit': [
    'people.merge',
    'people.moveFaces',
    'people.rejectFace',
    'people.rename',
    'people.setCover',
  ],
  'duplicates.merge': ['duplicates.dismiss', 'duplicates.merge', 'merges.undo'],
  'sources.sync': ['assets.rerun', 'sources.pause', 'sources.resume', 'sources.syncNow'],
  'sources.manage': [
    'sources.add',
    'sources.cancelSetup',
    'sources.connectors',
    'sources.pickDirectory',
    'sources.reconnect',
    'sources.remove',
  ],
  'plugins.manage': [
    'plugins.discardStaged',
    'plugins.getDeveloperMode',
    'plugins.getSettings',
    'plugins.inspectPackage',
    'plugins.installStaged',
    'plugins.list',
    'plugins.loadUnpacked',
    'plugins.logs',
    'plugins.openNotice',
    'plugins.pickPackage',
    'plugins.reEnable',
    'plugins.reload',
    'plugins.rerun',
    'plugins.restoreDefaults',
    'plugins.setDeveloperMode',
    'plugins.setEnabled',
    'plugins.setSettings',
    'plugins.uninstall',
  ],
  'users.manage': [
    'users.create',
    'users.delete',
    'users.disableMulti',
    'users.enableMulti',
    'users.list',
    'users.setAutoLock',
    'users.setScopes',
    'users.settings',
    'users.update',
  ],
  'library.admin': ['audit.list', 'settings.set'],
};
