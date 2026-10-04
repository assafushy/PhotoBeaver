import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '@photobeaver/shared/manifest';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../photobeaver-plugin.json', import.meta.url), 'utf8'),
);

describe('manifest', () => {
  it('passes validation', () => {
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});
