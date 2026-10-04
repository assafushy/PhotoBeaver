import { createHash } from 'node:crypto';
import { openSync, closeSync, writeSync, ftruncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashFile } from '../src/hashes/content';
import { DropboxContentHasher } from '../src/hashes/dropbox';
import { QuickXorHasher } from '../src/hashes/quickxor';
import { SAMPLE_BYTES, sampleHash, sampleOffsets, usesSampledHash } from '../src/hashes/vsample';
import { random, tempDir } from './helpers';

const MIB = 1024 * 1024;
const temp = tempDir();
afterAll(() => temp.cleanup());

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

function referenceDropbox(bytes: Uint8Array): string {
  const blocks: Buffer[] = [];
  for (let start = 0; start < bytes.length; start += 4 * MIB)
    blocks.push(sha256(bytes.subarray(start, start + 4 * MIB)));
  return sha256(Buffer.concat(blocks)).toString('hex');
}

function referenceQuickXor(bytes: Uint8Array): string {
  const mask = (1n << 160n) - 1n;
  let register = 0n;
  bytes.forEach((byte, n) => {
    const shifted = BigInt(byte) << BigInt((n * 11) % 160);
    register ^= (shifted | (shifted >> 160n)) & mask;
  });
  const out = Buffer.alloc(20);
  for (let i = 0; i < 20; i += 1) out[i] = Number((register >> BigInt(8 * i)) & 0xffn);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length));
  for (let i = 0; i < 8; i += 1) out[12 + i]! ^= length[i]!;
  return out.toString('base64');
}

function randomBytes(length: number, seed: number): Buffer {
  const next = random(seed);
  return Buffer.from(Array.from({ length }, () => Math.floor(next() * 256)));
}

function feedInChunks<T extends { update(c: Uint8Array): void }>(
  hasher: T,
  bytes: Uint8Array,
  size: number,
): T {
  for (let start = 0; start < bytes.length; start += size)
    hasher.update(bytes.subarray(start, start + size));
  return hasher;
}

describe('sha256 via hashFile', () => {
  it('matches the FIPS 180-2 "abc" vector', async () => {
    const file = path.join(temp.dir, 'abc.bin');
    writeFileSync(file, 'abc');
    const digest = await hashFile(file);
    expect(digest.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('Dropbox content hash', () => {
  it('hashes empty input as sha256 of nothing', () => {
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(new DropboxContentHasher().digest()).toBe(expected);
    expect(referenceDropbox(new Uint8Array())).toBe(expected);
  });

  it('hashes a small input as sha256 of its single block digest', () => {
    const bytes = Buffer.from('Photo Beaver');
    const expected = sha256(sha256(bytes)).toString('hex');
    expect(feedInChunks(new DropboxContentHasher(), bytes, 5).digest()).toBe(expected);
  });

  it('matches the reference across 4 MiB block boundaries with odd chunking', () => {
    const bytes = randomBytes(9 * MIB + 123, 7);
    const expected = referenceDropbox(bytes);
    expect(feedInChunks(new DropboxContentHasher(), bytes, 1_000_003).digest()).toBe(expected);
    expect(feedInChunks(new DropboxContentHasher(), bytes, 4 * MIB).digest()).toBe(expected);
  });
});

describe('QuickXorHash', () => {
  const published: [string, string][] = [
    ['', 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='],
    ['Sg==', 'SgAAAAAAAAAAAAAAAQAAAAAAAAA='],
    ['tbQ=', 'taAFAAAAAAAAAAAAAgAAAAAAAAA='],
    ['0pZP', '0rDEEwAAAAAAAAAAAwAAAAAAAAA='],
    ['jRRDVA==', 'jaDAEKgAAAAAAAAABAAAAAAAAAA='],
    ['luBZlaT6', 'lgBHFipBCn0AAAAABgAAAAAAAAA='],
  ];

  it.each(published)('matches the published vector for %s', (input, expected) => {
    const bytes = Buffer.from(input, 'base64');
    expect(feedInChunks(new QuickXorHasher(), bytes, 1).digest()).toBe(expected);
    expect(referenceQuickXor(bytes)).toBe(expected);
  });

  it.each([1, 7, 160, 161, 4096])(
    'matches the bit-level reference with %i-byte chunks',
    (chunk) => {
      const bytes = randomBytes(5000, chunk);
      expect(feedInChunks(new QuickXorHasher(), bytes, chunk).digest()).toBe(
        referenceQuickXor(bytes),
      );
    },
  );

  it('agrees with hashFile on a file', async () => {
    const bytes = randomBytes(70_000, 3);
    const file = path.join(temp.dir, 'random.bin');
    writeFileSync(file, bytes);
    const digest = await hashFile(file);
    expect(digest.quickxor).toBe(referenceQuickXor(bytes));
    expect(digest.dropbox).toBe(referenceDropbox(bytes));
  });
});

describe('sampled video hash', () => {
  it('samples first, middle and last MiB', () => {
    expect(sampleOffsets(10 * MIB)).toEqual([0, 4.5 * MIB, 9 * MIB]);
    expect(sampleOffsets(100)).toEqual([0, 0, 0]);
  });

  it('only applies to videos above the threshold', () => {
    expect(usesSampledHash('video', 201 * MIB)).toBe(true);
    expect(usesSampledHash('video', 200 * MIB)).toBe(false);
    expect(usesSampledHash('image', 300 * MIB)).toBe(false);
    expect(usesSampledHash('video', 2 * MIB, MIB)).toBe(true);
  });

  it('hashes the size and the three samples of a sparse file', async () => {
    const file = path.join(temp.dir, 'sparse.mp4');
    const size = 201 * MIB;
    const fd = openSync(file, 'w');
    ftruncateSync(fd, size);
    writeSync(fd, Buffer.from('tail'), 0, 4, size - 4);
    closeSync(fd);
    const tail = Buffer.alloc(SAMPLE_BYTES);
    tail.write('tail', SAMPLE_BYTES - 4);
    const zeros = Buffer.alloc(SAMPLE_BYTES);
    const expected = createHash('sha256')
      .update(`${size}\n`)
      .update(zeros)
      .update(zeros)
      .update(tail);
    expect(await sampleHash(file)).toBe(expected.digest('hex'));
  });
});
