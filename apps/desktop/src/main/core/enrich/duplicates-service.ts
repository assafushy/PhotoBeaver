import { schema, type LibraryDb } from '@photobeaver/db';
import type { DuplicateGroup, MergeRecord } from '@photobeaver/shared';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { scopeCondition, sourceVisible, visibleAssetIds, type AccessScope } from '../access/scope';
import { writeAudit } from '../audit';
import type { EventSink } from '../events/event-sink';
import type { MergeService } from './merge-service';

const { assets, instances, sources, duplicateSuggestions, assetMerges, assetTags, tags } = schema;
const RECENT_MERGES = 50;

type GroupAsset = DuplicateGroup['assets'][number];
type SuggestionRow = typeof duplicateSuggestions.$inferSelect;

function placeOf(db: LibraryDb, assetId: string): string | null {
  const row = db
    .select({ name: tags.name })
    .from(assetTags)
    .innerJoin(tags, eq(tags.id, assetTags.tagId))
    .where(and(eq(assetTags.assetId, assetId), eq(tags.kind, 'place')))
    .get();
  return row?.name ?? null;
}

function liveInstancesOf(assetId: string) {
  return and(eq(instances.assetId, assetId), isNull(instances.deletedAt));
}

function largestSizeOf(db: LibraryDb, assetId: string): number | null {
  const row = db
    .select({ size: max(instances.sizeBytes) })
    .from(instances)
    .where(liveInstancesOf(assetId))
    .get();
  return row?.size ?? null;
}

function sourceNamesOf(db: LibraryDb, assetId: string, scope: AccessScope | null): string[] {
  const rows = db
    .selectDistinct({ id: sources.id, name: sources.displayName })
    .from(instances)
    .innerJoin(sources, eq(sources.id, instances.sourceId))
    .where(liveInstancesOf(assetId))
    .all();
  const visible = rows.filter((r) => sourceVisible(scope, r.id));
  return (visible.length ? visible : rows).map((r) => r.name);
}

function groupAsset(db: LibraryDb, assetId: string, scope: AccessScope | null): GroupAsset | null {
  const row = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!row || row.missingSince !== null) return null;
  return {
    id: row.id,
    mediaType: row.mediaType,
    width: row.width,
    height: row.height,
    capturedAt: row.capturedAt,
    sizeBytes: largestSizeOf(db, assetId),
    sources: sourceNamesOf(db, assetId, scope),
    place: placeOf(db, assetId),
  };
}

function allExistingVisible(db: LibraryDb, scope: AccessScope | null, ids: string[]): boolean {
  if (!scope) return true;
  const visible = new Set(visibleAssetIds(db, scope, ids));
  const others = ids.filter((id) => !visible.has(id));
  if (others.length === 0) return true;
  return !db.select({ id: assets.id }).from(assets).where(inArray(assets.id, others)).get();
}

/**
 * The Duplicates screen (SPEC 8.1 #7): open suggestions with what the user needs
 * to compare, user merges and dismissals, and recent merges with undo.
 */
export class DuplicatesService {
  constructor(
    private readonly db: LibraryDb,
    private readonly merges: MergeService,
    private readonly events: EventSink,
    private readonly now: () => number,
  ) {}

  /**
   * Open suggestions whose assets still exist; stale ones are closed. A scoped
   * user sees a group only when every asset in it is visible to them.
   *
   * @param scope - The signed-in user's scope, or null for the whole library.
   * @returns The groups, newest first.
   */
  list(scope: AccessScope | null): DuplicateGroup[] {
    const open = this.db
      .select()
      .from(duplicateSuggestions)
      .where(eq(duplicateSuggestions.status, 'open'))
      .orderBy(desc(duplicateSuggestions.createdAt))
      .all();
    const groups = open.flatMap((row) => this.toGroup(row, scope));
    const ids = groups.flatMap((g) => g.assets.map((a) => a.id));
    const visible = new Set(visibleAssetIds(this.db, scope, ids));
    return groups.filter((g) => g.assets.every((a) => visible.has(a.id)));
  }

