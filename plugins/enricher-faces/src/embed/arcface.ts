import { ALIGNED_SIZE } from '../align/warp';
import type { RgbImage } from '../image/rgb';
import { toPlanar } from '../image/sample';
import { l2Normalize } from './vector';

export const EMBEDDING_SIZE = 512;
const MEAN = 127.5;
const STD = 127.5;

export type RecognizerRun = (input: Float32Array, count: number) => Promise<Float32Array>;

/**
 * Stacks aligned faces into one N x 3 x 112 x 112 tensor normalized as
 * `(value - 127.5) / 127.5`, planar RGB.
 *
 * @param faces - Aligned 112 x 112 faces.
 * @returns The batch tensor.
 */
export function recognitionBatch(faces: RgbImage[]): Float32Array {
  const plane = 3 * ALIGNED_SIZE * ALIGNED_SIZE;
  const tensor = new Float32Array(faces.length * plane);
  faces.forEach((face, i) => toPlanar(face, MEAN, STD, tensor, i * plane));
  return tensor;
}

/**
 * Computes unit-length ArcFace embeddings for aligned faces in one model run.
 *
 * @param faces - Aligned 112 x 112 faces.
 * @param run - Runs the recognition model on the batch tensor.
 * @returns One 512-float embedding per face.
 */
export async function embedFaces(faces: RgbImage[], run: RecognizerRun): Promise<number[][]> {
  if (faces.length === 0) return [];
  const output = await run(recognitionBatch(faces), faces.length);
  return faces.map((_, i) =>
    l2Normalize(output.subarray(i * EMBEDDING_SIZE, (i + 1) * EMBEDDING_SIZE)),
  );
}
