import type { PbEventName } from './events';

export const PB_EVENT_NAMES: readonly PbEventName[] = [
  'library.changed',
  'sources.changed',
  'plugins.changed',
  'sync.progress',
  'thumbs.ready',
];

/**
 * Narrows a string to a known push-event channel.
 *
 * @param name - Candidate channel.
 * @returns True for declared event channels.
 */
export function isPbEventName(name: string): name is PbEventName {
  return (PB_EVENT_NAMES as readonly string[]).includes(name);
}
