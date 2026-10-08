import type {
  IpcChannel,
  IpcInput,
  IpcOutput,
  IpcResult,
  PbApi,
  PbEventName,
  PbEvents,
} from '@photobeaver/shared';
import { isPbEventName } from '@photobeaver/shared/event-names';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

class PbIpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PbIpcError';
  }
}

async function invoke<C extends IpcChannel>(
  channel: C,
  input?: IpcInput<C>,
): Promise<IpcOutput<C>> {
  const result = (await ipcRenderer.invoke(channel, input)) as IpcResult<IpcOutput<C>>;
  if (!result.ok) throw new PbIpcError(result.error.code, result.error.message);
  return result.value;
}

function on<K extends PbEventName>(name: K, listener: (payload: PbEvents[K]) => void): () => void {
  if (!isPbEventName(name)) throw new Error(`Unknown event: ${name}`);
  const channel = `pb:event:${name}`;
  const wrapped = (_event: IpcRendererEvent, payload: PbEvents[K]) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => void ipcRenderer.removeListener(channel, wrapped);
}

const byId =
  <C extends IpcChannel>(channel: C) =>
  (id: string) =>
    invoke(channel, { id } as IpcInput<C>);

const api: PbApi = {
  app: { info: () => invoke('app.info'), capabilities: () => invoke('app.capabilities') },
  session: { current: () => invoke('session.current') },
  auth: {
    users: () => invoke('auth.users'),
    signIn: (userId, secret) => invoke('auth.signIn', { userId, secret }),
    signInBiometric: (userId) => invoke('auth.signInBiometric', { userId }),
    recover: (recoveryKey, newPassword) => invoke('auth.recover', { recoveryKey, newPassword }),
    lock: () => invoke('auth.lock'),
  },
  users: {
    list: () => invoke('users.list'),
    create: (input) => invoke('users.create', input),
    update: (input) => invoke('users.update', input),
    delete: byId('users.delete'),
    setScopes: (id, scopes) => invoke('users.setScopes', { id, ...scopes }),
    settings: () => invoke('users.settings'),
    enableMulti: (password) => invoke('users.enableMulti', { password }),
    disableMulti: (password) => invoke('users.disableMulti', { password }),
    setAutoLock: (minutes) => invoke('users.setAutoLock', { minutes }),
  },
  edits: {
    setFavorite: (ids, favorite) => invoke('assets.setFavorite', { ids, favorite }),
    setHidden: (ids, hidden) => invoke('assets.setHidden', { ids, hidden }),
    addTag: (ids, name) => invoke('assets.addTag', { ids, name }),
    removeTag: (ids, name) => invoke('assets.removeTag', { ids, name }),
    setDate: (id, capturedAt) => invoke('assets.setDate', { id, capturedAt }),
    setLocation: (id, location) => invoke('assets.setLocation', { id, location }),
    rerun: (ids) => invoke('assets.rerun', { ids }),
  },
  albums: {
    list: () => invoke('albums.list'),
    create: (name) => invoke('albums.create', { name }),
    rename: (id, name) => invoke('albums.rename', { id, name }),
    delete: byId('albums.delete'),
    addAssets: (id, assetIds) => invoke('albums.addAssets', { id, assetIds }),
    removeAssets: (id, assetIds) => invoke('albums.removeAssets', { id, assetIds }),
  },
  audit: { list: (before = null, limit = 100) => invoke('audit.list', { before, limit }) },
  library: {
    query: (input) => invoke('library.query', input),
    facets: () => invoke('library.facets'),
    geoPoints: (filter) => invoke('library.geoPoints', { filter }),
  },
  duplicates: {
    list: () => invoke('duplicates.list'),
    merge: (id, keepAssetId) => invoke('duplicates.merge', { id, keepAssetId }),
    dismiss: byId('duplicates.dismiss'),
  },
  people: {
    list: () => invoke('people.list'),
    faces: (id, after = null) => invoke('people.faces', { id, after }),
    rename: (id, name) => invoke('people.rename', { id, name }),
    merge: (fromId, intoId) => invoke('people.merge', { fromId, intoId }),
    moveFaces: (faceIds, target) => invoke('people.moveFaces', { faceIds, target }),
    rejectFace: (faceId) => invoke('people.rejectFace', { faceId }),
    setCover: (personId, faceId) => invoke('people.setCover', { personId, faceId }),
  },
  merges: { recent: () => invoke('merges.recent'), undo: byId('merges.undo') },
  settings: { get: () => invoke('settings.get'), set: (patch) => invoke('settings.set', patch) },
  assets: { get: byId('assets.get'), openInSource: byId('assets.openInSource') },
  sources: {
    list: () => invoke('sources.list'),
    connectors: () => invoke('sources.connectors'),
    add: (input) => invoke('sources.add', input),
    remove: byId('sources.remove'),
    reconnect: (id, setupId) => invoke('sources.reconnect', { id, setupId }),
    cancelSetup: (setupId) => invoke('sources.cancelSetup', { setupId }),
    pickDirectory: () => invoke('sources.pickDirectory'),
    syncNow: byId('sources.syncNow'),
    pause: byId('sources.pause'),
    resume: byId('sources.resume'),
  },
  plugins: {
    list: () => invoke('plugins.list'),
    setEnabled: (id, enabled) => invoke('plugins.setEnabled', { id, enabled }),
    reEnable: byId('plugins.reEnable'),
    uninstall: (id, removeData) => invoke('plugins.uninstall', { id, removeData }),
    logs: (id, lines) => invoke('plugins.logs', { id, lines }),
    pickPackage: () => invoke('plugins.pickPackage'),
    inspectPackage: (path) => invoke('plugins.inspectPackage', { path }),
    installStaged: (token) => invoke('plugins.installStaged', { token }),
    discardStaged: (token) => invoke('plugins.discardStaged', { token }),
    restoreDefaults: () => invoke('plugins.restoreDefaults'),
    getDeveloperMode: () => invoke('plugins.getDeveloperMode'),
    setDeveloperMode: (enabled) => invoke('plugins.setDeveloperMode', { enabled }),
    loadUnpacked: () => invoke('plugins.loadUnpacked'),
    reload: byId('plugins.reload'),
    getSettings: byId('plugins.getSettings'),
    setSettings: (id, values) => invoke('plugins.setSettings', { id, values }),
    rerun: byId('plugins.rerun'),
    openNotice: byId('plugins.openNotice'),
  },
  events: { on },
};

contextBridge.exposeInMainWorld('pb', api);
