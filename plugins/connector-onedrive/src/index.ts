import { defineConnector } from '@photobeaver/plugin-sdk';
import type { OneDriveConfig } from './config';
import { syncDelta } from './delta';
import { getOriginal, getThumbnail } from './downloads';
import { GRAPH_URL, graphClient } from './graph';
import { setupOneDrive } from './setup';

export type { OneDriveConfig, OneDriveSettings } from './config';

export default defineConnector<OneDriveConfig>({
  setupSource: setupOneDrive,

  async testSource(ctx) {
    const client = await graphClient(ctx);
    await client.json(`${GRAPH_URL}/me/drive?$select=id`);
  },

  async *sync(ctx, cursor) {
    yield* syncDelta(ctx, await graphClient(ctx), cursor);
  },

  getThumbnail,
  getOriginal,
});
