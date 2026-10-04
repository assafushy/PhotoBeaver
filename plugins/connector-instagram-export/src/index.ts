import { openArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { defineConnector } from '@photobeaver/plugin-sdk';
import type { InstagramExportConfig } from './config';
import { assertInstagramExport } from './layout';
import { syncExport } from './sync';
import { displayNameFor, requireRoot, withTree } from './tree';

export type { InstagramExportConfig } from './config';
export { BATCH_SIZE } from './sync';
export { NOT_INSTAGRAM_EXPORT } from './layout';

export default defineConnector<InstagramExportConfig>({
  async setupSource(ctx) {
    const root = requireRoot(ctx.config);
    await withTree(root, assertInstagramExport);
    return { displayName: displayNameFor(root) };
  },

  async testSource(ctx) {
    await withTree(requireRoot(ctx.config), assertInstagramExport);
  },

  sync(ctx, cursor) {
    return syncExport(ctx, cursor);
  },

  async getThumbnail() {
    return null;
  },

  getOriginal(ctx, item) {
    return openArchiveEntry(requireRoot(ctx.config), item.externalId);
  },
});
