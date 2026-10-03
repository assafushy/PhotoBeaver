import type { PbEvents } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePbEvent } from '../lib/use-pb-event';

type Progress = PbEvents['sync.progress'];

/**
 * Sources with live state: refetched on `sources.changed` and `library.changed`,
 * plus the latest progress per source from `sync.progress`.
 *
 * @returns The sources query and progress keyed by source id.
 */
export function useSources() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['sources'], queryFn: () => window.pb.sources.list() });
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const refresh = () => void client.invalidateQueries({ queryKey: ['sources'] });
  usePbEvent('sources.changed', refresh);
  usePbEvent('library.changed', refresh);
  usePbEvent('sync.progress', (event) =>
    setProgress((prev) => ({ ...prev, [event.sourceId]: event })),
  );
  return { ...query, progress };
}
