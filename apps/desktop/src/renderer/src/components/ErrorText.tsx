import type { ReactNode } from 'react';

/**
 * An inline error message announced to assistive technology.
 *
 * @param props - The message and optional class names.
 */
export function ErrorText({
  children,
  className = 'text-sm text-red-600',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="alert" className={className}>
      {children}
    </p>
  );
}
