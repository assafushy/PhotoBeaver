import { spawn } from 'node:child_process';

export interface VideoFrame {
  png: Buffer;
  durationMs: number | null;
}

const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/**
 * Parses the container duration from ffmpeg's stderr banner.
 *
 * @param stderr - ffmpeg stderr output.
 * @returns Duration in milliseconds, or null.
 */
export function parseDurationMs(stderr: string): number | null {
  const match = DURATION.exec(stderr);
  if (!match) return null;
  const [, h, m, s] = match;
  return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
}

function frameArgs(file: string, atSec: number): string[] {
  return [
    '-hide_banner',
    '-ss',
    String(atSec),
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1',
  ];
}

function runFfmpeg(
  ffmpegPath: string,
  file: string,
  atSec: number,
  signal: AbortSignal,
): Promise<VideoFrame> {
  const args = frameArgs(file, atSec);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { signal, windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', () =>
      resolve({ png: Buffer.concat(out), durationMs: parseDurationMs(stderr) }),
    );
  });
}

/**
 * Extracts a representative frame (at 1s, or the first frame for short clips).
 * ffmpeg applies the stream's rotation, so the frame is upright.
 *
 * @param ffmpegPath - Path to the ffmpeg binary.
 * @param file - Local video file.
 * @param signal - Cancellation signal.
 * @returns PNG bytes and the duration.
 * @throws Error when no frame can be decoded.
 */
export async function extractVideoFrame(
  ffmpegPath: string,
  file: string,
  signal: AbortSignal,
): Promise<VideoFrame> {
  const first = await runFfmpeg(ffmpegPath, file, 1, signal);
  if (first.png.length > 0) return first;
  const fallback = await runFfmpeg(ffmpegPath, file, 0, signal);
  if (fallback.png.length === 0) throw new Error('No decodable video frame');
  return fallback;
}
