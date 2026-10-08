import type { Permission } from '@photobeaver/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCan } from '../session/use-session';

/**
 * Renders a screen only for users with the permission; everyone else goes to
 * the library. Core refuses the requests anyway; this keeps the UI tidy.
 *
 * @param props - The permission and the screen.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  return allowed ? <>{children}</> : <Navigate to="/library" replace />;
}
