import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { EnrichInput, EnrichInputOptions } from '@photobeaver/plugin-sdk';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { OriginalCache } from '../originals/original-cache';
import { thumbPath } from '../thumbnails/thumb-paths';
import type { EnricherManifest } from './types';

export interface InputRequest {
  manifest: EnricherManifest;
  assetId: string;
  options: EnrichInputOptions;
  signal: AbortSignal;
  tempFiles: string[];
}

function inputKind(
  manifest: EnricherManifest,
  options: EnrichInputOptions,
): 'thumbnail' | 'original' {
  if (options.input) return options.input;
  if (manifest.enricher.input === 'metadata')
    throw new Error('This enricher declared input "metadata", so it has no file input');
  return manifest.enricher.input;
}

function assertAllowed(manifest: EnricherManifest, kind: 'thumbnail' | 'original'): void {
  const access = manifest.permissions.originals;
  if (kind === 'original' && access !== 'read')
    throw new Error('This plugin is not allowed to read originals');
  if (kind === 'thumbnail' && access === 'none')
    throw new Error('This plugin is not allowed to read thumbnails');
}

/**
 * Prepares the local file an enricher asks for (SPEC 6.3 "Input bytes come
 * through ctx.getInput"): the 1024 thumbnail, or the original through the
 * original cache, optionally converted to PNG. Access follows `permissions.originals`.
 */
export class InputProvider {
  constructor(
    private readonly db: LibraryDb,
    private readonly thumbsDir: string,
    private readonly originals: OriginalCache,
    private readonly tempDir: string,
  ) {}

  /**
   * Resolves an input file for one asset.
   *
   * @param request - Plugin manifest, asset, options, signal and temp-file list.
   * @returns Local path and MIME type.
   */
  async get(request: InputRequest): Promise<EnrichInput> {
    const kind = inputKind(request.manifest, request.options);
    assertAllowed(request.manifest, kind);
    const source =
      kind === 'thumbnail'
        ? this.thumbnail(request.assetId)
        : await this.original(request.assetId, request.signal);
    if (request.options.format !== 'png') return source;
    return this.toPng(source.path, request.tempFiles);
  }

  private thumbnail(assetId: string): EnrichInput {
    const file = [1024, 256]
      .map((size) => thumbPath(this.thumbsDir, assetId, size as 1024 | 256))
      .find((p) => existsSync(p));
    if (!file) throw new Error('The thumbnail is not ready yet');
    return { path: file, mime: 'image/webp' };
  }

  private async original(assetId: string, signal: AbortSignal): Promise<EnrichInput> {
    const row = this.db
      .select({ mime: schema.assets.mime })
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId))
      .get();
    const file = await this.originals.ensureLocal(assetId, signal);
    return { path: file, mime: row?.mime ?? 'application/octet-stream' };
  }

  private async toPng(source: string, tempFiles: string[]): Promise<EnrichInput> {
    await mkdir(this.tempDir, { recursive: true });
    const target = path.join(this.tempDir, `${randomUUID()}.png`);
    tempFiles.push(target);
    const bytes = await readFile(source);
    await sharp(bytes, { failOn: 'none' }).rotate().png().toFile(target);
    return { path: target, mime: 'image/png' };
  }
}
