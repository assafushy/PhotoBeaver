import { createHash, randomBytes } from 'node:crypto';

export interface Pkce {
  verifier: string;
  challenge: string;
}

/**
 * A PKCE pair (RFC 7636) with the S256 method.
 *
 * @returns Verifier and challenge, both base64url.
 */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * A random `state` value that ties the callback to this authorization.
 *
 * @returns A base64url string.
 */
export const createState = (): string => randomBytes(16).toString('base64url');
