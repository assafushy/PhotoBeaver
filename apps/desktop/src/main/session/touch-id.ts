import { systemPreferences } from 'electron';

/**
 * Whether this computer can use Touch ID (macOS only; Windows Hello later).
 *
 * @returns True on a Mac with Touch ID set up.
 */
export function touchIdAvailable(): boolean {
  return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
}

/**
 * Asks for Touch ID.
 *
 * @param reason - Shown by macOS: "Photo Beaver is trying to <reason>".
 * @returns True when the user confirmed.
 */
export async function promptTouchId(reason: string): Promise<boolean> {
  if (!touchIdAvailable()) return false;
  return systemPreferences.promptTouchID(reason).then(
    () => true,
    () => false,
  );
}
