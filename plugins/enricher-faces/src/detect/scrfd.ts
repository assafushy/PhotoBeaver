import type { RgbImage } from '../image/rgb';
import type { Point, RawFace } from './anchors';
import { decodeStride, groupOutputs, type OutputTensor } from './decode';
import { computeLetterbox, letterboxTensor, type Letterbox } from './letterbox';
import { nms } from './nms';

export const DETECTOR_INPUT_SIZE = 640;
const ANCHORS_PER_LOCATION = 2;
const NMS_THRESHOLD = 0.4;

export type DetectorRun = (input: Float32Array, size: number) => Promise<OutputTensor[]>;

export interface DetectOptions {
  threshold: number;
  minFaceSize: number;
  maxFaces: number;
}

/**
 * Maps a face from letterboxed model pixels back to image pixels.
 *
 * @param face - Face in model-input pixels.
 * @param box - The letterbox used to build the input.
 * @returns The face in image pixels.
 */
export function unletterbox(face: RawFace, box: Letterbox): RawFace {
  const s = box.scale;
  const scaledBox = face.box.map((value) => value / s) as RawFace['box'];
  const landmarks = face.landmarks.map((p): Point => ({ x: p.x / s, y: p.y / s }));
  return { box: scaledBox, score: face.score, landmarks };
}

function faceSide(face: RawFace): number {
  return Math.min(face.box[2] - face.box[0], face.box[3] - face.box[1]);
}

function faceArea(face: RawFace): number {
  return (face.box[2] - face.box[0]) * (face.box[3] - face.box[1]);
}

/**
 * Keeps faces at least `minFaceSize` on their shorter side, largest first, at most `maxFaces`.
 *
 * @param faces - Faces in image pixels.
 * @param options - Size limit and cap.
 * @returns The kept faces.
 */
export function selectFaces(faces: RawFace[], options: DetectOptions): RawFace[] {
  return faces
    .filter((face) => faceSide(face) >= options.minFaceSize)
    .sort((a, b) => faceArea(b) - faceArea(a))
    .slice(0, options.maxFaces);
}

/**
 * Runs SCRFD on an image: letterbox to 640, decode every stride, NMS at IoU 0.4,
 * map back to image pixels and apply the size limit and cap.
 *
 * @param image - RGB image.
 * @param run - Runs the detector model on a 1 x 3 x size x size tensor.
 * @param options - Score threshold, minimum face size and cap.
 * @returns Faces in image pixels, largest first.
 */
export async function detectFaces(
  image: RgbImage,
  run: DetectorRun,
  options: DetectOptions,
): Promise<RawFace[]> {
  const size = DETECTOR_INPUT_SIZE;
  const box = computeLetterbox(image.width, image.height, size);
  const outputs = await run(letterboxTensor(image, box), size);
  const groups = groupOutputs(outputs, size, ANCHORS_PER_LOCATION);
  const candidates = groups.flatMap((g) =>
    decodeStride(g, size, ANCHORS_PER_LOCATION, options.threshold),
  );
  const kept = nms(candidates, NMS_THRESHOLD).map((face) => unletterbox(face, box));
  return selectFaces(kept, options);
}
