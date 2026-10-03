import { rm } from 'node:fs/promises';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { ThumbUpdate } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';
import { systemClock, type Clock } from '../clock';
import type { CoreLog } from '../connectors/registry';
import { readStream, writeFileAtomic } from '../fs-utils';
import type { JobContext } from '../jobs/lane';
import type { OriginalCache } from '../originals/original-cache';
import type { OriginalSource } from '../originals/original-source';
import { renderThumbnails, type RenderedThumbs } from './render';
import { THUMB_SIZES, thumbPath } from './thumb-paths';
import { extractVideoFrame } from './video-frame';

const MAX_IMAGE_BYTES = 512 * 1024 ** 2;
const SOURCE_THUMB_SIZE = 1024;

type AssetRow = typeof schema.assets.$inferSelect;

export interface ThumbnailDeps {
  db: LibraryDb;
  thumbsDir: string;
  source: OriginalSource;
  cache: OriginalCache;
  ffmpegPath: string;
  logger: CoreLog;
  onReady: (update: ThumbUpdate) => void;
  clock?: Clock;
}

interface Decoded {
  thumbs: RenderedThumbs;
  durationMs: number | null;
}

/**
 * Produces 256 and 1024 WebP thumbnails per asset (SPEC 4.1). Fetch errors are
 * retried by the queue; formats that cannot be decoded mark the asset `failed`.
 */
export class ThumbnailService {
  constructor(private readonly deps: ThumbnailDeps) {}

  /**
   * Job handler for `thumbnail`.
   *
   * @param ctx - The leased job and its abort signal.
   */
  run = async ({ job, signal }: JobContext): Promise<void> => {
    const asset = job.asset_id ? this.load(job.asset_id) : undefined;
    if (!asset) return;
    const decoded =
      asset.mediaType === 'video'
        ? await this.decodeVideo(asset, signal)
        : await this.decodeImage(asset, signal);
    if (decoded) await this.store(asset, decoded);
  };

  /**
   * Deletes all thumbnail files of an asset.
   *
   * @param assetId - Asset id.
   */
  async remove(assetId: string): Promise<void> {
    await Promise.all(
      THUMB_SIZES.map((size) => rm(thumbPath(this.deps.thumbsDir, assetId, size), { force: true })),
    );
  }

  private async decodeImage(asset: AssetRow, signal: AbortSignal): Promise<Decoded | null> {
    const stream =
      (await this.deps.source.thumbnail({
        assetId: asset.id,
        signal,
        thumbnailSize: SOURCE_THUMB_SIZE,
      })) ?? (await this.deps.source.original({ assetId: asset.id, signal }));
    const bytes = await readStream(stream, MAX_IMAGE_BYTES);
    return this.decodeOrFail(asset, async () => ({
      thumbs: await renderThumbnails(bytes),
      durationMs: null,
    }));
  }

  private async decodeVideo(asset: AssetRow, signal: AbortSignal): Promise<Decoded | null> {
    const file = await this.deps.cache.ensureLocal(asset.id, signal);
    return this.decodeOrFail(asset, async () => {
      const frame = await extractVideoFrame(this.deps.ffmpegPath, file, signal);
      return { thumbs: await renderThumbnails(frame.png), durationMs: frame.durationMs };
    });
  }

  private async decodeOrFail(
    asset: AssetRow,
    decode: () => Promise<Decoded>,
  ): Promise<Decoded | null> {
    try {
      return await decode();
    } catch (error) {
      this.deps.logger.warn(
        { err: error, assetId: asset.id, mime: asset.mime },
        'Thumbnail decode failed',
      );
      this.update(asset.id, { thumbState: 'failed' });
      this.deps.onReady({
        id: asset.id,
        width: asset.width,
        height: asset.height,
        thumbState: 'failed',
      });
      return null;
    }
  }

  private async store(asset: AssetRow, decoded: Decoded): Promise<void> {
    for (const [size, buffer] of decoded.thumbs.files) {
      await writeFileAtomic(thumbPath(this.deps.thumbsDir, asset.id, size), buffer);
    }
    const { width, height } = decoded.thumbs;
    this.update(asset.id, {
      thumbState: 'ready',
      width,
      height,
      durationMs: decoded.durationMs ?? asset.durationMs,
    });
    this.deps.onReady({ id: asset.id, width, height, thumbState: 'ready' });
  }

  private update(assetId: string, values: Partial<typeof schema.assets.$inferInsert>): void {
    const updatedAt = (this.deps.clock ?? systemClock)();
    this.deps.db
      .update(schema.assets)
      .set({ ...values, updatedAt })
      .where(eq(schema.assets.id, assetId))
      .run();
  }

  private load(assetId: string): AssetRow | undefined {
    return this.deps.db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  }
}
