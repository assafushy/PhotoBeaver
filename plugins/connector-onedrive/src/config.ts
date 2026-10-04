export interface OneDriveConfig {
  folder?: string;
}

export interface OneDriveSettings {
  clientId?: string;
}

/**
 * Normalizes the configured folder to a drive-relative path without leading or trailing slashes.
 *
 * @param config - Source config.
 * @returns The folder path, or '' for the whole drive.
 */
export function folderOf(config: OneDriveConfig): string {
  return (config.folder ?? '').trim().replace(/^\/+|\/+$/g, '');
}
