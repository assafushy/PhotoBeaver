import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, parseCliArgs } from '../src';
import { recordingOutput } from './helpers';

describe('parseCliArgs', () => {
  it('parses a command with the cwd as default dir', () => {
    expect(parseCliArgs(['build'], '/work')).toEqual({
      ok: true,
      args: { command: 'build', dir: path.resolve('/work'), watch: false },
    });
  });

  it('resolves --dir and --watch', () => {
    const parsed = parseCliArgs(['build', '--watch', '--dir', 'plugin'], '/work');
    expect(parsed).toEqual({
      ok: true,
      args: { command: 'build', dir: path.resolve('/work/plugin'), watch: true },
    });
  });

  it('rejects unknown commands and options', () => {
    expect(parseCliArgs(['publish']).ok).toBe(false);
    expect(parseCliArgs(['build', '--nope']).ok).toBe(false);
  });

  it('prints usage', async () => {
    const out = recordingOutput();
    expect(await main(['--help'], out)).toBe(0);
    expect(out.lines[0]).toContain('Usage: pb-plugin');
    expect(await main(['nope'], out)).toBe(1);
    expect(out.errors[0]).toContain('Unknown command: nope');
  });
});
