import { describe, expect, it } from 'vitest';
import type { AssetView, EnrichContext } from '@photobeaver/plugin-sdk';
import enricher, { TAG_NAME } from '../src/index';

const asset: AssetView = {
  id: 'asset-1',
  kind: 'image',
  mime: 'image/jpeg',
  instances: [{ sourceId: 'source-1', filename: 'sunrise.jpg' }],
  enrichments: {},
};

describe('{{name}}', () => {
  it('only enriches images', () => {
    expect(enricher.shouldEnrich?.(asset)).toBe(true);
    expect(enricher.shouldEnrich?.({ ...asset, kind: 'video' })).toBe(false);
  });

  it('returns a tag', async () => {
    const result = await enricher.enrich({} as EnrichContext<unknown>, asset);
    expect(result.tags).toEqual([{ name: TAG_NAME, confidence: 1 }]);
  });
});
