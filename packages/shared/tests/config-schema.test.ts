import { describe, expect, it } from 'vitest';
import { validateConfig, type ConfigSchema } from '../src';

const schema: ConfigSchema = {
  required: ['root'],
  properties: {
    root: { type: 'string', format: 'directory' },
    includeVideos: { type: 'boolean', default: true },
    threshold: { type: 'integer', minimum: 0, maximum: 16, default: 6 },
    mode: { enum: ['auto', 'ask'] },
  },
};

describe('validateConfig', () => {
  it('applies defaults and drops unknown keys', () => {
    expect(validateConfig(schema, { root: '/p', extra: 1 })).toEqual({
      ok: true,
      value: { root: '/p', includeVideos: true, threshold: 6 },
    });
  });

  it('reports missing required fields, bad types, ranges and enums', () => {
    expect(
      validateConfig(schema, { root: '', includeVideos: 'yes', threshold: 20, mode: 'x' }),
    ).toEqual({
      ok: false,
      errors: {
        root: 'Required',
        includeVideos: 'Expected boolean',
        threshold: 'Must be at most 16',
        mode: 'Pick one of the options',
      },
    });
  });
});
