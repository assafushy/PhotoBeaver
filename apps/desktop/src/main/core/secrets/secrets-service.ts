import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';

/**
 * Encrypts secret blobs. In the app this is Electron `safeStorage` (OS keychain
 * backed); tests inject a reversible fake so the core stays headless.
 */
export interface SecretCipher {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

const { secrets } = schema;

/**
 * Key of a source's secret.
 *
 * @param sourceId - Source id.
 * @returns The secret ref stored in `sources.secret_ref`.
 */
export const sourceSecretRef = (sourceId: string): string => `source:${sourceId}`;

/**
 * Stores plugin secrets such as OAuth tokens, encrypted, in the `secrets` table
 * (SPEC 10: tokens only through safeStorage, never in plain text).
 */
export class SecretsService {
  constructor(
    private readonly db: LibraryDb,
    private readonly cipher: SecretCipher,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Reads and decrypts a secret.
   *
   * @param ref - Secret ref.
   * @returns The secret, or undefined when none is stored.
   */
  get(ref: string): Record<string, unknown> | undefined {
    const row = this.db
      .select({ ciphertext: secrets.ciphertext })
      .from(secrets)
      .where(eq(secrets.ref, ref))
      .get();
    return row
      ? (JSON.parse(this.cipher.decrypt(row.ciphertext)) as Record<string, unknown>)
      : undefined;
  }

  /**
   * Encrypts and stores a secret, replacing any previous value.
   *
   * @param ref - Secret ref.
   * @param value - JSON-serializable secret.
   */
  set(ref: string, value: Record<string, unknown>): void {
    const ciphertext = this.cipher.encrypt(JSON.stringify(value));
    const updatedAt = this.now();
    this.db
      .insert(secrets)
      .values({ ref, ciphertext, updatedAt })
      .onConflictDoUpdate({ target: secrets.ref, set: { ciphertext, updatedAt } })
      .run();
  }

  /**
   * Deletes a secret. Missing refs are ignored.
   *
   * @param ref - Secret ref.
   */
  delete(ref: string): void {
    this.db.delete(secrets).where(eq(secrets.ref, ref)).run();
  }
}
