import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Appends JSON values, one per line.
 *
 * @param file - JSON lines file (created with its folder when missing).
 * @param values - Values to append.
 */
export async function appendJsonLines(file: string, values: unknown[]): Promise<void> {
  if (values.length === 0) return;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, values.map((v) => `${JSON.stringify(v)}\n`).join(''));
}

function parseLine<T>(line: string): T[] {
  try {
    return [JSON.parse(line) as T];
  } catch {
    return [];
  }
}

/**
 * Reads every parseable line of a JSON lines file. A missing file reads as empty,
 * and a torn last line is ignored.
 *
 * @param file - JSON lines file.
 * @returns Parsed values in file order.
 */
export async function readJsonLines<T>(file: string): Promise<T[]> {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => parseLine<T>(line));
}

/**
 * Replaces a JSON lines file atomically.
 *
 * @param file - JSON lines file.
 * @param values - Values to write, one per line.
 */
export async function writeJsonLines(file: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, values.map((v) => `${JSON.stringify(v)}\n`).join(''));
  await rename(temp, file);
}
