export const SUPPLEMENTAL = '.supplemental-metadata';
export const MIN_CLIPPED_LENGTH = 40;

const JSON_SUFFIX = /\.json$/i;
const COPY_SUFFIX = /^(.*)(\(\d+\))$/s;
const COPY_IN_NAME = /^(.*?)(\(\d+\))(\.[^.]*)?$/s;
const EDITED =
  /^(.*)-(edited|bearbeitet|modifié|editado|modificato|bewerkt|redigeret)(\.[^.]*)?$/isu;

interface SidecarName {
  file: string;
  stem: string;
  copy: string;
}

interface Candidate {
  base: string;
  copy: string;
}

export interface SidecarIndex {
  readonly names: readonly SidecarName[];
}

function parseSidecar(file: string): SidecarName {
  const withoutJson = file.replace(JSON_SUFFIX, '');
  const match = COPY_SUFFIX.exec(withoutJson);
  return match ? { file, stem: match[1]!, copy: match[2]! } : { file, stem: withoutJson, copy: '' };
}

/**
 * Indexes the JSON files of one folder for sidecar lookups.
 *
 * @param fileNames - File names (not paths) in the folder.
 * @returns The index. Non-JSON names are ignored.
 */
export function indexSidecars(fileNames: readonly string[]): SidecarIndex {
  return { names: fileNames.filter((name) => JSON_SUFFIX.test(name)).map(parseSidecar) };
}

function exactMatch(sidecar: SidecarName, candidate: Candidate): boolean {
  const { base } = candidate;
  return sidecar.stem === base || sidecar.stem === `${base}${SUPPLEMENTAL}`;
}

function clippedMatch(sidecar: SidecarName, candidate: Candidate): boolean {
  const { stem } = sidecar;
  const { base } = candidate;
  if (stem.length > base.length && `${base}${SUPPLEMENTAL}`.startsWith(stem)) return true;
  return stem.length >= MIN_CLIPPED_LENGTH && stem.length < base.length && base.startsWith(stem);
}

function uneditedName(name: string): string | null {
  const match = EDITED.exec(name);
  return match ? `${match[1]!}${match[3] ?? ''}` : null;
}

function candidatesFor(name: string): Candidate[] {
  const candidates: Candidate[] = [{ base: name, copy: '' }];
  const copy = COPY_IN_NAME.exec(name);
  if (copy) candidates.push({ base: `${copy[1]!}${copy[3] ?? ''}`, copy: copy[2]! });
  return candidates;
}

type Matcher = (sidecar: SidecarName, candidate: Candidate) => boolean;

function findWith(index: SidecarIndex, candidates: Candidate[], matcher: Matcher) {
  for (const candidate of candidates) {
    const found = index.names.find(
      (sidecar) => sidecar.copy === candidate.copy && matcher(sidecar, candidate),
    );
    if (found) return found.file;
  }
  return undefined;
}

function findFor(index: SidecarIndex, name: string): string | undefined {
  const candidates = candidatesFor(name);
  const copyFirst = [...candidates].reverse();
  return findWith(index, candidates, exactMatch) ?? findWith(index, copyFirst, clippedMatch);
}

/**
 * Finds the Google Takeout JSON sidecar of a media file in the same folder. Handles
 * `<name>.supplemental-metadata.json`, the older `<name>.json`, names clipped to
 * 46 characters before `.json`, copies (`IMG(1).jpg` uses
 * `IMG.jpg.supplemental-metadata(1).json` or `IMG.jpg(1).json`), and `-edited`
 * copies, which use the original's sidecar.
 *
 * @param index - Sidecars of the folder.
 * @param mediaName - Media file name (not a path).
 * @returns The sidecar file name, or undefined when there is none.
 */
export function findSidecar(index: SidecarIndex, mediaName: string): string | undefined {
  const direct = findFor(index, mediaName);
  if (direct) return direct;
  const original = uneditedName(mediaName);
  return original ? findFor(index, original) : undefined;
}
