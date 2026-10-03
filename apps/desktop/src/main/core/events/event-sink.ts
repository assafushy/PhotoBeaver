import type { PbEventName, PbEvents } from '@photobeaver/shared';

export interface EventSink {
  emit<K extends PbEventName>(name: K, payload: PbEvents[K]): void;
}

export const nullEventSink: EventSink = { emit: () => undefined };
