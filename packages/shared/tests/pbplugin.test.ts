import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { packPlugin, sha256Hex, unpackPlugin } from '../src/pbplugin';
import { parseDevRequest } from '../src/dev-socket';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-pack-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('.pbplugin packages', () => {
  it('round-trips the manifest, dist and assets but not sources', () => {
    const src = temp();
    writeFileSync(path.join(src, 'photobeaver-plugin.json'), '{"id":"x"}');
    mkdirSync(path.join(src, 'dist'));
    writeFileSync(path.join(src, 'dist', 'index.js'), 'export default {}');
    mkdirSync(path.join(src, 'src'));
    writeFileSync(path.join(src, 'src', 'index.ts'), 'secret source');
    const bytes = packPlugin(src);
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
    const out = temp();
    expect(unpackPlugin(bytes, out)).toBe('{"id":"x"}');
    expect(readFileSync(path.join(out, 'dist', 'index.js'), 'utf8')).toBe('export default {}');
    expect(() => readFileSync(path.join(out, 'src', 'index.ts'))).toThrow();
  });

  it('refuses zip-slip paths and packages without a manifest', () => {
    const evil = zipSync({
      'photobeaver-plugin.json': strToU8('{}'),
      '../escape.txt': strToU8('x'),
    });
    expect(() => unpackPlugin(evil, temp())).toThrow(/Unsafe path/);
    expect(() => unpackPlugin(zipSync({ 'a.txt': strToU8('x') }), temp())).toThrow(
      /no photobeaver-plugin.json/,
    );
    expect(() => packPlugin(temp())).toThrow(/not found/);
  });
});

describe('dev socket protocol', () => {
  it('parses load and reload requests and rejects anything else', () => {
    expect(parseDevRequest('{"cmd":"reload","path":"/p"}')).toEqual({
      request: { cmd: 'reload', path: '/p' },
    });
    expect(parseDevRequest('{"cmd":"rm","path":"/"}')).toEqual({ error: 'Invalid request' });
    expect(parseDevRequest('nope')).toEqual({ error: 'Invalid JSON' });
  });
});
