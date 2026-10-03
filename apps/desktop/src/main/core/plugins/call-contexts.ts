import type { SourceContext, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import { ulid } from 'ulid';

type AnyContext = SourceContext<unknown> | SyncContext<unknown>;

/**
 * Maps the `contextId`s sent to a plugin host back to the core-side contexts
 * of the calls that created them, so host callbacks (isKnown, progress, folder
 * picker) reach the right sync or setup.
 */
export class CallContexts {
  private readonly contexts = new Map<string, AnyContext>();
  private readonly watches = new Map<string, (batch: SyncBatch) => void>();

  /**
   * Registers a context for the duration of a call.
   *
   * @param ctx - Core-side context.
   * @returns The id to send and a release function.
   */
  open(ctx: AnyContext): { contextId: string; release(): void } {
    const contextId = ulid();
    this.contexts.set(contextId, ctx);
    return { contextId, release: () => void this.contexts.delete(contextId) };
  }

  get(contextId: string): AnyContext {
    const ctx = this.contexts.get(contextId);
    if (!ctx) throw new Error('Unknown or expired call context');
    return ctx;
  }

  sync(contextId: string): SyncContext<unknown> {
    const ctx = this.get(contextId) as Partial<SyncContext<unknown>>;
    if (typeof ctx.isKnown !== 'function') throw new Error('Not a sync context');
    return ctx as SyncContext<unknown>;
  }

  addWatch(watchId: string, onChange: (batch: SyncBatch) => void): void {
    this.watches.set(watchId, onChange);
  }

  removeWatch(watchId: string): void {
    this.watches.delete(watchId);
  }

  watch(watchId: string): ((batch: SyncBatch) => void) | undefined {
    return this.watches.get(watchId);
  }
}
