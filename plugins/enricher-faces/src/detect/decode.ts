import { anchorCenters, distance2bbox, distance2kps, type RawFace } from './anchors';

export interface OutputTensor {
  dims: readonly number[];
  data: Float32Array;
}

export interface StrideOutputs {
  stride: number;
  scores: Float32Array;
  boxes: Float32Array;
  landmarks: Float32Array;
}

type Kind = 'scores' | 'boxes' | 'landmarks';

interface OutputRole {
  kind: Kind;
  stride: number;
}

const KIND_BY_COLUMNS: Record<number, Kind> = { 1: 'scores', 4: 'boxes', 10: 'landmarks' };

function describe(output: OutputTensor, inputSize: number, anchors: number): OutputRole {
  const rows = output.dims[output.dims.length - 2] ?? 0;
  const kind = KIND_BY_COLUMNS[output.dims[output.dims.length - 1] ?? 0];
  const cells = Math.sqrt(rows / anchors);
  if (!kind || !Number.isInteger(cells) || cells === 0)
    throw new Error(`Unexpected detector output shape ${output.dims.join('x')}`);
  return { kind, stride: inputSize / cells };
}

/**
 * Groups SCRFD outputs by stride, telling scores, boxes and keypoints apart by
 * shape (N x 1, N x 4, N x 10) instead of relying on output order.
 *
 * @param outputs - All detector outputs.
 * @param inputSize - Side of the square model input.
 * @param anchors - Anchors per location.
 * @returns One entry per stride, smallest stride first.
 */
export function groupOutputs(
  outputs: OutputTensor[],
  inputSize: number,
  anchors: number,
): StrideOutputs[] {
  const groups = new Map<number, Partial<StrideOutputs>>();
  for (const output of outputs) {
    const { kind, stride } = describe(output, inputSize, anchors);
    const group = groups.get(stride) ?? { stride };
    group[kind] = output.data;
    groups.set(stride, group);
  }
  return [...groups.values()].map(complete).sort((a, b) => a.stride - b.stride);
}

function complete(group: Partial<StrideOutputs>): StrideOutputs {
  const { stride, scores, boxes, landmarks } = group;
  if (stride === undefined || !scores || !boxes || !landmarks)
    throw new Error(`Detector outputs for stride ${stride} are incomplete`);
  return { stride, scores, boxes, landmarks };
}

function scaled(values: Float32Array, start: number, count: number, factor: number): number[] {
  return Array.from(values.subarray(start, start + count), (value) => value * factor);
}

/**
 * Decodes one stride's outputs into faces in model-input pixels.
 *
 * @param group - Outputs for one stride.
 * @param inputSize - Side of the square model input.
 * @param anchors - Anchors per location.
 * @param threshold - Minimum score to keep.
 * @returns Faces scoring at least the threshold.
 */
export function decodeStride(
  group: StrideOutputs,
  inputSize: number,
  anchors: number,
  threshold: number,
): RawFace[] {
  const cells = inputSize / group.stride;
  const centers = anchorCenters(cells, cells, group.stride, anchors);
  const faces: RawFace[] = [];
  for (let i = 0; i < group.scores.length; i += 1) {
    const score = group.scores[i]!;
    if (score < threshold) continue;
    const cx = centers[i * 2]!;
    const cy = centers[i * 2 + 1]!;
    const box = distance2bbox(cx, cy, scaled(group.boxes, i * 4, 4, group.stride));
    const landmarks = distance2kps(cx, cy, scaled(group.landmarks, i * 10, 10, group.stride));
    faces.push({ box, score, landmarks });
  }
  return faces;
}
