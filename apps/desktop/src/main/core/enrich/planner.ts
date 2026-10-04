import type { EnricherEntry, EnricherManifest } from './types';

/**
 * Matches a MIME type against manifest `accepts` globs such as `image/*`.
 *
 * @param accepts - Patterns.
 * @param mime - MIME type (null never matches).
 * @returns True when any pattern matches.
 */
export function acceptsMime(accepts: readonly string[], mime: string | null): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return accepts.some((pattern) => {
    const p = pattern.toLowerCase();
    return p === '*/*' || p === lower || (p.endsWith('/*') && lower.startsWith(p.slice(0, -1)));
  });
}

function visit(
  id: string,
  byId: Map<string, EnricherManifest>,
  state: Map<string, 1 | 2>,
  order: string[],
  path: string[],
): void {
  if (state.get(id) === 2) return;
  if (state.get(id) === 1)
    throw new Error(`Enrichers depend on each other in a cycle: ${[...path, id].join(' -> ')}`);
  state.set(id, 1);
  for (const dep of byId.get(id)?.enricher.dependsOn ?? [])
    if (byId.has(dep)) visit(dep, byId, state, order, [...path, id]);
  state.set(id, 2);
  order.push(id);
}

/**
 * Orders enrichers so every plugin comes after the ones it depends on (SPEC 7.5).
 * Dependencies on plugins that are not installed are ignored.
 *
 * @param manifests - Enricher manifests.
 * @returns Plugin ids in run order.
 * @throws Error naming the cycle when dependencies loop.
 */
export function topologicalOrder(manifests: readonly EnricherManifest[]): string[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  for (const manifest of [...manifests].sort((a, b) => a.id.localeCompare(b.id)))
    visit(manifest.id, byId, state, order, []);
  return order;
}

/**
 * The enrichment plan for a MIME type: matching enrichers in dependency order.
 *
 * @param entries - Loaded enrichers.
 * @param mime - Asset MIME type.
 * @returns Entries to run, in order.
 */
export function enrichmentPlan(
  entries: readonly EnricherEntry[],
  mime: string | null,
): EnricherEntry[] {
  const byId = new Map(entries.map((e) => [e.manifest.id, e]));
  return topologicalOrder(entries.map((e) => e.manifest))
    .map((id) => byId.get(id)!)
    .filter((entry) => acceptsMime(entry.manifest.enricher.accepts, mime));
}
