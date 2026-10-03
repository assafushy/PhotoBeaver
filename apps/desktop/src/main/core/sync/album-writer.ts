import { schema } from '@photobeaver/db';
import type { AlbumRef } from '@photobeaver/plugin-sdk';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { WriteContext } from './instance-writer';

const { albums, albumAssets } = schema;

function insertAlbum(album: AlbumRef, ctx: WriteContext): string {
  const id = ulid(ctx.now);
  ctx.db
    .insert(albums)
    .values({
      id,
      name: album.name,
      sourceId: ctx.sourceId,
      externalId: album.externalId,
      createdAt: ctx.now,
    })
    .run();
  return id;
}

function upsertAlbum(album: AlbumRef, ctx: WriteContext): string {
  const existing = ctx.db
    .select({ id: albums.id, name: albums.name })
    .from(albums)
    .where(and(eq(albums.sourceId, ctx.sourceId), eq(albums.externalId, album.externalId)))
    .get();
  if (!existing) return insertAlbum(album, ctx);
  if (existing.name !== album.name)
    ctx.db.update(albums).set({ name: album.name }).where(eq(albums.id, existing.id)).run();
  return existing.id;
}

/**
 * Upserts source albums (SPEC 7.4 "upsert albums").
 *
 * @param refs - Albums reported by the connector.
 * @param ctx - Transaction, source and time.
 * @returns Map from album external id to album id.
 */
export function upsertAlbums(refs: readonly AlbumRef[], ctx: WriteContext): Map<string, string> {
  return new Map(refs.map((ref) => [ref.externalId, upsertAlbum(ref, ctx)]));
}

/**
 * Adds an asset to the source albums an item belongs to.
 *
 * @param assetId - Asset id.
 * @param refs - Album refs on the item.
 * @param ctx - Transaction, source and time.
 */
export function linkAssetAlbums(
  assetId: string,
  refs: readonly AlbumRef[],
  ctx: WriteContext,
): void {
  for (const albumId of upsertAlbums(refs, ctx).values()) {
    ctx.db.insert(albumAssets).values({ albumId, assetId }).onConflictDoNothing().run();
  }
}
