import { describe, expect, it } from 'vitest';
import { parseMediaUrl } from '../../src/main/protocol/media-url';
import { parseRange } from '../../src/main/protocol/range';

const ID = '01K6P4J2Z9X8W7V6T5S4R3Q2P1';

describe('parseMediaUrl', () => {
  it('accepts thumbnail and original URLs', () => {
    expect(parseMediaUrl(`pb-media://thumb/${ID}/256`)).toEqual({
      kind: 'thumb',
      assetId: ID,
      size: 256,
    });
    expect(parseMediaUrl(`pb-media://thumb/${ID.toLowerCase()}/1024?v=3`)).toEqual({
      kind: 'thumb',
      assetId: ID,
      size: 1024,
    });
    expect(parseMediaUrl(`pb-media://original/${ID}`)).toEqual({ kind: 'original', assetId: ID });
  });

  it.each([
    `pb-media://thumb/${ID}/512`,
    `pb-media://thumb/../../etc/passwd/256`,
    `pb-media://original/${ID}/extra`,
    `pb-media://other/${ID}`,
    `file:///thumb/${ID}/256`,
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseMediaUrl(url)).toBeNull();
  });
});

describe('parseRange', () => {
  it('parses open, closed and suffix ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });

  it('rejects unsatisfiable or malformed ranges', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=20-10', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});
