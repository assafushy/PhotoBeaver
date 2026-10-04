import { precedenceOf } from './capture-date';

export type LocationSource = 'user' | 'exif' | 'source' | 'enricher';

export interface Located {
  lat: number;
  lon: number;
  source: LocationSource;
}

/**
 * Location precedence (SPEC 6.3): a proposal replaces the stored value only if
 * its source ranks at least as high.
 *
 * @param current - Stored location, if any.
 * @param proposal - Candidate, if any.
 * @returns The location to store.
 */
export function pickLocation(current: Located | null, proposal: Located | null): Located | null {
  if (!proposal) return current;
  if (!current) return proposal;
  return precedenceOf(proposal.source) >= precedenceOf(current.source) ? proposal : current;
}
