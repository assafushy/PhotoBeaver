import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = 0x31474250;
const VERSION = 1;
const HEADER_INTS = 6;
const INT_BYTES = 4;

export const CITY_COLUMNS = ['latE4', 'lonE4', 'country', 'admin1', 'population'] as const;

export type CityColumnName = (typeof CITY_COLUMNS)[number];

export interface CountryRecord {
  code: string;
  name: string;
}

export interface Admin1Record {
  key: string;
  name: string;
}

export interface CityTable extends Record<CityColumnName, Int32Array> {
  names: string[];
}

export interface GeoDataset {
  countries: CountryRecord[];
  admin1: Admin1Record[];
  cities: CityTable;
}

interface Header {
  cityCount: number;
  countryCount: number;
  admin1Count: number;
  textBytes: number;
}

function textLines(dataset: GeoDataset): string[] {
  return [
    ...dataset.countries.map((country) => `${country.code}\t${country.name}`),
    ...dataset.admin1.map((admin1) => `${admin1.key}\t${admin1.name}`),
    ...dataset.cities.names,
  ];
}

function assertColumnLengths(cities: CityTable): void {
  for (const column of CITY_COLUMNS) {
    if (cities[column].length !== cities.names.length) {
      throw new Error(`City column ${column} has the wrong length`);
    }
  }
}

function headerInts(dataset: GeoDataset, textBytes: number): number[] {
  const { cities, countries, admin1 } = dataset;
  return [MAGIC, VERSION, cities.names.length, countries.length, admin1.length, textBytes];
}

/**
 * Encodes a dataset into the uncompressed binary layout: six int32 header
 * values, one int32 column per city field, then newline separated UTF-8 text
 * (country lines, admin1 lines, city names). Integers use the platform byte
 * order, which is little-endian on every platform Photo Beaver supports.
 *
 * @param dataset - Countries, admin1 regions and city columns.
 * @returns The encoded bytes.
 * @throws Error when a city column length differs from the number of names.
 */
export function encodeDataset(dataset: GeoDataset): Uint8Array {
  assertColumnLengths(dataset.cities);
  const text = new TextEncoder().encode(textLines(dataset).join('\n'));
  const count = dataset.cities.names.length;
  const ints = new Int32Array(HEADER_INTS + CITY_COLUMNS.length * count);
  ints.set(headerInts(dataset, text.byteLength));
  CITY_COLUMNS.forEach((column, i) => ints.set(dataset.cities[column], HEADER_INTS + i * count));
  const bytes = new Uint8Array(ints.byteLength + text.byteLength);
  bytes.set(new Uint8Array(ints.buffer), 0);
  bytes.set(text, ints.byteLength);
  return bytes;
}

function alignedBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset % INT_BYTES === 0 ? bytes : bytes.slice();
}

function readHeader(bytes: Uint8Array): Header {
  if (bytes.byteLength < HEADER_INTS * INT_BYTES) throw new Error('Geocode dataset is truncated');
  const ints = new Int32Array(bytes.buffer, bytes.byteOffset, HEADER_INTS);
  if (ints[0] !== MAGIC) throw new Error('Not a Photo Beaver geocode dataset');
  if (ints[1] !== VERSION) throw new Error(`Unsupported geocode dataset version ${ints[1]}`);
  return {
    cityCount: ints[2]!,
    countryCount: ints[3]!,
    admin1Count: ints[4]!,
    textBytes: ints[5]!,
  };
}

function textOffset(header: Header): number {
  return (HEADER_INTS + CITY_COLUMNS.length * header.cityCount) * INT_BYTES;
}

function readColumns(bytes: Uint8Array, count: number): Record<CityColumnName, Int32Array> {
  const start = bytes.byteOffset + HEADER_INTS * INT_BYTES;
  const entries = CITY_COLUMNS.map((column, i) => [
    column,
    new Int32Array(bytes.buffer, start + i * count * INT_BYTES, count),
  ]);
  return Object.fromEntries(entries) as Record<CityColumnName, Int32Array>;
}

function readLines(bytes: Uint8Array, header: Header): string[] {
  const offset = textOffset(header);
  if (bytes.byteLength !== offset + header.textBytes) {
    throw new Error('Geocode dataset is truncated');
  }
  const text = new TextDecoder().decode(bytes.subarray(offset));
  const lines = header.textBytes === 0 ? [] : text.split('\n');
  if (lines.length !== header.countryCount + header.admin1Count + header.cityCount) {
    throw new Error('Geocode dataset text does not match its header');
  }
  return lines;
}

function splitPair(line: string): [string, string] {
  const tab = line.indexOf('\t');
  return [line.slice(0, tab), line.slice(tab + 1)];
}

function readTables(lines: string[], header: Header): Omit<GeoDataset, 'cities'> {
  const admin1End = header.countryCount + header.admin1Count;
  const countries = lines.slice(0, header.countryCount).map(splitPair);
  const admin1 = lines.slice(header.countryCount, admin1End).map(splitPair);
  return {
    countries: countries.map(([code, name]) => ({ code, name })),
    admin1: admin1.map(([key, name]) => ({ key, name })),
  };
}

/**
 * Decodes bytes written by {@link encodeDataset}. City columns are views over
 * the given bytes, so decoding copies nothing but the text.
 *
 * @param input - Uncompressed dataset bytes.
 * @returns The dataset.
 * @throws Error when the bytes are not a supported, complete dataset.
 */
export function decodeDataset(input: Uint8Array): GeoDataset {
  const bytes = alignedBytes(input);
  const header = readHeader(bytes);
  const lines = readLines(bytes, header);
  const names = lines.slice(header.countryCount + header.admin1Count);
  return {
    ...readTables(lines, header),
    cities: { names, ...readColumns(bytes, header.cityCount) },
  };
}

/**
 * Encodes and gzips a dataset, ready to write to `assets/cities.bin.gz`.
 *
 * @param dataset - The dataset.
 * @returns Gzipped bytes.
 */
export function packDataset(dataset: GeoDataset): Uint8Array {
  return gzipSync(encodeDataset(dataset), { level: 9 });
}

/**
 * Gunzips and decodes a dataset written by {@link packDataset}.
 *
 * @param gzipped - Gzipped dataset bytes.
 * @returns The dataset.
 */
export function unpackDataset(gzipped: Uint8Array): GeoDataset {
  return decodeDataset(gunzipSync(gzipped));
}
