import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

export interface FixtureDir {
  dir: string;
  file: (name: string) => string;
  cleanup: () => void;
}

/**
 * Creates a temp folder for generated fixtures.
 *
 * @returns The folder, a path helper and a cleanup function.
 */
export function makeFixtureDir(): FixtureDir {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-metadata-'));
  return {
    dir,
    file: (name) => path.join(dir, name),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Writes a 64x32 JPEG with EXIF date, camera, orientation 6 and GPS for Paris.
 *
 * @param file - Output path.
 */
export async function writeParisJpeg(file: string): Promise<void> {
  await sharp({ create: { width: 64, height: 32, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Canon', Model: 'Canon EOS R5', Software: 'Beaver 1.0' },
      IFD2: {
        DateTimeOriginal: '2023:05:01 14:22:33',
        SubSecTimeOriginal: '25',
        OffsetTimeOriginal: '+02:00',
        FNumber: '28/10',
        ExposureTime: '1/250',
        ISOSpeedRatings: '200',
        FocalLength: '50/1',
        LensModel: 'RF50mm F1.8 STM',
        PixelXDimension: '64',
        PixelYDimension: '32',
      },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '48/1 51/1 3024/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '2/1 17/1 4020/100',
      },
    })
    .withMetadata({ orientation: 6 })
    .toFile(file);
}

/**
 * Writes a PNG without any metadata.
 *
 * @param file - Output path.
 */
export async function writePlainPng(file: string): Promise<void> {
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3c3' } })
    .png()
    .toFile(file);
}

/**
 * Runs the bundled ffmpeg to make a short test video.
 *
 * @param file - Output path (the extension picks MP4 or MOV).
 * @param args - Extra output arguments, such as metadata.
 */
export function writeVideo(file: string, args: string[]): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform');
  const input = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '2'];
  const output = ['-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', ...args, file];
  execFileSync(ffmpegPath, ['-v', 'error', '-y', ...input, ...output]);
}

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function xyzBox(iso6709: string): Buffer {
  const text = Buffer.from(iso6709, 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt16BE(text.length, 0);
  prefix.writeUInt16BE(0x15c7, 2);
  return box('©xyz', Buffer.concat([prefix, text]));
}

function lastTopLevelBox(data: Buffer): { type: string; start: number } {
  let offset = 0;
  let last = { type: '', start: 0 };
  while (offset + 8 <= data.length) {
    last = { type: data.toString('latin1', offset + 4, offset + 8), start: offset };
    offset += data.readUInt32BE(offset);
  }
  return last;
}

/**
 * Appends `udta/©xyz` to the `moov` box of an MP4 whose `moov` is the last box,
 * because ffmpeg's MP4 muxer does not write ©xyz.
 *
 * @param file - MP4 path, rewritten in place.
 * @param iso6709 - The location string.
 */
export function injectXyz(file: string, iso6709: string): void {
  const data = readFileSync(file);
  const moov = lastTopLevelBox(data);
  if (moov.type !== 'moov') throw new Error(`Expected moov last, found ${moov.type}`);
  const udta = box('udta', xyzBox(iso6709));
  const result = Buffer.concat([data, udta]);
  result.writeUInt32BE(result.length - moov.start, moov.start);
  writeFileSync(file, result);
}
