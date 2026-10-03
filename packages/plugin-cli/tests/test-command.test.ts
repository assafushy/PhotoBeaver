import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MISSING_VITEST_HINT, resolveVitest, runTest } from '../src';
import { cleanupTemp, recordingOutput, tempProject } from './helpers';

afterEach(cleanupTemp);

const binName = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';

describe('resolveVitest', () => {
  it('prefers the project bin', () => {
    const dir = tempProject({ [`node_modules/.bin/${binName}`]: '' });
    expect(resolveVitest(dir)).toEqual({
      command: path.join(dir, 'node_modules/.bin', binName),
      args: ['run'],
    });
  });

  it('falls back to npx when vitest is installed in a parent folder', () => {
    const root = tempProject({
      'node_modules/vitest/package.json': '{}',
      'plugin/package.json': '{}',
    });
    expect(resolveVitest(path.join(root, 'plugin'))).toEqual({
      command: 'npx',
      args: ['vitest', 'run'],
    });
  });

  it('fails fast with a hint when vitest is missing', async () => {
    const dir = tempProject();
    expect(resolveVitest(dir)).toBeNull();
    const out = recordingOutput();
    expect(await runTest({ command: 'test', dir, watch: false }, out)).toBe(1);
    expect(out.errors).toEqual([MISSING_VITEST_HINT]);
  });
});
