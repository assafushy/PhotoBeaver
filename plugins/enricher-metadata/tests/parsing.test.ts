import { describe, expect, it } from 'vitest';
import {
  exifDateToFloating,
  fractionToMs,
  offsetDateToFloating,
  instantToLocalFloating,
  quickTimeToFloating,
  toFloating,
} from '../src/floating-time';
import { gpsToDecimal, parseIso6709, validLocation } from '../src/geo';
import { parseDataValue, parseKeys } from '../src/video/apple-keys';
import { parseMvhd, parseXyz } from '../src/video/movie';
import { matrixRotation, parseTkhd } from '../src/video/track';

function localFloating(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString();
}

describe('floating time', () => {
  it('encodes the EXIF wall clock as UTC', () => {
    expect(exifDateToFloating('2023:05:01 14:22:33')).toBe('2023-05-01T14:22:33.000Z');
    expect(exifDateToFloating('2023:05:01 14:22:33', '5')).toBe('2023-05-01T14:22:33.500Z');
    expect(exifDateToFloating('2023:05:01 14:22:33', 123)).toBe('2023-05-01T14:22:33.123Z');
  });

  it('rejects empty and impossible dates', () => {
    expect(exifDateToFloating('0000:00:00 00:00:00')).toBeUndefined();
    expect(exifDateToFloating('2023:02:30 10:00:00')).toBeUndefined();
    expect(exifDateToFloating('    :  :     :  :  ')).toBeUndefined();
    expect(exifDateToFloating(undefined)).toBeUndefined();
  });

  it('keeps the wall clock of an ISO offset', () => {
    expect(offsetDateToFloating('2021-07-04T19:11:12+0900')).toBe('2021-07-04T19:11:12.000Z');
    expect(offsetDateToFloating('2021-07-04T19:11:12-07:00')).toBe('2021-07-04T19:11:12.000Z');
    expect(offsetDateToFloating('2021-07-04T19:11:12.5Z')).toBe('2021-07-04T19:11:12.500Z');
    expect(offsetDateToFloating('yesterday')).toBeUndefined();
  });

  it('expresses an instant as the wall clock of a fixed offset', () => {
    const instant = Date.UTC(2021, 6, 4, 10, 11, 12);
    expect(toFloating(instant, 0)).toBe('2021-07-04T10:11:12.000Z');
    expect(toFloating(instant, -540)).toBe('2021-07-04T19:11:12.000Z');
    expect(toFloating(instant, 420)).toBe('2021-07-04T03:11:12.000Z');
  });

  it('uses the local offset of the instant itself', () => {
    const instant = Date.UTC(2021, 0, 15, 12, 0, 0);
    const expected = toFloating(instant, new Date(instant).getTimezoneOffset());
    expect(instantToLocalFloating(instant)).toBe(expected);
  });

  it('converts QuickTime seconds to local floating time and treats 0 as missing', () => {
    expect(quickTimeToFloating(3708238272)).toBe(localFloating('2021-07-04T10:11:12Z'));
    expect(quickTimeToFloating(0)).toBeUndefined();
  });

  it('reads sub-second digits', () => {
    expect(fractionToMs('25')).toBe(250);
    expect(fractionToMs('1234')).toBe(123);
    expect(fractionToMs('x')).toBe(0);
  });
});

describe('locations', () => {
  it('parses ISO 6709 in degrees, with and without altitude', () => {
    expect(parseIso6709('+48.8584+002.2945/')).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(parseIso6709('-33.8688+151.2093+012.000/')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseIso6709('+40.7128-074.0060/')).toEqual({ lat: 40.7128, lon: -74.006 });
  });

  it('parses ISO 6709 degree-minute forms', () => {
    const point = parseIso6709('+4851.504+00217.670/');
    expect(point?.lat).toBeCloseTo(48.8584, 4);
    expect(point?.lon).toBeCloseTo(2.2945, 3);
  });

  it('rejects junk, (0, 0) and out-of-range values', () => {
    expect(parseIso6709('nowhere')).toBeUndefined();
    expect(parseIso6709('+00.0000+000.0000/')).toBeUndefined();
    expect(parseIso6709('+95.0000+010.0000/')).toBeUndefined();
    expect(validLocation(10, 200)).toBeUndefined();
  });

  it('signs EXIF GPS by its reference letter', () => {
    expect(gpsToDecimal([33, 52, 7.68], 'S')).toBeCloseTo(-33.8688, 4);
    expect(gpsToDecimal([74, 0, 21.6], 'W')).toBeCloseTo(-74.006, 4);
    expect(gpsToDecimal(12.5, 'N')).toBe(12.5);
    expect(gpsToDecimal(['x'], 'N')).toBeUndefined();
  });
});

function tkhd(a: number, b: number, width: number, height: number): Buffer {
  const payload = Buffer.alloc(84);
  payload.writeInt32BE(a * 0x10000, 40);
  payload.writeInt32BE(b * 0x10000, 44);
  payload.writeUInt32BE(width * 0x10000, 76);
  payload.writeUInt32BE(height * 0x10000, 80);
  return payload;
}

describe('ISO media boxes', () => {
  it('reads tkhd size and rotation', () => {
    expect(parseTkhd(tkhd(1, 0, 1920, 1080))).toEqual({ width: 1920, height: 1080, rotation: 0 });
    expect(parseTkhd(tkhd(0, 1, 1920, 1080))?.rotation).toBe(90);
    expect(matrixRotation(-0x10000, 0)).toBe(180);
    expect(matrixRotation(0, -0x10000)).toBe(270);
  });

  it('reads mvhd version 0 and 1', () => {
    const v0 = Buffer.alloc(20);
    v0.writeUInt32BE(3708238272, 4);
    v0.writeUInt32BE(600, 12);
    v0.writeUInt32BE(1500, 16);
    expect(parseMvhd(v0)).toEqual({
      createdAt: localFloating('2021-07-04T10:11:12Z'),
      durationMs: 2500,
    });
    const v1 = Buffer.alloc(32);
    v1[0] = 1;
    v1.writeUInt32BE(1000, 20);
    v1.writeBigUInt64BE(4000n, 24);
    expect(parseMvhd(v1)).toEqual({ createdAt: undefined, durationMs: 4000 });
  });

  it('reads ©xyz, keys and data values', () => {
    const xyz = Buffer.concat([
      Buffer.from([0, 18, 0x15, 0xc7]),
      Buffer.from('+35.6895+139.6917/'),
    ]);
    expect(parseXyz(xyz)).toEqual({ lat: 35.6895, lon: 139.6917 });
    const key = Buffer.from('com.apple.quicktime.make');
    const entry = Buffer.concat([Buffer.alloc(4), Buffer.from('mdta'), key]);
    entry.writeUInt32BE(entry.length, 0);
    const keys = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), entry]);
    expect(parseKeys(keys)).toEqual(['', 'com.apple.quicktime.make']);
    expect(
      parseDataValue(Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from('Apple')])),
    ).toBe('Apple');
    expect(parseDataValue(Buffer.from([0, 0, 0, 23, 0, 0, 0, 0, 1, 2, 3, 4]))).toBeUndefined();
  });
});
