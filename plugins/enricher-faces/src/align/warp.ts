import type { Point } from '../detect/anchors';
import type { RgbImage } from '../image/rgb';
import { sampleBilinear } from '../image/sample';
import { ARCFACE_TEMPLATE, estimateSimilarity, invertAffine, type Affine } from './similarity';

export const ALIGNED_SIZE = 112;

/**
 * Warps an image with an affine matrix and bilinear sampling, like OpenCV's
 * `warpAffine` with a black constant border.
 *
 * @param image - Source image.
 * @param matrix - Maps source pixels to output pixels.
 * @param width - Output width.
 * @param height - Output height.
 * @returns The warped image.
 */
export function warpAffine(
  image: RgbImage,
  matrix: Affine,
  width: number,
  height: number,
): RgbImage {
  const inv = invertAffine(matrix);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const sx = inv[0] * x + inv[1] * y + inv[2];
      const sy = inv[3] * x + inv[4] * y + inv[5];
      for (let c = 0; c < 3; c += 1)
        data[(y * width + x) * 3 + c] = Math.round(sampleBilinear(image, sx, sy, c));
    }
  return { width, height, data };
}

/**
 * Crops a face to the 112 x 112 ArcFace layout from its five landmarks
 * (eyes, nose tip, mouth corners).
 *
 * @param image - Source image.
 * @param landmarks - Five landmarks in image pixels.
 * @returns The aligned face.
 */
export function alignFace(image: RgbImage, landmarks: Point[]): RgbImage {
  const matrix = estimateSimilarity(landmarks, ARCFACE_TEMPLATE);
  return warpAffine(image, matrix, ALIGNED_SIZE, ALIGNED_SIZE);
}
