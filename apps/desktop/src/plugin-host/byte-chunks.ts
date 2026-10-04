export const MAX_CHUNK_BYTES = 1024 * 1024;

/**
 * Re-chunks a byte stream into pieces of at most 1 MB for the RPC transport (SPEC 6.5).
 *
 * @param stream - Plugin-provided stream.
 * @returns Chunks to send.
 */
export async function* byteChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_CHUNK_BYTES) {
      yield chunk.subarray(offset, offset + MAX_CHUNK_BYTES);
    }
  }
}
