import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { isMergeBlocked, mergeAssets, type MergeResult } from '../assets/merge';
import { unmergeAssets } from '../assets/unmerge';
import type { EventSink } from '../events/event-sink';
import type { EnrichScheduler } from './enrich-scheduler';
import { storeSuggestions } from './identity';
import { readFlag } from './plugin-settings';

export const ALWAYS_ASK_KEY = 'duplicates.alwaysAsk';

/**
 * Applies merges (SPEC 4.3, 6.3): plugin `mergeWith` requests skip never-merge
 * pairs and become suggestions when the user chose "always ask"; every merge
 * and unmerge re-plans enrichment for the assets involved.
 */
export class MergeService {
  constructor(
    private readonly db: LibraryDb,
    private readonly scheduler: EnrichScheduler,
    private readonly events: EventSink,
    private readonly now: () => number,
  ) {}

  /**
   * Handles a plugin's `mergeWith` for one asset.
   *
   * @param assetId - Asset the plugin enriched.
   * @param others - Assets it says are the same media.
   * @param pluginId - Requesting plugin.
   * @returns Merges performed.
   */
  requested(assetId: string, others: readonly string[], pluginId: string): MergeResult[] {
    const candidates = others.filter(
      (id) => id !== assetId && this.exists(id) && !isMergeBlocked(this.db, assetId, id),
    );
    if (candidates.length === 0) return [];
    if (readFlag(this.db, ALWAYS_ASK_KEY, false)) {
      storeSuggestions(
        this.db,
        pluginId,
        candidates.map((id) => ({ assetIds: [assetId, id], kind: 'exact', confidence: 1 })),
        this.now(),
      );
      this.events.emit('library.changed', {});
      return [];
    }
    return this.mergeChain(assetId, candidates, pluginId);
  }

  /**
   * Merges assets the user picked, keeping one.
   *
   * @param assetIds - Assets to merge.
   * @param keepId - The one to keep.
   * @returns The merges.
   */
  mergeByUser(assetIds: readonly string[], keepId: string): MergeResult[] {
    const results = assetIds
      .filter((id) => id !== keepId && this.exists(id))
      .map((id) => mergeAssets(this.db, keepId, id, 'user', this.now(), { survivorId: keepId }));
    this.afterMerge([keepId]);
    return results;
  }

  /**
   * Undoes a merge (SPEC 4.3 step 5) and re-plans both assets.
   *
   * @param mergeId - asset_merges id.
   */
  undo(mergeId: string): void {
    const { survivingAssetId, restoredAssetId } = unmergeAssets(this.db, mergeId, this.now());
    this.afterMerge([survivingAssetId, restoredAssetId]);
  }

  private mergeChain(assetId: string, others: readonly string[], pluginId: string): MergeResult[] {
    const results: MergeResult[] = [];
    let current = assetId;
    for (const other of others) {
      if (!this.exists(other) || !this.exists(current)) continue;
      const result = mergeAssets(this.db, current, other, pluginId, this.now());
      current = result.survivingAssetId;
      results.push(result);
    }
    if (results.length > 0) this.afterMerge([current]);
    return results;
  }

  private afterMerge(assetIds: readonly string[]): void {
    this.scheduler.contentChanged(assetIds);
    this.events.emit('library.changed', {});
  }

  private exists(assetId: string): boolean {
    return (
      this.db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(eq(schema.assets.id, assetId))
        .get() !== undefined
    );
  }
}
