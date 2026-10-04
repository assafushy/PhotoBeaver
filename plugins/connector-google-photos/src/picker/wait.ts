import { setTimeout as sleep } from 'node:timers/promises';
import { getSession, type PickerClient } from './api';
import { parseDurationMs } from './duration';
import type { PickingSession } from './types';

export const DEFAULT_POLL_MS = 5_000;
export const MAX_WAIT_MS = 30 * 60_000;

function deadlineOf(session: PickingSession, startedAt: number): number {
  const timeout = parseDurationMs(session.pollingConfig?.timeoutIn, MAX_WAIT_MS);
  return startedAt + Math.min(timeout, MAX_WAIT_MS);
}

/**
 * Polls a Picker session until the user finished picking, honoring the session's
 * polling interval and timeout and at most 30 minutes in total.
 *
 * @param client - Picker client (its signal cancels the wait).
 * @param session - The session as created.
 * @returns True when items were picked, false when the user did not finish in time.
 */
export async function waitForPick(client: PickerClient, session: PickingSession): Promise<boolean> {
  const deadline = deadlineOf(session, Date.now());
  let current = session;
  while (!current.mediaItemsSet) {
    const interval = parseDurationMs(current.pollingConfig?.pollInterval, DEFAULT_POLL_MS);
    if (Date.now() + interval > deadline) return false;
    await sleep(interval, undefined, { signal: client.signal });
    current = await getSession(client, session.id);
  }
  return true;
}
