import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { writeZip, type ZipInput } from '../../../../packages/plugin-sdk/tests/zip-writer';
import { patternPixels } from './generate';

type FileMap = Record<string, string | Buffer>;

export const PARIS = { lat: 48.8584, lon: 2.2945 };

/**
 * Mojibake as Meta writes it: every UTF-8 byte as its own latin-1 character.
 *
 * @param text - Correct text.
 * @returns The garbled form found in export JSON.
 */
export const metaEncoded = (text: string): string => Buffer.from(text, 'utf8').toString('latin1');

/**
 * A small patterned JPEG.
 *
 * @param seed - Pattern seed.
 * @returns JPEG bytes.
 */
export function jpeg(seed: number): Promise<Buffer> {
  return sharp(patternPixels(seed, 96, 72), { raw: { width: 96, height: 72, channels: 3 } })
    .jpeg()
    .toBuffer();
}

function writeTree(root: string, files: FileMap): void {
  for (const [name, data] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function writeParts(root: string, prefix: string, parts: FileMap[]): void {
  mkdirSync(root, { recursive: true });
  parts.forEach((files, index) => {
    const entries: ZipInput[] = Object.entries(files).map(([name, data]) => ({
      name,
      data,
      method: 8,
    }));
    writeFileSync(path.join(root, `${prefix}-${index + 1}.zip`), writeZip(entries));
  });
}

/**
 * A Facebook "Download your information" export as two downloaded zip parts:
 * the posts JSON in one, the photos in the other. One caption is mojibake and
 * one photo has GPS in Paris.
 *
 * @param root - Folder to write the zips into.
 */
export async function writeFacebookExport(root: string): Promise<void> {
  const media = 'your_facebook_activity/posts/media/Trip_1';
  const exif = { taken_timestamp: 1_690_000_000, latitude: PARIS.lat, longitude: PARIS.lon };
  const posts = [
    {
      timestamp: 1_690_000_100,
      attachments: [
        {
          data: [
            {
              media: {
                uri: `${media}/cafe.jpg`,
                creation_timestamp: 1_690_000_100,
                description: metaEncoded('Café au lait'),
                media_metadata: { photo_metadata: { exif_data: [exif] } },
              },
            },
          ],
        },
      ],
    },
    {
      timestamp: 1_690_100_000,
      attachments: [
        { data: [{ media: { uri: `${media}/tower.jpg`, creation_timestamp: 1_690_100_000 } }] },
      ],
    },
  ];
  writeParts(root, 'facebook-me', [
    {
      'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json':
        JSON.stringify(posts),
    },
    { [`${media}/cafe.jpg`]: await jpeg(31), [`${media}/tower.jpg`]: await jpeg(32) },
  ]);
}

/**
 * An extracted Instagram export with one single-photo post and one carousel.
 *
 * @param root - Folder to write into.
 */
export async function writeInstagramExport(root: string): Promise<void> {
  const dir = 'media/posts/202401';
  const posts = [
    {
      media: [
        {
          uri: `${dir}/one.jpg`,
          creation_timestamp: 1_704_100_000,
          title: metaEncoded('Señor beaver'),
        },
      ],
    },
    {
      title: 'Weekend',
      creation_timestamp: 1_704_200_000,
      media: [{ uri: `${dir}/two.jpg` }, { uri: `${dir}/three.jpg` }],
    },
  ];
  writeTree(root, {
    'your_instagram_activity/media/posts_1.json': JSON.stringify(posts),
    [`${dir}/one.jpg`]: await jpeg(41),
    [`${dir}/two.jpg`]: await jpeg(42),
    [`${dir}/three.jpg`]: await jpeg(43),
  });
}

/**
 * A Google Takeout export split into two zip parts, with the sidecar in the other
 * part than its photo, and the same photo in an album and a year folder.
 *
 * @param root - Folder to write the zips into.
 */
export async function writeTakeoutExport(root: string): Promise<void> {
  const base = 'Takeout/Google Photos';
  const photo = await jpeg(51);
  const sidecar = JSON.stringify({
    title: 'IMG_1.jpg',
    photoTakenTime: { timestamp: '1577880000' },
    geoData: { latitude: PARIS.lat, longitude: PARIS.lon },
  });
  writeParts(root, 'takeout-20260101', [
    { [`${base}/Photos from 2020/IMG_1.jpg`]: photo, [`${base}/Summer/IMG_1.jpg`]: photo },
    {
      [`${base}/Photos from 2020/IMG_1.jpg.supplemental-metadata.json`]: sidecar,
      [`${base}/Summer/IMG_1.jpg.supplemental-metadata.json`]: sidecar,
      [`${base}/Photos from 2020/IMG_2.jpg`]: await jpeg(52),
      [`${base}/Photos from 2020/IMG_2.jpg.supplemental-metadata.json`]: JSON.stringify({
        photoTakenTime: { timestamp: '1577966400' },
      }),
    },
  ]);
}
