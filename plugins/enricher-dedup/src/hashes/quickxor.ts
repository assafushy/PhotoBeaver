const WIDTH_BITS = 160;
const WIDTH_BYTES = WIDTH_BITS / 8;
const SHIFT = 11;
const LENGTH_BYTES = 8;

/**
 * Incremental OneDrive QuickXorHash. Byte n of the input is XORed into a
 * 160-bit circular register at bit offset (11 * n) mod 160, then the 64-bit
 * little-endian input length is XORed into the last 8 bytes.
 */
export class QuickXorHasher {
  private readonly register = new Uint8Array(WIDTH_BYTES);
  private length = 0;

  /**
   * Feeds the next bytes of the file.
   *
   * @param chunk - Bytes in file order.
   */
  update(chunk: Uint8Array): void {
    const lanes = foldIntoLanes(chunk);
    const count = Math.min(chunk.length, WIDTH_BITS);
    for (let lane = 0; lane < count; lane += 1) {
      const offset = (SHIFT * (this.length + lane)) % WIDTH_BITS;
      xorByteAt(this.register, lanes[lane]!, offset);
    }
    this.length += chunk.length;
  }

  /**
   * Finishes the hash.
   *
   * @returns The QuickXorHash as base64, as OneDrive reports it.
   */
  digest(): string {
    const out = Uint8Array.from(this.register);
    const lengthBytes = Buffer.alloc(LENGTH_BYTES);
    lengthBytes.writeBigUInt64LE(BigInt(this.length));
    for (let i = 0; i < LENGTH_BYTES; i += 1)
      out[WIDTH_BYTES - LENGTH_BYTES + i]! ^= lengthBytes[i]!;
    return Buffer.from(out).toString('base64');
  }
}

function foldIntoLanes(chunk: Uint8Array): Uint8Array {
  const lanes = new Uint8Array(WIDTH_BITS);
  for (let i = 0; i < chunk.length; i += 1) lanes[i % WIDTH_BITS]! ^= chunk[i]!;
  return lanes;
}

function xorByteAt(register: Uint8Array, value: number, bitOffset: number): void {
  const index = bitOffset >> 3;
  const shift = bitOffset & 7;
  register[index]! ^= (value << shift) & 0xff;
  if (shift > 0) register[(index + 1) % WIDTH_BYTES]! ^= value >> (8 - shift);
}
