import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { parseSchedule } from './schedule';
import { failureDelayMs, stateAfterFailure, successDelayMs } from './timing';

type SourceRow = typeof schema.sources.$inferSelect;
type SourcePatch = Partial<typeof schema.sources.$inferInsert>;

const { sources } = schema;

function patch(db: LibraryDb, sourceId: string, values: SourcePatch): void {
  db.update(sources).set(values).where(eq(sources.id, sourceId)).run();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Source sync-state transitions from SPEC 7.2.
 */
export const sourceState = {
  queued(db: LibraryDb, sourceId: string): void {
    patch(db, sourceId, { syncState: 'queued' });
  },

  running(db: LibraryDb, sourceId: string, now: number): void {
    patch(db, sourceId, { syncState: 'running', lastSyncStartedAt: now });
  },

  succeeded(db: LibraryDb, source: SourceRow, now: number, random: number): void {
    const { intervalSec } = parseSchedule(source.scheduleJson);
    patch(db, source.id, {
      syncState: 'idle',
      lastSyncFinishedAt: now,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: now + successDelayMs(intervalSec, random),
    });
  },

  failed(db: LibraryDb, source: SourceRow, now: number, error: unknown): void {
    const { intervalSec } = parseSchedule(source.scheduleJson);
    const previous = source.consecutiveFailures ?? 0;
    patch(db, source.id, {
      syncState: stateAfterFailure(previous + 1),
      lastSyncFinishedAt: now,
      lastError: errorMessage(error),
      consecutiveFailures: previous + 1,
      nextRunAt: now + failureDelayMs(intervalSec, previous),
    });
  },

  authRequired(db: LibraryDb, sourceId: string, now: number, error: unknown): void {
    patch(db, sourceId, {
      syncState: 'auth_required',
      lastSyncFinishedAt: now,
      lastError: errorMessage(error),
    });
  },

  rateLimited(db: LibraryDb, sourceId: string, now: number, retryAfterSec: number): void {
    patch(db, sourceId, {
      syncState: 'idle',
      lastSyncFinishedAt: now,
      nextRunAt: now + retryAfterSec * 1000,
    });
  },

  cancelled(db: LibraryDb, sourceId: string): void {
    const row = db
      .select({ state: sources.syncState })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .get();
    if (row && row.state !== 'paused') patch(db, sourceId, { syncState: 'idle' });
  },
};
