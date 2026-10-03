import { parseArgs } from 'node:util';
import { writeImageSet, writeVideo } from '../tests/fixtures/generate.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { count: { type: 'string', default: '1000' }, videos: { type: 'string', default: '0' } },
});

const root = positionals[0];
if (!root) {
  console.error('Usage: node scripts/generate-fixtures.ts <folder> --count 10000 [--videos 5]');
  process.exit(1);
}

const started = Date.now();
await writeImageSet(root, Number(values.count));
for (let i = 0; i < Number(values.videos); i++) await writeVideo(root, `videos/clip-${i}.mp4`, 2);
console.log(
  `Wrote ${values.count} images and ${values.videos} videos to ${root} in ${Date.now() - started} ms`,
);
