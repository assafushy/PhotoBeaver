import { describe, expect, it } from 'vitest';
import { findSidecar, indexSidecars } from '../src/takeout/sidecar';

function match(files: string[], media: string): string | undefined {
  return findSidecar(indexSidecars(files), media);
}

const LONG = 'Screenshot_20190704-183512_Samsung Internet Browser.jpg';

describe('findSidecar', () => {
  it('finds the newest supplemental-metadata sidecar', () => {
    expect(match(['IMG_1.jpg', 'IMG_1.jpg.supplemental-metadata.json'], 'IMG_1.jpg')).toBe(
      'IMG_1.jpg.supplemental-metadata.json',
    );
  });

  it('finds the older <name>.json sidecar', () => {
    expect(match(['IMG_1.jpg.json'], 'IMG_1.jpg')).toBe('IMG_1.jpg.json');
  });

  it('prefers an exact match over a clipped one', () => {
    const files = ['IMG_1.jpg.supplemental-metad.json', 'IMG_1.jpg.json'];
    expect(match(files, 'IMG_1.jpg')).toBe('IMG_1.jpg.json');
  });

  it('finds supplemental-metadata names clipped to 46 characters', () => {
    const name = 'PXL_20230612_101530123.MP.jpg';
    const clipped = `${name}.supplemental-metadata`.slice(0, 46);
    expect(clipped).toBe('PXL_20230612_101530123.MP.jpg.supplemental-met');
    expect(match([`${clipped}.json`], name)).toBe(`${clipped}.json`);
    expect(match(['IMG_20200101_1234567.jpg.suppl.json'], 'IMG_20200101_1234567.jpg')).toBe(
      'IMG_20200101_1234567.jpg.suppl.json',
    );
    expect(match(['IMG_20200101.jpg.supplemental-metad.json'], 'IMG_20200101.jpg')).toBe(
      'IMG_20200101.jpg.supplemental-metad.json',
    );
  });

  it('finds old sidecars of long names clipped to 46 characters', () => {
    const clipped = `${LONG.slice(0, 46)}.json`;
    expect(match([clipped], LONG)).toBe(clipped);
  });

  it('matches numbered copies to the numbered sidecar', () => {
    const files = [
      'IMG.jpg.supplemental-metadata.json',
      'IMG.jpg.supplemental-metadata(1).json',
      'IMG.jpg.supplemental-metadata(2).json',
    ];
    expect(match(files, 'IMG(1).jpg')).toBe('IMG.jpg.supplemental-metadata(1).json');
    expect(match(files, 'IMG(2).jpg')).toBe('IMG.jpg.supplemental-metadata(2).json');
    expect(match(files, 'IMG.jpg')).toBe('IMG.jpg.supplemental-metadata.json');
  });

  it('matches numbered copies in the older format', () => {
    const files = ['IMG.jpg.json', 'IMG.jpg(1).json'];
    expect(match(files, 'IMG(1).jpg')).toBe('IMG.jpg(1).json');
    expect(match(files, 'IMG.jpg')).toBe('IMG.jpg.json');
  });

  it('prefers a sidecar named after the copy itself', () => {
    expect(match(['IMG(1).jpg.json', 'IMG.jpg(1).json'], 'IMG(1).jpg')).toBe('IMG(1).jpg.json');
  });

  it('matches clipped numbered copies', () => {
    const copy = LONG.replace('.jpg', '(1).jpg');
    const sidecar = `${LONG.slice(0, 46)}(1).json`;
    expect(match([`${LONG.slice(0, 46)}.json`, sidecar], copy)).toBe(sidecar);
  });

  it('gives edited copies the sidecar of the original', () => {
    const files = ['IMG_2.jpg.supplemental-metadata.json'];
    expect(match(files, 'IMG_2-edited.jpg')).toBe('IMG_2.jpg.supplemental-metadata.json');
    expect(match(['IMG_3.jpg.json'], 'IMG_3-bearbeitet.jpg')).toBe('IMG_3.jpg.json');
  });

  it('does not give a copy the sidecar of the original or another file', () => {
    expect(match(['IMG.jpg.json'], 'IMG(1).jpg')).toBeUndefined();
    expect(match(['IMG_10.jpg.json'], 'IMG_1.jpg')).toBeUndefined();
    expect(match(['IMG_1.jpg.json'], 'IMG_10.jpg')).toBeUndefined();
    expect(match(['metadata.json', 'IMG_1.jpg'], 'IMG_1.jpg')).toBeUndefined();
  });

  it('keeps the case of names', () => {
    expect(match(['IMG_4.JPG.JSON'], 'IMG_4.JPG')).toBe('IMG_4.JPG.JSON');
    expect(match(['img_4.jpg.json'], 'IMG_4.JPG')).toBeUndefined();
  });
});
