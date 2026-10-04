import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssetView } from '@photobeaver/plugin-sdk';
import { PNG } from 'pngjs';
import type { RgbImage } from '../src/image/rgb';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures');

export function tempDir(prefix = 'pb-faces-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function imageOf(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number],
): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) data.set(color(x, y), (y * width + x) * 3);
  return { width, height, data };
}

export function encodePng(image: RgbImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  for (let i = 0; i < image.width * image.height; i += 1) {
    png.data.set(image.data.subarray(i * 3, i * 3 + 3), i * 4);
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

export async function writePng(dir: string, name: string, image: RgbImage): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, encodePng(image));
  return file;
}

export function asset(id: string): AssetView {
  return { id, kind: 'image', mime: 'image/jpeg', instances: [], enrichments: {} };
}
