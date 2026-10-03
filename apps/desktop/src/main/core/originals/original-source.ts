import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { ConnectorRegistry } from '../connectors/registry';

const { instances, sources } = schema;

export interface OriginalRequest {
  assetId: string;
  signal: AbortSignal;
  thumbnailSize?: number;
}

/**
 * Fetches media bytes for an asset through the connector of one of its live instances.
 * Enrichers and the thumbnail service never talk to connectors directly.
 */
export class OriginalSource {
  constructor(
    private readonly db: LibraryDb,
    private readonly registry: ConnectorRegistry,
  ) {}

  /**
   * Streams the original bytes.
   *
   * @param request - Asset id and cancellation signal.
   * @returns The byte stream.
   */
  async original(request: OriginalRequest): Promise<ReadableStream<Uint8Array>> {
    const { entry, ctx, ref } = this.resolve(request);
    return entry.plugin.getOriginal(ctx, ref);
  }

  /**
   * Streams a connector-provided thumbnail when the connector offers one.
   *
   * @param request - Asset id, size and signal.
   * @returns The stream, or null when the connector has no thumbnails.
   */
  async thumbnail(
    request: OriginalRequest & { thumbnailSize: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    const { entry, ctx, ref } = this.resolve(request);
    return entry.plugin.getThumbnail
      ? entry.plugin.getThumbnail(ctx, ref, request.thumbnailSize)
      : null;
  }

  private resolve(request: OriginalRequest) {
    const row = this.liveInstance(request.assetId);
    if (!row) throw new Error(`No available copy of asset ${request.assetId}`);
    const entry = this.registry.get(row.pluginId);
    if (!entry) throw new Error(`Connector not installed: ${row.pluginId}`);
    const config = JSON.parse(row.configJson) as unknown;
    const ctx = this.registry.sourceContext(
      { id: row.sourceId, pluginId: row.pluginId, config },
      request.signal,
    );
    const ref = { sourceId: row.sourceId, externalId: row.externalId };
    return { entry, ctx, ref };
  }

  private liveInstance(assetId: string) {
    return this.db
      .select({
        sourceId: instances.sourceId,
        externalId: instances.externalId,
        pluginId: sources.pluginId,
        configJson: sources.configJson,
      })
      .from(instances)
      .innerJoin(sources, eq(sources.id, instances.sourceId))
      .where(and(eq(instances.assetId, assetId), isNull(instances.deletedAt)))
      .orderBy(instances.id)
      .get();
  }
}
