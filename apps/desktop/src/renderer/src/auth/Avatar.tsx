/**
 * The initials of a display name, at most two letters.
 *
 * @param name - Display name.
 * @returns Upper-case initials.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((word) => word[0]!.toUpperCase()).join('') || '?';
}

/**
 * A round avatar showing the user's initials.
 *
 * @param props - Display name and size.
 */
export function Avatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const dimensions = size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-8 w-8 text-xs';
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full bg-amber-500 font-semibold text-white ${dimensions}`}
    >
      {initials(name)}
    </span>
  );
}
