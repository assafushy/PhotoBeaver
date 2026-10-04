import { topologicalOrder } from './planner';
import type { EnricherEntry } from './types';

/**
 * Loaded, enabled enrichers. Adding an enricher that would create a dependency
 * cycle is refused, so the plugin shows "Cannot load" (SPEC 7.5).
 */
export class EnricherRegistry {
  private readonly entries = new Map<string, EnricherEntry>();

  /**
   * Adds or replaces an enricher.
   *
   * @param entry - Manifest and client.
   * @throws Error when its dependencies form a cycle.
   */
  add(entry: EnricherEntry): void {
    const candidate = new Map(this.entries);
    candidate.set(entry.manifest.id, entry);
    topologicalOrder([...candidate.values()].map((e) => e.manifest));
    this.entries.set(entry.manifest.id, entry);
  }

  remove(pluginId: string): void {
    this.entries.delete(pluginId);
  }

  get(pluginId: string): EnricherEntry | undefined {
    return this.entries.get(pluginId);
  }

  list(): EnricherEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Ids of loaded enrichers in a resource class.
   *
   * @param resourceClass - light, cpu-heavy or gpu.
   * @returns Plugin ids.
   */
  idsOfClass(resourceClass: EnricherEntry['manifest']['enricher']['resourceClass']): string[] {
    return this.list()
      .filter((e) => e.manifest.enricher.resourceClass === resourceClass)
      .map((e) => e.manifest.id);
  }
}
