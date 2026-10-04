import { availableParallelism } from 'node:os';
import path from 'node:path';
import type * as OrtModule from 'onnxruntime-node';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { ALIGNED_SIZE } from '../align/warp';
import type { DetectorRun } from '../detect/scrfd';
import type { RecognizerRun } from './arcface';

type Ort = typeof OrtModule;

export interface FaceSessions {
  detect: DetectorRun;
  recognize: RecognizerRun;
  release(): Promise<void>;
}

export interface SessionFiles {
  dir: string;
  detector: string;
  recognizer: string;
}

const ERROR_LOG_LEVEL = 3;

/**
 * Threads per model run: half the cores, between 1 and 4.
 *
 * @returns The intra-op thread count.
 */
export function defaultThreads(): number {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

function float32(tensor: Tensor | undefined, name: string): Float32Array {
  if (!tensor || !(tensor.data instanceof Float32Array))
    throw new Error(`Model output ${name} is not a float32 tensor`);
  return tensor.data;
}

function detectorRun(ort: Ort, session: InferenceSession): DetectorRun {
  return async (input, size) => {
    const feeds = {
      [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, size, size]),
    };
    const outputs = await session.run(feeds);
    return session.outputNames.map((name) => ({
      dims: outputs[name]!.dims,
      data: float32(outputs[name], name),
    }));
  };
}

function recognizerRun(ort: Ort, session: InferenceSession): RecognizerRun {
  return async (input, count) => {
    const dims = [count, 3, ALIGNED_SIZE, ALIGNED_SIZE];
    const feeds = { [session.inputNames[0]!]: new ort.Tensor('float32', input, dims) };
    const outputs = await session.run(feeds);
    const name = session.outputNames[0]!;
    return float32(outputs[name], name);
  };
}

/**
 * Loads the detector and recognizer with onnxruntime on the CPU.
 *
 * @param files - Models folder and file names.
 * @param threads - Intra-op threads per session.
 * @returns Runners for both models and a function releasing them.
 */
export async function openSessions(files: SessionFiles, threads: number): Promise<FaceSessions> {
  const ort = await import('onnxruntime-node');
  const options: InferenceSession.SessionOptions = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    logSeverityLevel: ERROR_LOG_LEVEL,
  };
  const create = (name: string) => ort.InferenceSession.create(path.join(files.dir, name), options);
  const [detector, recognizer] = await Promise.all([
    create(files.detector),
    create(files.recognizer),
  ]);
  return {
    detect: detectorRun(ort, detector),
    recognize: recognizerRun(ort, recognizer),
    release: async () => void (await Promise.all([detector.release(), recognizer.release()])),
  };
}
