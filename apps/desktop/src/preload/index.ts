import type { IpcChannel, IpcInput, IpcOutput, IpcResult, PbApi } from '@photobeaver/shared';
import { contextBridge, ipcRenderer } from 'electron';

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

const api: PbApi = {
  app: { info: () => invoke('app.info') },
  session: { current: () => invoke('session.current') },
  library: { query: (input) => invoke('library.query', input) },
};

contextBridge.exposeInMainWorld('pb', api);
