export type StatusSink = (text: string | null) => void;

/**
 * Builds a byte counter that reports whole percentages, at most once per percent.
 *
 * @param status - Where to send status text.
 * @param label - Text before the percentage, e.g. "Downloading face models".
 * @param total - Expected byte count; when unknown, only the start is reported.
 * @returns A function to call with each chunk's size.
 */
export function percentReporter(
  status: StatusSink,
  label: string,
  total: number | undefined,
): (bytes: number) => void {
  let done = 0;
  let last = 0;
  status(`${label}: 0%`);
  return (bytes) => {
    done += bytes;
    if (!total) return;
    const percent = Math.min(100, Math.floor((done / total) * 100));
    if (percent <= last) return;
    last = percent;
    status(`${label}: ${percent}%`);
  };
}
