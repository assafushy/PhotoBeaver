import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp, { type Sharp } from 'sharp';

export interface ImageSpec {
  file: string;
  width?: number;
  height?: number;
  orientation?: number;
  color?: { r: number; g: number; b: number };
  seed?: number;
}

export interface GeoPhotoSpec {
  file: string;
  seed: number;
  variant?: number;
  date: string;
  lat?: number;
  lon?: number;
  width?: number;
  height?: number;
}

function prng(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/**
 * Raw RGB pixels of a deterministic blocky pattern, so different seeds give
 * visually different images (useful for perceptual hashing).
 *
 * @param seed - Pattern seed.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns Raw pixel buffer.
 */
export function patternPixels(seed: number, width: number, height: number): Buffer {
  const next = prng(seed);
  const cells = Array.from({ length: 64 }, () => [next() * 255, next() * 255, next() * 255]);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[Math.floor((y * 8) / height) * 8 + Math.floor((x * 8) / width)]!;
      pixels.set(cell.map(Math.round), (y * width + x) * 3);
    }
  }
  return pixels;
}

function perturb(pixels: Buffer, variant: number): Buffer {
  for (let i = 0; i < pixels.length; i += 3 * 97) pixels[i] = (pixels[i]! + variant * 9) % 256;
  return pixels;
}

function source(spec: {
  width?: number;
  height?: number;
  seed?: number;
  variant?: number;
  color?: ImageSpec['color'];
}): Sharp {
  const width = spec.width ?? 64;
  const height = spec.height ?? 48;
  if (spec.seed !== undefined) {
    const pixels = perturb(patternPixels(spec.seed, width, height), spec.variant ?? 0);
    return sharp(pixels, { raw: { width, height, channels: 3 } });
  }
  return sharp({
    create: { width, height, channels: 3, background: spec.color ?? { r: 200, g: 120, b: 40 } },
  });
}

function dms(value: number): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  const sec = Math.round(((abs - deg) * 60 - min) * 60 * 100);
  return `${deg}/1 ${min}/1 ${sec}/100`;
}

function gpsIfd(lat?: number, lon?: number): Record<string, string> {
  if (lat === undefined || lon === undefined) return {};
  return {
    GPSLatitudeRef: lat >= 0 ? 'N' : 'S',
    GPSLatitude: dms(lat),
    GPSLongitudeRef: lon >= 0 ? 'E' : 'W',
    GPSLongitude: dms(lon),
  };
}

/**
 * Writes a patterned JPEG with an EXIF capture time and optional GPS position.
 *
 * @param root - Folder to write into.
 * @param spec - File, pattern seed, EXIF date ("YYYY:MM:DD HH:MM:SS") and position.
 * @returns The absolute path.
 */
export async function writeGeoPhoto(root: string, spec: GeoPhotoSpec): Promise<string> {
  const target = path.join(root, spec.file);
  await mkdir(path.dirname(target), { recursive: true });
  const exif = {
    IFD0: { Make: 'Beaver', Model: 'Test Cam' },
    IFD2: { DateTimeOriginal: spec.date },
    IFD3: gpsIfd(spec.lat, spec.lon),
  };
  await source({ ...spec, width: spec.width ?? 320, height: spec.height ?? 240 })
    .jpeg({ quality: 85 })
    .withExif(exif)
    .toFile(target);
  return target;
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
  const base = source(spec);
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
      seed: i + 1,
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

/**
 * Writes a resized, re-encoded copy of an existing photo (a real "resized copy").
 *
 * @param from - Source image.
 * @param to - Target path.
 * @param width - New width.
 * @returns The target path.
 */
export async function writeResizedCopy(from: string, to: string, width: number): Promise<string> {
  await mkdir(path.dirname(to), { recursive: true });
  await sharp(from).resize({ width }).jpeg({ quality: 75 }).toFile(to);
  return to;
}
