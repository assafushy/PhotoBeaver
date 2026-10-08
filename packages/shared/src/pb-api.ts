import type {
  AlbumSummary,
  AuditPage,
  PickerUser,
  SessionState,
  SessionUser,
  UserSummary,
  UsersSettings,
} from './access-contract';
import type { PbEventName, PbEvents } from './events';
import type {
  AddSourceInput,
  AppInfo,
  AppSettings,
  DuplicateGroup,
  GeoPoints,
  LibraryFacets,
  LibraryFilter,
  MergeRecord,
  PersonFacesPage,
  PersonSummary,
  PluginSettingsView,
  AssetDetail,
  ConnectorInfo,
  LibraryPage,
  LibraryQueryInput,
  PluginSummary,
  SourceSummary,
  StagedPackageSummary,
} from './ipc-contract';

export type Unsubscribe = () => void;

export interface PbApi {
  app: { info(): Promise<AppInfo>; capabilities(): Promise<{ faces: boolean; merge: boolean }> };
  session: { current(): Promise<SessionState> };
  auth: {
    users(): Promise<PickerUser[]>;
    signIn(userId: string, secret: string): Promise<SessionUser>;
    signInBiometric(userId: string): Promise<SessionUser>;
    recover(recoveryKey: string, newPassword: string): Promise<SessionUser>;
    lock(): Promise<null>;
  };
  users: {
    list(): Promise<UserSummary[]>;
    create(input: {
      displayName: string;
      role: SessionUser['role'];
      secret: string;
      secretKind: 'password' | 'pin';
    }): Promise<UserSummary>;
    update(input: {
      id: string;
      displayName?: string;
      role?: SessionUser['role'];
      secret?: string;
      secretKind?: 'password' | 'pin';
      biometric?: boolean;
      disabled?: boolean;
    }): Promise<UserSummary>;
    delete(id: string): Promise<null>;
    setScopes(id: string, scopes: { sourceIds: string[]; albumIds: string[] }): Promise<null>;
    settings(): Promise<UsersSettings>;
    enableMulti(password: string): Promise<{ recoveryKey: string }>;
    disableMulti(password: string): Promise<null>;
    setAutoLock(minutes: number): Promise<null>;
  };
  edits: {
    setFavorite(ids: string[], favorite: boolean): Promise<null>;
    setHidden(ids: string[], hidden: boolean): Promise<null>;
    addTag(ids: string[], name: string): Promise<null>;
    removeTag(ids: string[], name: string): Promise<null>;
    setDate(id: string, capturedAt: number | null): Promise<null>;
    setLocation(id: string, location: { lat: number; lon: number } | null): Promise<null>;
    rerun(ids: string[]): Promise<null>;
  };
  albums: {
    list(): Promise<AlbumSummary[]>;
    create(name: string): Promise<AlbumSummary>;
    rename(id: string, name: string): Promise<null>;
    delete(id: string): Promise<null>;
    addAssets(id: string, assetIds: string[]): Promise<null>;
    removeAssets(id: string, assetIds: string[]): Promise<null>;
  };
  audit: { list(before?: number | null, limit?: number): Promise<AuditPage> };
  library: {
    query(input: LibraryQueryInput): Promise<LibraryPage>;
    facets(): Promise<LibraryFacets>;
    geoPoints(filter: LibraryFilter): Promise<GeoPoints>;
  };
  duplicates: {
    list(): Promise<DuplicateGroup[]>;
    merge(id: string, keepAssetId: string): Promise<null>;
    dismiss(id: string): Promise<null>;
  };
  merges: { recent(): Promise<MergeRecord[]>; undo(id: string): Promise<null> };
  people: {
    list(): Promise<PersonSummary[]>;
    faces(id: string, after?: string | null): Promise<PersonFacesPage>;
    rename(id: string, name: string): Promise<null>;
    merge(fromId: string, intoId: string): Promise<null>;
    moveFaces(
      faceIds: string[],
      target: { personId: string } | { newPerson: true },
    ): Promise<{ personId: string }>;
    rejectFace(faceId: string): Promise<null>;
    setCover(personId: string, faceId: string): Promise<null>;
  };
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<null> };
  assets: {
    get(id: string): Promise<AssetDetail>;
    openInSource(instanceId: string): Promise<null>;
  };
  sources: {
    list(): Promise<SourceSummary[]>;
    connectors(): Promise<ConnectorInfo[]>;
    add(input: AddSourceInput): Promise<SourceSummary>;
    remove(id: string): Promise<null>;
    reconnect(id: string, setupId?: string): Promise<SourceSummary>;
    cancelSetup(setupId: string): Promise<null>;
    pickDirectory(): Promise<string | null>;
    syncNow(id: string): Promise<null>;
    pause(id: string): Promise<null>;
    resume(id: string): Promise<null>;
  };
  plugins: {
    list(): Promise<PluginSummary[]>;
    setEnabled(id: string, enabled: boolean): Promise<null>;
    reEnable(id: string): Promise<null>;
    uninstall(id: string, removeData: boolean): Promise<null>;
    logs(id: string, lines?: number): Promise<string>;
    pickPackage(): Promise<string | null>;
    inspectPackage(path: string): Promise<StagedPackageSummary>;
    installStaged(token: string): Promise<PluginSummary>;
    discardStaged(token: string): Promise<null>;
    restoreDefaults(): Promise<null>;
    getDeveloperMode(): Promise<boolean>;
    setDeveloperMode(enabled: boolean): Promise<null>;
    loadUnpacked(): Promise<PluginSummary | null>;
    reload(id: string): Promise<null>;
    getSettings(id: string): Promise<PluginSettingsView>;
    setSettings(id: string, values: Record<string, unknown>): Promise<null>;
    rerun(id: string): Promise<null>;
    openNotice(id: string): Promise<null>;
  };
  events: {
    on<K extends PbEventName>(name: K, listener: (payload: PbEvents[K]) => void): Unsubscribe;
  };
}
