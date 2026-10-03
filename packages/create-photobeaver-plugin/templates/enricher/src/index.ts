import { defineEnricher } from '@photobeaver/plugin-sdk';

export const TAG_NAME = 'hello-from-{{packageName}}';

export default defineEnricher({
  shouldEnrich: (asset) => asset.kind === 'image',

  async enrich(_ctx, asset) {
    return {
      tags: [{ name: TAG_NAME, confidence: 1 }],
      data: { instances: asset.instances.length },
    };
  },
});
