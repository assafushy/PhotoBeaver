import ffmpegStatic from 'ffmpeg-static';

/**
 * Path to the bundled ffmpeg binary, pointing outside the asar archive when packaged.
 *
 * @returns Absolute path to ffmpeg.
 */
export function ffmpegPath(): string {
  const resolved = ffmpegStatic as unknown as string | null;
  if (!resolved) throw new Error('ffmpeg binary not found for this platform');
  return resolved
    .replace(`app.asar${'/'}`, `app.asar.unpacked/`)
    .replace('app.asar\\', 'app.asar.unpacked\\');
}
