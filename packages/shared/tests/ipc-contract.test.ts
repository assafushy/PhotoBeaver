import { describe, expect, it } from 'vitest';
import { IPC_CONTRACT, PERMISSIONS, isIpcChannel } from '../src';

describe('ipc contract', () => {
  it('declares a known permission on every channel', () => {
    for (const contract of Object.values(IPC_CONTRACT)) {
      expect(PERMISSIONS).toContain(contract.requires);
    }
  });

  it('recognizes declared channels only', () => {
    expect(isIpcChannel('library.query')).toBe(true);
    expect(isIpcChannel('toString')).toBe(false);
  });

  it('applies library query defaults', () => {
    expect(IPC_CONTRACT['library.query'].input.parse({})).toEqual({ cursor: null, limit: 200 });
  });
});