  /**
   * Merges a suggestion's assets, keeping the one the user picked.
   *
   * @param id - Suggestion id.
   * @param keepAssetId - Asset to keep.
   * @param userId - Acting user.
   * @param scope - The acting user's scope; every asset must be visible.
   */
  merge(id: string, keepAssetId: string, userId: string, scope: AccessScope | null): void {
    const ids = this.assetIds(id, scope);
    if (!ids.includes(keepAssetId)) throw new Error('Pick one of the suggested photos to keep');
    this.merges.mergeByUser(ids, keepAssetId);
    this.close(id, 'merged');
    writeAudit(
      this.db,
      {
        userId,
        action: 'asset.merge',
        targetType: 'asset',
        targetId: keepAssetId,
        details: { suggestion: id, assets: ids },
      },
      this.now(),
    );
  }

  /**
   * Dismisses a suggestion.
   *
   * @param id - Suggestion id.
   * @param userId - Acting user.
   * @param scope - The acting user's scope; every asset must be visible.
   */
  dismiss(id: string, userId: string, scope: AccessScope | null): void {
    this.assetIds(id, scope);
    this.close(id, 'dismissed');
    writeAudit(
      this.db,
      { userId, action: 'duplicates.dismiss', targetType: 'suggestion', targetId: id },
      this.now(),
    );
  }

  /**
   * The latest merges that can still be undone, whose surviving asset the user can see.
   *
   * @param scope - The signed-in user's scope, or null for the whole library.
   * @returns Merges, newest first.
   */
  recentMerges(scope: AccessScope | null): MergeRecord[] {
    return this.db
      .select({
        id: assetMerges.id,
        survivingAssetId: assetMerges.survivingAssetId,
        mergedBy: assetMerges.mergedBy,
        createdAt: assetMerges.createdAt,
      })
      .from(assetMerges)
      .innerJoin(assets, eq(assets.id, assetMerges.survivingAssetId))
      .where(and(isNull(assetMerges.undoneAt), scopeCondition(scope)))
      .orderBy(desc(assetMerges.createdAt))
      .limit(RECENT_MERGES)
      .all();
  }

  /**
   * Undoes a merge from the Duplicates screen or the viewer (SPEC 4.3 step 5).
   *
   * @param mergeId - asset_merges id.
   * @param userId - Acting user.
   * @param scope - The acting user's scope; the surviving asset must be visible.
   */
  undo(mergeId: string, userId: string, scope: AccessScope | null): void {
    this.assertMergeVisible(mergeId, scope);
    this.merges.undo(mergeId);
    writeAudit(
      this.db,
      { userId, action: 'asset.unmerge', targetType: 'merge', targetId: mergeId },
      this.now(),
    );
  }

  private assertMergeVisible(mergeId: string, scope: AccessScope | null): void {
    if (!scope) return;
    const row = this.db
      .select({ id: assetMerges.id })
      .from(assetMerges)
      .innerJoin(assets, eq(assets.id, assetMerges.survivingAssetId))
      .where(and(eq(assetMerges.id, mergeId), scopeCondition(scope)))
      .get();
    if (!row) throw new Error('Merge not found');
  }

  private toGroup(row: SuggestionRow, scope: AccessScope | null): DuplicateGroup[] {
    const members = (JSON.parse(row.assetIdsJson) as string[])
      .map((id) => groupAsset(this.db, id, scope))
      .filter((a): a is GroupAsset => a !== null);
    if (members.length < 2) return (this.close(row.id, 'merged'), []);
    const { id, kind, confidence, createdAt } = row;
    return [{ id, kind, confidence, createdAt, assets: members }];
  }

  private assetIds(id: string, scope: AccessScope | null): string[] {
    const row = this.db
      .select()
      .from(duplicateSuggestions)
      .where(and(eq(duplicateSuggestions.id, id), eq(duplicateSuggestions.status, 'open')))
      .get();
    const ids = row ? (JSON.parse(row.assetIdsJson) as string[]) : [];
    if (!row || !allExistingVisible(this.db, scope, ids))
      throw new Error('This suggestion is no longer open');
    return ids;
  }

  private close(id: string, status: 'merged' | 'dismissed'): void {
    this.db
      .update(duplicateSuggestions)
      .set({ status })
      .where(eq(duplicateSuggestions.id, id))
      .run();
    this.events.emit('library.changed', {});
  }
}
