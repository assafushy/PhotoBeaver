import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';
import {
  packDataset,
  type Admin1Record,
  type CountryRecord,
  type GeoDataset,
} from '../src/format.ts';

const BASE_URL = 'https://download.geonames.org/export/dump/';
const CITIES_FILE = 'cities1000.txt';
const DATASET_URL = new URL('../assets/cities.bin.gz', import.meta.url);
const ATTRIBUTION_URL = new URL('../assets/ATTRIBUTION.txt', import.meta.url);
const SOURCE_FILES = ['cities1000.zip', 'admin1CodesASCII.txt', 'countryInfo.txt'];
const SKIPPED_FEATURE_CODES = new Set(['PPLX', 'PPLQ', 'PPLW', 'PPLH', 'PPLCH']);
const COORDINATE_SCALE = 10_000;

interface CityRow {
  name: string;
  latE4: number;
  lonE4: number;
  country: number;
  admin1: number;
  population: number;
}

async function download(name: string): Promise<Uint8Array> {
  console.log(`Downloading ${BASE_URL}${name}`);
  const response = await fetch(`${BASE_URL}${name}`);
  if (!response.ok) throw new Error(`Download of ${name} failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function sourceReader(folder: string | undefined): (name: string) => Promise<Uint8Array> {
  if (!folder) return download;
  return async (name) => {
    console.log(`Reading ${path.join(folder, name)}`);
    return readFileSync(path.join(folder, name));
  };
}

function unzipCities(zip: Uint8Array): string {
  const files = unzipSync(zip, { filter: (file) => file.name === CITIES_FILE });
  const cities = files[CITIES_FILE];
  if (!cities) throw new Error(`${CITIES_FILE} not found in the zip`);
  return strFromU8(cities);
}

function tsvRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

function parseCountries(text: string): CountryRecord[] {
  return tsvRows(text).map((columns) => ({ code: columns[0]!, name: columns[4]! }));
}

function parseAdmin1(text: string): Admin1Record[] {
  return tsvRows(text).map((columns) => ({ key: columns[0]!, name: columns[1]! }));
}

function indexOfKey<T>(records: T[], key: (record: T) => string): Map<string, number> {
  return new Map(records.map((record, i) => [key(record), i]));
}

function countryIndex(
  countries: CountryRecord[],
  index: Map<string, number>,
  code: string,
): number {
  if (!index.has(code)) {
    index.set(code, countries.length);
    countries.push({ code, name: code });
  }
  return index.get(code)!;
}

function cityRows(text: string, countries: CountryRecord[], admin1: Admin1Record[]): CityRow[] {
  const countryKeys = indexOfKey(countries, (country) => country.code);
  const admin1Keys = indexOfKey(admin1, (region) => region.key);
  return tsvRows(text)
    .filter((columns) => !SKIPPED_FEATURE_CODES.has(columns[7]!))
    .map((columns) => ({
      name: columns[1]!,
      latE4: Math.round(Number(columns[4]) * COORDINATE_SCALE),
      lonE4: Math.round(Number(columns[5]) * COORDINATE_SCALE),
      country: countryIndex(countries, countryKeys, columns[8]!),
      admin1: admin1Keys.get(`${columns[8]}.${columns[10]}`) ?? -1,
      population: Number(columns[14]) || 0,
    }))
    .sort((a, b) => a.latE4 - b.latE4 || a.lonE4 - b.lonE4);
}

function toDataset(
  rows: CityRow[],
  countries: CountryRecord[],
  admin1: Admin1Record[],
): GeoDataset {
  const column = (pick: (row: CityRow) => number): Int32Array => Int32Array.from(rows, pick);
  return {
    countries,
    admin1,
    cities: {
      names: rows.map((row) => row.name),
      latE4: column((row) => row.latE4),
      lonE4: column((row) => row.lonE4),
      country: column((row) => row.country),
      admin1: column((row) => row.admin1),
      population: column((row) => row.population),
    },
  };
}

function attributionText(downloadedOn: string): string {
  return [
    'Contains data from GeoNames (geonames.org), CC BY 4.0',
    'https://creativecommons.org/licenses/by/4.0/',
    '',
    `Source files: ${BASE_URL}cities1000.zip, admin1CodesASCII.txt, countryInfo.txt`,
    `Downloaded on ${downloadedOn}.`,
    'Changes: converted to a compact binary file; sections of cities and historical,',
    'abandoned and destroyed places (PPLX, PPLH, PPLQ, PPLW, PPLCH) removed;',
    'coordinates rounded to 4 decimals.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { from: { type: 'string' } } });
  const [zip, admin1Text, countryText] = await Promise.all(
    SOURCE_FILES.map(sourceReader(values.from)),
  );
  const countries = parseCountries(strFromU8(countryText!));
  const admin1 = parseAdmin1(strFromU8(admin1Text!));
  const rows = cityRows(unzipCities(zip!), countries, admin1);
  const packed = packDataset(toDataset(rows, countries, admin1));
  writeFileSync(DATASET_URL, packed);
  writeFileSync(ATTRIBUTION_URL, attributionText(new Date().toISOString().slice(0, 10)));
  const sizeMb = (packed.byteLength / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${rows.length} cities, ${countries.length} countries, ${sizeMb} MB`);
}

await main();
