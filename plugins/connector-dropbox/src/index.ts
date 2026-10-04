import { defineConnector } from '@photobeaver/plugin-sdk';
import type { DropboxConfig } from './config';
import { getDropboxOriginal, getDropboxThumbnail } from './content';
import { setupDropbox, testDropbox } from './setup';
import { syncDropbox } from './sync';

export type { DropboxConfig, DropboxSettings } from './config';

export default defineConnector<DropboxConfig>({
  setupSource: setupDropbox,
  testSource: testDropbox,
  sync: syncDropbox,
  getThumbnail: getDropboxThumbnail,
  getOriginal: getDropboxOriginal,
});
