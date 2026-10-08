import type { PbEventName, PbEvents, ThumbUpdate } from '@photobeaver/shared';
import { BrowserWindow } from 'electron';
import type { EventSink } from './core/events/event-sink';

export const LIBRARY_CHANGED_DEBOUNCE_MS = 1000;
export const THUMBS_BATCH_MS = 250;

function broadcast<K extends PbEventName>(name: K, payload: PbEvents[K]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(`pb:event:${name}`, payload);
  }
}

export type VisibleIds = (assetIds: string[]) => string[];

function createThumbBatcher(visibleIds: VisibleIds): (items: ThumbUpdate[]) => void {
  let thumbTimer: NodeJS.Timeout | null = null;
  const ready = new Map<string, ThumbUpdate>();
  const flushThumbs = () => {
    thumbTimer = null;
    const items = visibleIds([...ready.keys()]).map((id) => ready.get(id)!);
    ready.clear();
    if (items.length > 0) broadcast('thumbs.ready', { items });
  };
  return (items) => {
    items.forEach((item) => ready.set(item.id, item));
    thumbTimer ??= setTimeout(flushThumbs, THUMBS_BATCH_MS);
  };
}

function createLibraryThrottle(): () => void {
  let libraryTimer: NodeJS.Timeout | null = null;
  return () => {
    libraryTimer ??= setTimeout(
      () => ((libraryTimer = null), broadcast('library.changed', {})),
      LIBRARY_CHANGED_DEBOUNCE_MS,
    );
  };
}

/**
 * Forwards core events to every renderer. `library.changed` is throttled and
 * `thumbs.ready` updates are batched so a fast sync does not flood the UI, and
 * carry only the asset ids the signed-in user can see.
 *
 * @param visibleIds - Keeps the asset ids visible to the signed-in user.
 * @returns The event sink to give the core.
 */
export function createWindowEventSink(visibleIds: VisibleIds): EventSink {
  const addThumbs = createThumbBatcher(visibleIds);
  const libraryChanged = createLibraryThrottle();
  return {
    emit(name, payload) {
      if (name === 'thumbs.ready') addThumbs((payload as PbEvents['thumbs.ready']).items);
      else if (name === 'library.changed') libraryChanged();
      else broadcast(name, payload);
    },
  };
}
