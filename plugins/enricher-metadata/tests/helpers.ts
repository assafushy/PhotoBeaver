import type { AssetView, EnrichmentResult } from '@photobeaver/plugin-sdk';
import { createFakeEnrichContext, runEnrich } from '@photobeaver/plugin-sdk/testing';
import plugin from '../src';

/**
 * Builds a minimal AssetView.
 *
 * @param id - Asset id.
 * @param mime - MIME type.
 * @returns The asset.
 */
export function asset(id: string, mime: string): AssetView {
  const kind = mime.startsWith('video/') ? 'video' : 'image';
  return { id, kind, mime, instances: [], enrichments: {} };
}

/**
 * Runs the plugin on one file through the fake EnrichContext.
 *
 * @param file - The original's path.
 * @param mime - Its MIME type.
 * @returns The result and the fake context (for logs).
 */
export async function enrichFile(file: string, mime: string) {
  const ctx = createFakeEnrichContext({
    inputs: { a1: { original: file, mime } },
    defaultInput: 'original',
  });
  const results = await runEnrich(plugin, [asset('a1', mime)], ctx);
  return { result: results.get('a1') as EnrichmentResult, ctx };
}
