import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeGeoPhoto, writeResizedCopy } from './generate';

export const PARIS = { lat: 48.8584, lon: 2.2945 };
export const TOKYO = { lat: 35.6812, lon: 139.7671 };

/**
 * Writes the M3 enrichment fixture set: two Paris photos and one Tokyo photo
 * with EXIF dates and GPS, one file copied into two folders, a resized copy,
 * and a burst pair that must not be merged.
 *
 * @param root - Folder to write into.
 */
export async function writeEnrichmentSet(root: string): Promise<void> {
  await writeGeoPhoto(root, {
    file: 'trip/paris-1.jpg',
    seed: 11,
    date: '2023:05:01 14:22:33',
    ...PARIS,
  });
  await writeGeoPhoto(root, {
    file: 'trip/paris-2.jpg',
    seed: 12,
    date: '2023:05:02 10:00:00',
    lat: 48.8867,
    lon: 2.3431,
  });
  await writeGeoPhoto(root, {
    file: 'trip/tokyo.jpg',
    seed: 13,
    date: '2024:03:03 09:00:00',
    ...TOKYO,
  });
  await writeGeoPhoto(root, { file: 'a/same.jpg', seed: 14, date: '2022:01:01 12:00:00' });
  mkdirSync(path.join(root, 'b'));
  copyFileSync(path.join(root, 'a/same.jpg'), path.join(root, 'b/same.jpg'));
  await writeGeoPhoto(root, {
    file: 'big/original.jpg',
    seed: 15,
    date: '2021:06:06 06:06:06',
    width: 640,
    height: 480,
  });
  await writeResizedCopy(
    path.join(root, 'big/original.jpg'),
    path.join(root, 'small/resized.jpg'),
    320,
  );
  await writeGeoPhoto(root, { file: 'burst/1.jpg', seed: 16, date: '2020:02:02 02:02:02' });
  await writeGeoPhoto(root, {
    file: 'burst/2.jpg',
    seed: 16,
    variant: 1,
    date: '2020:02:02 02:02:03',
  });
}
