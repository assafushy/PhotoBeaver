export const PERMISSIONS = [
  'assets.view',
  'assets.edit',
  'assets.export',
  'albums.edit',
  'people.edit',
  'duplicates.merge',
  'sources.sync',
  'sources.manage',
  'plugins.manage',
  'users.manage',
  'library.admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
