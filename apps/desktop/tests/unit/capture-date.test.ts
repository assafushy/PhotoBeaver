import { describe, expect, it } from 'vitest';
import {
  captureDateFromItem,
  dateFromFilename,
  pickCapturedAt,
  toFloatingTime,
} from '../../src/main/core/assets/capture-date';

const utc = (iso: string): number => Date.parse(`${iso}Z`);

describe('dateFromFilename', () => {
  it.each([
    ['IMG_20230105_142233.jpg', '2023-01-05T14:22:33'],
    ['PXL_20230105_142233123.jpg', '2023-01-05T14:22:33'],
    ['VID-20191231-WA0001.mp4', '2019-12-31T00:00:00'],
    ['2023-01-05 14.22.33.jpg', '2023-01-05T14:22:33'],
    ['Screenshot 2022-07-04 at 09.10.11.png', '2022-07-04T00:00:00'],
    ['20210228.jpg', '2021-02-28T00:00:00'],
  ])('parses %s', (name, expected) => {
    expect(dateFromFilename(name)).toBe(utc(expected));
  });

  it.each(['DSC_0001.jpg', 'IMG_20231340_000000.jpg', 'scan 20230230.jpg', '12345678901.jpg'])(
    'rejects %s',
    (name) => {
      expect(dateFromFilename(name)).toBeNull();
    },
  );
});

describe('captureDateFromItem', () => {
  it('prefers source, then filename, then mtime', () => {
    const mtime = '2024-01-01T00:00:00.000Z';
    expect(
      captureDateFromItem({
        capturedAt: '2020-01-01T00:00:00Z',
        filename: 'IMG_20190101_000000.jpg',
        modifiedAt: mtime,
      })?.source,
    ).toBe('source');
    expect(
      captureDateFromItem({ filename: 'IMG_20190101_000000.jpg', modifiedAt: mtime })?.source,
    ).toBe('filename');
    expect(captureDateFromItem({ filename: 'a.jpg', modifiedAt: mtime })).toEqual({
      value: toFloatingTime(Date.parse(mtime)),
      source: 'mtime',
    });
    expect(captureDateFromItem({ filename: 'a.jpg' })).toBeNull();
  });
});

describe('pickCapturedAt', () => {
  it('never lets a lower-ranked source overwrite a higher one', () => {
    const exif = { value: 1, source: 'exif' as const };
    const mtime = { value: 2, source: 'mtime' as const };
    expect(pickCapturedAt(exif, mtime)).toBe(exif);
    expect(pickCapturedAt(mtime, exif)).toBe(exif);
    expect(pickCapturedAt(mtime, { value: 3, source: 'mtime' })?.value).toBe(3);
    expect(pickCapturedAt(null, null)).toBeNull();
  });
});
