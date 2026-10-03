import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

export interface ImageSpec {
  file: string;
  width?: number;
  height?: number;
  orientation?: number;
  color?: { r: number; g: number; b: number };
}

/**
 * Writes a solid-color JPEG or PNG (by extension), optionally with an EXIF orientation.
 *
 * @param root - Folder to write into.
 * @param spec - File name, size, color and orientation.
 * @returns The absolute path.
 */
export async function writeImage(root: string, spec: ImageSpec): Promise<string> {
  const target = path.join(root, spec.file);
  await mkdir(path.dirname(target), { recursive: true });
  const base = sharp({
    create: {
      width: spec.width ?? 64,
      height: spec.height ?? 48,
      channels: 3,
      background: spec.color ?? { r: 200, g: 120, b: 40 },
    },
  });
  const encoded = spec.file.endsWith('.png') ? base.png() : base.jpeg({ quality: 70 });
  const withMeta = spec.orientation
    ? encoded.withMetadata({ orientation: spec.orientation })
    : encoded;
  await writeFile(target, await withMeta.toBuffer());
  return target;
}

/**
 * Writes many small JPEGs with distinct colors and dated file names.
 *
 * @param root - Folder to write into.
 * @param count - Number of images.
 * @param perFolder - Images per subfolder.
 * @returns Relative file names in creation order.
 */
export async function writeImageSet(
  root: string,
  count: number,
  perFolder = 250,
): Promise<string[]> {
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const file = `set-${Math.floor(i / perFolder)}/IMG_202301${day}_${String(i % 1_000_000).padStart(6, '0')}.jpg`;
    await writeImage(root, {
      file,
      width: 32,
      height: 24,
      color: { r: i % 256, g: (i * 7) % 256, b: (i * 13) % 256 },
    });
    files.push(file);
  }
  return files;
}

/**
 * Writes a short test-pattern MP4 with ffmpeg.
 *
 * @param root - Folder to write into.
 * @param file - Relative file name.
 * @param seconds - Duration.
 * @returns The absolute path.
 */
export async function writeVideo(root: string, file: string, seconds = 2): Promise<string> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=160x90:rate=10:duration=${seconds}`,
    '-pix_fmt',
    'yuv420p',
    target,
  ];
  execFileSync(ffmpegPath as unknown as string, args);
  return target;
}
