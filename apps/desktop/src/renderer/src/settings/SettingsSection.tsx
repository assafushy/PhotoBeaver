import type { ReactNode } from 'react';

/**
 * One titled group of settings.
 *
 * @param props - Section title and its controls.
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
