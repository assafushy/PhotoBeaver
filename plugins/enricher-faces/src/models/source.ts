export interface ModelFile {
  name: string;
  sha256: string;
}

export interface ModelSource {
  url: string;
  sha256: string;
  detector: ModelFile;
  recognizer: ModelFile;
}

export interface RetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
}

export const BUFFALO_L: ModelSource = {
  url: 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip',
  sha256: '80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f',
  detector: {
    name: 'det_10g.onnx',
    sha256: '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91',
  },
  recognizer: {
    name: 'w600k_r50.onnx',
    sha256: '4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43',
  },
};

export const DEFAULT_RETRY: RetryPolicy = { initialDelayMs: 30_000, maxDelayMs: 30 * 60_000 };

/**
 * The model files a source provides, detector first.
 *
 * @param source - Model source.
 * @returns The files to extract and verify.
 */
export function modelFiles(source: ModelSource): ModelFile[] {
  return [source.detector, source.recognizer];
}
