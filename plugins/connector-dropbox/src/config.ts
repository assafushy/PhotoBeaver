import type { PluginContext } from '@photobeaver/plugin-sdk';

export interface DropboxConfig {
  folder?: string;
}

export interface DropboxSettings {
  clientId?: string;
}

export const MISSING_APP_KEY = "Set your Dropbox app key in the plugin's settings first";

/**
 * Turns the folder the user typed into a Dropbox API path.
 *
 * @param folder - Folder from the source config, possibly empty or without a leading slash.
 * @returns "" for the whole Dropbox, otherwise "/a/b" with no trailing slash.
 */
export function normalizeFolder(folder: string | undefined): string {
  const trimmed = (folder ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Reads the Dropbox app key from the plugin-wide settings.
 *
 * @param ctx - Any plugin context.
 * @returns The app key.
 * @throws Error when the app key is not set.
 */
export async function readClientId(ctx: Pick<PluginContext, 'settings'>): Promise<string> {
  const settings = (await ctx.settings<DropboxSettings | undefined>()) ?? {};
  const clientId = settings.clientId?.trim() ?? '';
  if (clientId === '') throw new Error(MISSING_APP_KEY);
  return clientId;
}
