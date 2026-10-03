import type { PbEventName, PbEvents } from './events';
import type {
  AddSourceInput,
  AppInfo,
  AssetDetail,
  ConnectorInfo,
  LibraryPage,
  LibraryQueryInput,
  SessionUser,
  SourceSummary,
} from './ipc-contract';

export type Unsubscribe = () => void;

export interface PbApi {
  app: { info(): Promise<AppInfo> };
  session: { current(): Promise<SessionUser> };
  library: { query(input: LibraryQueryInput): Promise<LibraryPage> };
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
  events: {
    on<K extends PbEventName>(name: K, listener: (payload: PbEvents[K]) => void): Unsubscribe;
  };
}
