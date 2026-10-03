import { describe, expect, it } from 'vitest';
import { checkExportShape } from '../src';

const fn = (): void => undefined;

describe('checkExportShape', () => {
  it('accepts a connector and an enricher', () => {
    const connector = { setupSource: fn, sync: fn, getOriginal: fn };
    expect(checkExportShape('connector', { default: connector })).toEqual([]);
    expect(checkExportShape('enricher', { default: { enrich: fn } })).toEqual([]);
  });

  it('names missing methods', () => {
    expect(checkExportShape('connector', { default: { sync: fn } })).toEqual([
      'main: the default export of a connector must have a setupSource() function',
      'main: the default export of a connector must have a getOriginal() function',
    ]);
  });

  it('requires a default export', () => {
    expect(checkExportShape('enricher', {})[0]).toMatch(/default export must be a plugin object/);
  });
});
