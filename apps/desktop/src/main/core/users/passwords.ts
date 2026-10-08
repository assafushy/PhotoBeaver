import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

const PARAMS = { iterations: 2, memorySize: 19_456, parallelism: 1, hashLength: 32 } as const;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * argon2id hash of a password, PIN or recovery key (OWASP parameters), in the
 * standard encoded form that includes the salt.
 *
 * @param secret - The secret.
 * @returns Encoded hash.
 */
export function hashSecret(secret: string): Promise<string> {
  return argon2id({ ...PARAMS, password: secret, salt: randomBytes(16), outputType: 'encoded' });
}

/**
 * Checks a secret against an encoded argon2id hash.
 *
 * @param secret - What the user typed.
 * @param hash - Stored hash.
 * @returns True when it matches.
 */
export function verifySecret(secret: string, hash: string): Promise<boolean> {
  return argon2Verify({ password: secret, hash }).catch(() => false);
}

/**
 * Checks the shape of a new password or PIN (SPEC 3.3: PINs are 4 to 8 digits).
 *
 * @param secret - The new secret.
 * @param kind - Password or PIN.
 * @throws Error describing what is wrong.
 */
export function assertSecretShape(secret: string, kind: 'password' | 'pin'): void {
  if (kind === 'pin' && !/^\d{4,8}$/.test(secret)) throw new Error('A PIN is 4 to 8 digits');
  if (kind === 'password' && secret.length < 8)
    throw new Error('A password needs at least 8 characters');
}

/**
 * A one-time recovery key: 24 characters from an unambiguous alphabet, in groups of 4.
 *
 * @returns The key, e.g. "K7QM-2XRA-...".
 */
export function newRecoveryKey(): string {
  const bytes = randomBytes(24);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

/**
 * Recovery keys are compared without dashes, spaces or case.
 *
 * @param key - Key as typed.
 * @returns Normalized key.
 */
export const normalizeRecoveryKey = (key: string): string =>
  key.replace(/[\s-]/g, '').toUpperCase();
