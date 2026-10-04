const utf8 = new TextDecoder('utf-8', { fatal: true });

function isLatin1WithHighBytes(text: string): boolean {
  let high = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0xff) return false;
    if (code > 0x7f) high = true;
  }
  return high;
}

function decodeLatin1AsUtf8(text: string): string | undefined {
  try {
    return utf8.decode(Buffer.from(text, 'latin1'));
  } catch {
    return undefined;
  }
}

/**
 * Repairs Meta export strings where every UTF-8 byte was written as its own
 * `\u00XX` character, e.g. `CafÃ©` becomes `Café`. Strings that are not valid
 * UTF-8 once read back as bytes, or that contain characters above U+00FF, are
 * returned unchanged.
 *
 * @param text - A string from a Facebook or Instagram JSON export.
 * @returns The repaired string, or the input when no repair applies.
 */
export function fixMojibake(text: string): string {
  if (!isLatin1WithHighBytes(text)) return text;
  return decodeLatin1AsUtf8(text) ?? text;
}

/**
 * Applies `fixMojibake` to every string value in nested objects and arrays.
 * Object keys are left as they are.
 *
 * @param value - Parsed JSON data.
 * @returns A repaired copy with the same shape.
 */
export function fixMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') return fixMojibake(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => fixMojibakeDeep(item)) as T;
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, fixMojibakeDeep(item)]);
  return Object.fromEntries(entries) as T;
}
