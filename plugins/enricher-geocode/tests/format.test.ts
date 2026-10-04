import { describe, expect, it } from 'vitest';
import { decodeDataset, encodeDataset, packDataset, unpackDataset } from '../src/format';
import { syntheticDataset } from './helpers';

const dataset = syntheticDataset([
  { name: 'Paris', lat: 48.8534, lon: 2.3488, country: 0, admin1: 0, population: 2_138_551 },
  { name: 'Zürich-ish 東京', lat: -12.5, lon: -179.9999, country: 1, admin1: -1, population: 0 },
  { name: 'Levuka', lat: -18.0667, lon: 179.3167, country: 1, admin1: 1, population: 8360 },
]);

describe('dataset format', () => {
  it('round-trips through encode and decode', () => {
    expect(decodeDataset(encodeDataset(dataset))).toEqual(dataset);
  });

  it('round-trips through pack and unpack', () => {
    expect(unpackDataset(packDataset(dataset))).toEqual(dataset);
  });

  it('round-trips an empty dataset', () => {
    const empty = syntheticDataset([]);
    expect(decodeDataset(encodeDataset({ ...empty, countries: [], admin1: [] }))).toEqual({
      ...empty,
      countries: [],
      admin1: [],
    });
  });

  it('decodes bytes that are not 4-byte aligned', () => {
    const encoded = encodeDataset(dataset);
    const shifted = new Uint8Array(encoded.byteLength + 1);
    shifted.set(encoded, 1);
    expect(decodeDataset(shifted.subarray(1))).toEqual(dataset);
  });

  it('rejects foreign and truncated bytes', () => {
    const encoded = encodeDataset(dataset);
    expect(() => decodeDataset(new Uint8Array(64))).toThrow(/Not a Photo Beaver/);
    expect(() => decodeDataset(encoded.subarray(0, encoded.byteLength - 3))).toThrow(/truncated/);
    expect(() => decodeDataset(encoded.subarray(0, 8))).toThrow(/truncated/);
  });

  it('rejects mismatched column lengths', () => {
    const broken = { ...dataset, cities: { ...dataset.cities, population: new Int32Array(1) } };
    expect(() => encodeDataset(broken)).toThrow(/population/);
  });
});
