import { openArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { defineConnector } from '@photobeaver/plugin-sdk';
import type { FacebookExportConfig } from './config';
import { assertFacebookExport } from './layout';
import { syncExport } from './sync';
import { displayNameFor, requireRoot, withTree } from './tree';

export type { FacebookExportConfig } from './config';
export { BATCH_SIZE } from './sync';
export { NOT_FACEBOOK_EXPORT } from './layout';

export default defineConnector<FacebookExportConfig>({
  async setupSource(ctx) {
    const root = requireRoot(ctx.config);
    await withTree(root, assertFacebookExport);
    return { displayName: displayNameFor(root) };
  },

  async testSource(ctx) {
    await withTree(requireRoot(ctx.config), assertFacebookExport);
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
