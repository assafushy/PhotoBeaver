import { closeSharedArchives, openArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { defineConnector, type ItemRef, type SourceContext } from '@photobeaver/plugin-sdk';
import { isTakeout, type GooglePhotosConfig } from './config';
import { setupPicker, testPicker } from './picker/setup';
import { openPreview } from './picker/previews';
import { syncPicker } from './picker/sync';
import { takeoutRoot } from './takeout/root';
import { setupTakeout, testTakeout } from './takeout/setup';
import { syncTakeout } from './takeout/sync';

export type { GooglePhotosConfig, GooglePhotosSettings } from './config';
export { PAGE_SIZE } from './picker/api';
export { BATCH_SIZE } from './takeout/sync';

type Ctx = SourceContext<GooglePhotosConfig>;

async function pickerPreview(ctx: Ctx, item: ItemRef): Promise<ReadableStream<Uint8Array>> {
  const preview = await openPreview(ctx, item.externalId);
  if (!preview)
    throw new Error(`No saved preview for ${item.externalId}; sync again to re-pick it`);
  return preview;
}

export default defineConnector<GooglePhotosConfig>({
  async deactivate() {
    await closeSharedArchives();
  },

  setupSource: (ctx) => (isTakeout(ctx.config) ? setupTakeout(ctx) : setupPicker(ctx)),

  testSource: (ctx) => (isTakeout(ctx.config) ? testTakeout(ctx) : testPicker(ctx)),

  sync: (ctx, cursor) =>
    isTakeout(ctx.config) ? syncTakeout(ctx, cursor) : syncPicker(ctx, cursor),

  async getThumbnail(ctx, item) {
    return isTakeout(ctx.config) ? null : openPreview(ctx, item.externalId);
  },

  async getOriginal(ctx, item) {
    if (!isTakeout(ctx.config)) return pickerPreview(ctx, item);
    return openArchiveEntry(takeoutRoot(ctx.config), item.externalId);
  },
});
