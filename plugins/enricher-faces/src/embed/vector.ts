/**
 * Scales a vector to unit length. A zero vector is returned unchanged.
 *
 * @param values - The vector.
 * @returns A new array with Euclidean norm 1.
 */
export function l2Normalize(values: ArrayLike<number>): number[] {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i]! * values[i]!;
  const norm = Math.sqrt(sum);
  return Array.from(values, (value) => (norm > 0 ? value / norm : value));
}

/**
 * Cosine distance (1 minus cosine similarity) between two vectors.
 *
 * @param a - First vector.
 * @param b - Second vector, same length.
 * @returns A value from 0 (same direction) to 2 (opposite).
 */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
