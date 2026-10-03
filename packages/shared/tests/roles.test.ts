import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } from '../src';

describe('roles', () => {
  it('grants admin every permission', () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('limits viewer to viewing', () => {
    expect([...ROLE_PERMISSIONS.viewer]).toEqual(['assets.view']);
  });

  it('lets editors merge but not manage sources or plugins', () => {
    expect(roleHasPermission('editor', 'duplicates.merge')).toBe(true);
    expect(roleHasPermission('editor', 'sources.manage')).toBe(false);
    expect(roleHasPermission('editor', 'plugins.manage')).toBe(false);
  });
});
