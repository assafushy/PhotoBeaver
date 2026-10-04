let supported: boolean | undefined;

/**
 * Whether this machine can create a WebGL context, which MapLibre needs.
 * Checked once and cached.
 *
 * @returns True when WebGL 2 or WebGL 1 is available.
 */
export function supportsWebGl(): boolean {
  if (supported === undefined) {
    const canvas = document.createElement('canvas');
    supported = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  }
  return supported;
}
