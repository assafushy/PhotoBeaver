import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { openArchive, type ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import { writeHashed } from './hash';
import type { ModelFile } from './source';

function findEntry(tree: ArchiveTree, name: string): string {
  const entry = tree.entries().find((e) => path.posix.basename(e.path) === name);
  if (!entry) throw new Error(`Model archive has no ${name}`);
  return entry.path;
}

async function extractOne(tree: ArchiveTree, file: ModelFile, dir: string): Promise<void> {
  const target = path.join(dir, file.name);
  const partial = `${target}.partial`;
  const hash = await writeHashed(await tree.open(findEntry(tree, file.name)), partial);
  if (hash !== file.sha256) {
    await rm(partial, { force: true });
    throw new Error(`${file.name} does not match its expected SHA-256`);
  }
  await rename(partial, target);
}

/**
 * Extracts model files from a zip by file name, checks each one's SHA-256 and
 * moves it into place only when it matches.
 *
 * @param zipFile - The downloaded archive.
 * @param files - Files to extract.
 * @param dir - Models folder.
 * @throws Error when a file is missing or its hash does not match.
 */
export async function extractModels(
  zipFile: string,
  files: ModelFile[],
  dir: string,
): Promise<void> {
  const tree = await openArchive(zipFile);
  try {
    for (const file of files) await extractOne(tree, file, dir);
  } finally {
    await tree.close();
  }
}
