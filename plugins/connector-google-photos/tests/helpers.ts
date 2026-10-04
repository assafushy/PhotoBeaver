import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SyncBatch } from '@photobeaver/plugin-sdk';
import { writeZip, type ZipInput } from './zip-writer';

export const PHOTOS = 'Takeout/Google Photos';

export interface TempDir {
  root: string;
  cleanup: () => void;
}

export interface SidecarOptions {
  title?: string;
  timestamp?: number;
  geo?: [number, number];
  exif?: [number, number];
  description?: string;
  url?: string;
}

/**
 * Creates an empty temp folder.
 *
 * @returns The folder and a cleanup function.
 */
export function tempDir(): TempDir {
  const root = mkdtempSync(path.join(tmpdir(), 'pb-gphotos-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Writes files under a folder, creating parent folders.
 *
 * @param root - Base folder.
 * @param files - Relative posix path to contents.
 */
export function writeFiles(root: string, files: Record<string, string | Uint8Array>): void {
  for (const [relative, data] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, data);
  }
}

/**
 * Writes a zip file whose members are the given files.
 *
 * @param file - Absolute zip path.
 * @param files - Member path to contents.
 */
export function writeZipFile(file: string, files: Record<string, string>): void {
  const inputs: ZipInput[] = Object.entries(files).map(([name, data]) => ({
    name,
    data,
    method: 8,
    utf8: true,
  }));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, writeZip(inputs));
}

function geo(point: [number, number] | undefined) {
  return { latitude: point?.[0] ?? 0, longitude: point?.[1] ?? 0, altitude: 0 };
}

/**
 * A Google Takeout JSON sidecar.
 *
 * @param options - Fields to set.
 * @returns The JSON text.
 */
export function sidecar(options: SidecarOptions = {}): string {
  return JSON.stringify({
    title: options.title ?? 'photo.jpg',
    description: options.description ?? '',
    imageViews: '3',
    creationTime: { timestamp: '1700000000', formatted: 'Nov 14, 2023' },
    photoTakenTime: { timestamp: String(options.timestamp ?? 1577836800), formatted: 'x' },
    geoData: geo(options.geo),
    geoDataExif: geo(options.exif),
    url: options.url ?? 'https://photos.google.com/photo/AF1Qip',
  });
}

/**
 * Collects every batch from a sync.
 *
 * @param batches - The sync iterator.
 * @returns All batches.
 */
export async function collect(batches: AsyncIterable<SyncBatch>): Promise<SyncBatch[]> {
  const result: SyncBatch[] = [];
  for await (const batch of batches) result.push(batch);
  return result;
}

/**
 * Reads a web stream to text.
 *
 * @param stream - The stream.
 * @returns Its contents as UTF-8.
 */
export async function readText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new Error('No stream');
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
