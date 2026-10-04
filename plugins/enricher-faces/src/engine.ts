import { RateLimitedError, type PluginContext } from '@photobeaver/plugin-sdk';
import { openSessions, type FaceSessions } from './embed/onnx';
import { ensureModels, type EnsureContext } from './models/ensure';
import type { ModelSource, RetryPolicy } from './models/source';

export interface EngineOptions {
  models: ModelSource;
  retry: RetryPolicy;
  threads: number;
}

const NOT_READY_RETRY_SEC = 30;

function ensureContext(ctx: PluginContext, signal: AbortSignal): EnsureContext {
  return {
    dataDir: ctx.dataDir,
    fetch: ctx.fetch,
    log: ctx.log,
    status: (text) => ctx.status(text),
    signal,
  };
}

/**
 * Owns the model download and the onnxruntime sessions for one plugin instance.
 */
export class FaceEngine {
  private controller?: AbortController;
  private ready?: Promise<string>;
  private dir?: string;
  private sessions?: Promise<FaceSessions>;

  constructor(private readonly options: EngineOptions) {}

  /**
   * Starts preparing the models in the background. Does nothing when already started.
   *
   * @param ctx - The plugin context.
   */
  start(ctx: PluginContext): void {
    if (this.ready) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([ctx.signal, controller.signal]);
    this.controller = controller;
    this.ready = ensureModels(ensureContext(ctx, signal), this.options.models, this.options.retry);
    this.ready.then(
      (dir) => void (this.dir = dir),
      (error: unknown) => ctx.log.info('Face model preparation stopped', { error: String(error) }),
    );
  }

  /**
   * Resolves with the models folder once the models are verified.
   *
   * @returns The models folder.
   * @throws Error when the engine was not started, or the abort reason when stopped.
   */
  whenReady(): Promise<string> {
    return this.ready ?? Promise.reject(new Error('Face engine not started'));
  }

  /**
   * The model sessions, created on first use after the models are ready.
   *
   * @returns The sessions.
   * @throws RateLimitedError while the models are still downloading.
   */
  async getSessions(): Promise<FaceSessions> {
    const dir = this.dir;
    if (!dir)
      throw new RateLimitedError({
        retryAfterSec: NOT_READY_RETRY_SEC,
        message: 'Face models are still downloading',
      });
    this.sessions ??= this.openSessions(dir);
    return this.sessions;
  }

  private openSessions(dir: string): Promise<FaceSessions> {
    const { detector, recognizer } = this.options.models;
    const files = { dir, detector: detector.name, recognizer: recognizer.name };
    const opening = openSessions(files, this.options.threads);
    opening.catch(() => (this.sessions = undefined));
    return opening;
  }

  /**
   * Stops a running download and releases the sessions.
   */
  async stop(): Promise<void> {
    this.controller?.abort(new Error('Faces plugin deactivated'));
    const sessions = this.sessions;
    this.controller = this.ready = this.dir = this.sessions = undefined;
    if (sessions) await (await sessions.catch(() => undefined))?.release();
  }
}
