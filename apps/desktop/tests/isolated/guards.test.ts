import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FolderGrants, installFilesystemGuard } from '../../src/plugin-host/permissions/filesystem';
import { installNetworkGuard } from '../../src/plugin-host/permissions/network';

const allowed = mkdtempSync(path.join(tmpdir(), 'pb-guard-'));
const outside = mkdtempSync(path.join(tmpdir(), 'pb-outside-'));
writeFileSync(path.join(allowed, 'ok.txt'), 'ok');
writeFileSync(path.join(outside, 'secret.txt'), 'secret');
installFilesystemGuard(
  new FolderGrants([allowed, process.cwd(), path.resolve(process.cwd(), '../..')]),
);
const guardedFetch = installNetworkGuard(['allowed.example.com']);

describe('process-wide guards (run in an isolated worker)', () => {
  it('blocks fs access outside grants, including ESM named imports', async () => {
    expect(readFileSync(path.join(allowed, 'ok.txt'), 'utf8')).toBe('ok');
    expect(() => readFileSync(path.join(outside, 'secret.txt'))).toThrow(/not allowed/);
    await expect(readFile(path.join(outside, 'secret.txt'))).rejects.toThrow(/not allowed/);
  });

  it('blocks fetch to hosts outside the allowlist', async () => {
    await expect(guardedFetch('https://blocked.example.org/x')).rejects.toThrow(/not allowed/);
    await expect(fetch('https://blocked.example.org/x')).rejects.toThrow(/not allowed/);
  });
});
