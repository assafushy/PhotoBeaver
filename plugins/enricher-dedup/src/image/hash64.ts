export interface Hash64 {
  hi: number;
  lo: number;
}

const HALF = 32;

/**
 * Packs 64 bits (most significant first) into a hash.
 *
 * @param bits - Exactly 64 booleans.
 * @returns The packed hash.
 */
export function packBits(bits: boolean[]): Hash64 {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < HALF; i += 1) {
    hi = ((hi << 1) | (bits[i] ? 1 : 0)) >>> 0;
    lo = ((lo << 1) | (bits[i + HALF] ? 1 : 0)) >>> 0;
  }
  return { hi, lo };
}

/**
 * Formats a hash as 16 lowercase hex digits.
 *
 * @param hash - The hash.
 * @returns Hex string.
 */
export function toHex(hash: Hash64): string {
  return hash.hi.toString(16).padStart(8, '0') + hash.lo.toString(16).padStart(8, '0');
}

/**
 * Parses 16 hex digits.
 *
 * @param hex - Hex string.
 * @returns The hash, or undefined when the text is not 16 hex digits.
 */
export function fromHex(hex: string): Hash64 | undefined {
  if (!/^[0-9a-f]{16}$/i.test(hex)) return undefined;
  return { hi: parseInt(hex.slice(0, 8), 16), lo: parseInt(hex.slice(8), 16) };
}

function popcount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Number of differing bits between two hashes.
 *
 * @param a - First hash.
 * @param b - Second hash.
 * @returns Hamming distance, 0..64.
 */
export function hamming(a: Hash64, b: Hash64): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}
