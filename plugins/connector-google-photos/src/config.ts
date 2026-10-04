import type { PluginContext } from '@photobeaver/plugin-sdk';

export type ImportMode = 'picker' | 'takeout';

export interface GooglePhotosConfig {
  mode?: ImportMode;
  root?: string;
}

export interface GooglePhotosSettings {
  clientId?: string;
  clientSecret?: string;
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export const MISSING_CLIENT =
  "Set your Google OAuth client ID and secret in the plugin's settings first";

/**
 * Whether a source reads a Google Takeout export instead of the Picker.
 *
 * @param config - Source config.
 * @returns True for Takeout sources.
 */
export function isTakeout(config: GooglePhotosConfig | undefined): boolean {
  return config?.mode === 'takeout';
}

/**
 * Reads the OAuth client from the plugin-wide settings.
 *
 * @param ctx - Any plugin context.
 * @returns The client ID and secret.
 * @throws Error when either value is missing.
 */
export async function readClient(ctx: Pick<PluginContext, 'settings'>): Promise<GoogleClient> {
  const settings = (await ctx.settings<GooglePhotosSettings | undefined>()) ?? {};
  const clientId = settings.clientId?.trim() ?? '';
  const clientSecret = settings.clientSecret?.trim() ?? '';
  if (clientId === '' || clientSecret === '') throw new Error(MISSING_CLIENT);
  return { clientId, clientSecret };
}
