# Places (`com.photobeaver.enricher-geocode`)

A default Photo Beaver enricher that turns a photo's or video's GPS location into place names.

- For each asset with a location, it finds the city, region (first-level administrative division) and country.
- It stores them under `location` (`{ city, region, country, countryCode, distanceKm }`), adds one `place` tag per distinct name, and adds the names to the search text, so searching "Paris" finds photos taken in Paris.
- Assets with no city within 50 km (open sea, remote areas) get no place.

It runs after `enricher-metadata`, which supplies the GPS position.

## Offline

Everything runs on your computer. The plugin has no network permission and reads only its own bundled dataset (`assets/cities.bin.gz`, about 2 MB). The dataset is loaded on the first lookup (well under a second) and then kept in memory. A lookup takes a few microseconds.

## How a place is chosen

The dataset holds every GeoNames populated place with more than 1000 inhabitants, in a one-degree grid index.

1. Each city gets an estimated radius from its population (`0.005 km * sqrt(population)`, at least 1 km).
2. Among the cities within 50 km whose radius contains the point, the one whose centre is relatively closest wins. So a photo at the Eiffel Tower is "Paris" rather than the arrondissement "Paris 16 Passy".
3. If no radius contains the point, the nearest city within 50 km wins.

The search wraps around the anti-meridian and handles the poles.

## Data attribution

Contains data from GeoNames (geonames.org), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

- Source files: `cities1000.zip`, `admin1CodesASCII.txt` and `countryInfo.txt` from https://download.geonames.org/export/dump/
- Downloaded on 2026-10-04.
- Changes: converted to a compact binary file; sections of cities and historical, abandoned or destroyed places (feature codes PPLX, PPLH, PPLQ, PPLW, PPLCH) removed; coordinates rounded to 4 decimals (about 11 m).

The same notice ships in `assets/ATTRIBUTION.txt`.

## Refreshing the dataset

From this folder:

```sh
node scripts/build-dataset.ts
```

It downloads the three GeoNames files (about 11 MB), then rewrites `assets/cities.bin.gz` and `assets/ATTRIBUTION.txt` (with today's date). To build from files you already downloaded, pass `--from <folder>`. Update the download date above, run the tests, and commit both asset files.

## Dataset format

`cities.bin.gz` is gzipped binary (see `src/format.ts`):

- Header: six int32 values (magic `PBG1`, format version, city count, country count, admin1 count, text byte length).
- Five int32 columns, one value per city: latitude and longitude times 10,000, country index, admin1 index (-1 when unknown) and population. Cities are sorted by latitude, then longitude.
- UTF-8 text, one entry per line: `code<TAB>name` for countries, `CC.admin1<TAB>name` for regions, then the city names (GeoNames `name` column, Unicode).

Integers use little-endian byte order.

## Development

```sh
pnpm --filter @photobeaver/enricher-geocode test
pnpm --filter @photobeaver/enricher-geocode build
```
