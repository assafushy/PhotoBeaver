/**
 * The message to show for a failed core request.
 *
 * @param error - Whatever was thrown.
 * @returns A readable message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
