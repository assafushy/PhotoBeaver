import { createHash, type Hash } from 'node:crypto';

export const DROPBOX_BLOCK_SIZE = 4 * 1024 * 1024;

/**
 * Incremental Dropbox content hash: sha256 over the concatenated sha256 digests
 * of each 4 MiB block, as lowercase hex.
 */
export class DropboxContentHasher {
  private readonly overall: Hash = createHash('sha256');
  private block: Hash = createHash('sha256');
  private blockFill = 0;

  /**
   * Feeds the next bytes of the file.
   *
   * @param chunk - Bytes in file order.
   */
  update(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(DROPBOX_BLOCK_SIZE - this.blockFill, chunk.length - offset);
      this.block.update(chunk.subarray(offset, offset + take));
      this.blockFill += take;
      offset += take;
      if (this.blockFill === DROPBOX_BLOCK_SIZE) this.closeBlock();
    }
  }

  /**
   * Finishes the hash.
   *
   * @returns The Dropbox content hash as lowercase hex.
   */
  digest(): string {
    if (this.blockFill > 0) this.closeBlock();
    return this.overall.digest('hex');
  }

  private closeBlock(): void {
    this.overall.update(this.block.digest());
    this.block = createHash('sha256');
    this.blockFill = 0;
  }
}
