import { writeHashed } from './hash';
import { percentReporter, type StatusSink } from './progress';

export interface DownloadOptions {
  fetch: typeof fetch;
  signal: AbortSignal;
  status: StatusSink;
}

const LABEL = 'Downloading face models';

function contentLength(response: Response): number | undefined {
  const value = Number(response.headers.get('content-length'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Streams a URL to a file, reporting progress and hashing on the way.
 *
 * @param url - What to download.
 * @param file - Destination path.
 * @param options - Fetch, abort signal and status sink.
 * @returns Lowercase hex SHA-256 of the downloaded bytes.
 * @throws Error when the response is not OK or has no body.
 */
export async function downloadFile(
  url: string,
  file: string,
  options: DownloadOptions,
): Promise<string> {
  const response = await options.fetch(url, { signal: options.signal });
  if (!response.ok || !response.body)
    throw new Error(`Model download failed with HTTP ${response.status}`);
  const report = percentReporter(options.status, LABEL, contentLength(response));
  return writeHashed(response.body, file, report);
}
