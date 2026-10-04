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
  PluginSettingsView,
  AssetDetail,
  ConnectorInfo,
  LibraryPage,
  LibraryQueryInput,
  PluginSummary,
  SessionUser,
  SourceSummary,
  StagedPackageSummary,
} from './ipc-contract';

export type Unsubscribe = () => void;

export interface PbApi {
  app: { info(): Promise<AppInfo> };
  session: { current(): Promise<SessionUser> };
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
  };
  events: {
    on<K extends PbEventName>(name: K, listener: (payload: PbEvents[K]) => void): Unsubscribe;
  };
}
