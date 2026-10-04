import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DetectedFace } from '@photobeaver/plugin-sdk';
import { createFakeEnrichContext } from '@photobeaver/plugin-sdk/testing';
import { cosineDistance } from '../src/embed/vector';
import { createFacesEnricher, type FacesEnricher } from '../src/plugin';
import type { FacesSettings } from '../src/settings';
import { asset, FIXTURES, tempDir } from './helpers';

const MODELS_DIR = process.env.PB_FACE_MODELS_DIR;
const PORTRAITS = [
  'person-a-1',
  'person-a-2',
  'person-a-3',
  'person-b-1',
  'person-b-2',
  'person-b-3',
];
const ALL = [...PORTRAITS, 'group', 'no-face'];

async function linkModels(dataDir: string, modelsDir: string): Promise<void> {
  await mkdir(path.join(dataDir, 'models'));
  for (const name of ['det_10g.onnx', 'w600k_r50.onnx'])
    await symlink(path.join(modelsDir, name), path.join(dataDir, 'models', name));
}

async function pngInputs(dir: string): Promise<Record<string, { png: string }>> {
  const inputs: Record<string, { png: string }> = {};
  for (const name of ALL) {
    const png = path.join(dir, `${name}.png`);
    await sharp(path.join(FIXTURES, `${name}.jpg`))
      .png()
      .toFile(png);
    inputs[name] = { png };
  }
  return inputs;
}

function embeddingOf(faces: DetectedFace[]): number[] {
  return faces[0]!.embedding!;
}

describe.skipIf(!MODELS_DIR)('real InsightFace models', () => {
  const faces = new Map<string, DetectedFace[]>();
  let plugin: FacesEnricher;

  beforeAll(async () => {
    const dataDir = tempDir();
    await linkModels(dataDir, MODELS_DIR!);
    const ctx = createFakeEnrichContext<FacesSettings>({
      dataDir,
      inputs: await pngInputs(dataDir),
    });
    plugin = createFacesEnricher();
    await plugin.activate!(ctx);
    await plugin.modelsReady();
    for (const name of ALL) faces.set(name, (await plugin.enrich(ctx, asset(name))).faces ?? []);
  }, 120_000);

  afterAll(async () => plugin?.deactivate?.());

  it('finds one face per portrait, several in the group and none in the landscape', () => {
    for (const name of PORTRAITS) expect(faces.get(name), name).toHaveLength(1);
    expect(faces.get('group')!.length).toBeGreaterThanOrEqual(2);
    expect(faces.get('no-face')).toEqual([]);
    const summary = [...faces].map(([name, found]) => [
      name,
      found.map((f) => f.confidence.toFixed(2)),
    ]);
    console.info('Faces found', Object.fromEntries(summary));
  });

  it('returns normalized boxes and unit-length 512-d embeddings', () => {
    for (const face of [...faces.values()].flat()) {
      expect(face.bbox.x).toBeGreaterThanOrEqual(0);
      expect(face.bbox.x + face.bbox.w).toBeLessThanOrEqual(1);
      expect(face.embedding).toHaveLength(512);
      expect(Math.hypot(...face.embedding!)).toBeCloseTo(1, 4);
    }
  });

  it('puts the same person close together and different people far apart', () => {
    const distances: Record<string, number> = {};
    for (let i = 0; i < PORTRAITS.length; i += 1)
      for (let j = i + 1; j < PORTRAITS.length; j += 1) {
        const [a, b] = [PORTRAITS[i]!, PORTRAITS[j]!];
        const distance = cosineDistance(embeddingOf(faces.get(a)!), embeddingOf(faces.get(b)!));
        distances[`${a}~${b}`] = Number(distance.toFixed(3));
        if (a.slice(0, 8) === b.slice(0, 8)) expect(distance, `${a} ${b}`).toBeLessThan(0.5);
        else expect(distance, `${a} ${b}`).toBeGreaterThan(0.6);
      }
    console.info('Face embedding cosine distances', distances);
  });
});
