import type { AppInfo, LibraryPage, LibraryQueryInput, SessionUser } from './ipc-contract';

export interface PbApi {
  app: { info(): Promise<AppInfo> };
  session: { current(): Promise<SessionUser> };
  library: { query(input: LibraryQueryInput): Promise<LibraryPage> };
}
