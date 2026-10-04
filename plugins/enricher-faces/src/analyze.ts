import type { DetectedFace, FaceBox } from '@photobeaver/plugin-sdk';
import { alignFace } from './align/warp';
import type { RawFace } from './detect/anchors';
import { detectFaces } from './detect/scrfd';
import { embedFaces } from './embed/arcface';
import type { FaceSessions } from './embed/onnx';
import type { RgbImage } from './image/rgb';
import type { FacesSettings } from './settings';

export const MAX_FACES_PER_IMAGE = 50;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a pixel box (x1, y1, x2, y2) to a box normalized to the image, clipped to 0..1.
 *
 * @param box - Box in image pixels.
 * @param width - Image width.
 * @param height - Image height.
 * @returns Normalized left, top, width and height.
 */
export function normalizeBox(box: RawFace['box'], width: number, height: number): FaceBox {
  const x1 = clamp01(box[0] / width);
  const y1 = clamp01(box[1] / height);
  const x2 = clamp01(box[2] / width);
  const y2 = clamp01(box[3] / height);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Finds faces in an image and computes an embedding for each, with one
 * recognition run for all faces of the image.
 *
 * @param image - RGB image.
 * @param sessions - Model runners.
 * @param settings - Detection threshold and minimum face size.
 * @returns Faces with normalized boxes, largest first.
 */
export async function analyzeImage(
  image: RgbImage,
  sessions: FaceSessions,
  settings: FacesSettings,
): Promise<DetectedFace[]> {
  const faces = await detectFaces(image, sessions.detect, {
    threshold: settings.detectionThreshold,
    minFaceSize: settings.minFaceSize,
    maxFaces: MAX_FACES_PER_IMAGE,
  });
  const embeddings = await embedFaces(
    faces.map((face) => alignFace(image, face.landmarks)),
    sessions.recognize,
  );
  return faces.map((face, i) => ({
    bbox: normalizeBox(face.box, image.width, image.height),
    confidence: face.score,
    embedding: embeddings[i]!,
  }));
}
