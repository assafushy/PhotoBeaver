import type { Permission } from './permissions';

export const ROLES = ['viewer', 'editor', 'admin'] as const;

export type Role = (typeof ROLES)[number];

const VIEWER_PERMISSIONS: readonly Permission[] = ['assets.view'];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  'assets.edit',
  'assets.export',
  'albums.edit',
  'people.edit',
  'duplicates.merge',
  'sources.sync',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...EDITOR_PERMISSIONS,
  'sources.manage',
  'plugins.manage',
  'users.manage',
  'library.admin',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  viewer: new Set(VIEWER_PERMISSIONS),
  editor: new Set(EDITOR_PERMISSIONS),
  admin: new Set(ADMIN_PERMISSIONS),
};

/**
 * Checks whether a role grants a permission.
 *
 * @param role - The role to check.
 * @param permission - The permission required.
 * @returns True when the role includes the permission.
 */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
