import { safeStorage } from 'electron';
import type { SecretCipher } from '../core/secrets/secrets-service';

export const NO_KEYRING_MESSAGE =
  'Photo Beaver needs a system keyring to store sign-in tokens. Install GNOME Keyring or KWallet and restart the app.';

function assertSecureBackend(): void {
  const plaintextBackend =
    process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
  if (!safeStorage.isEncryptionAvailable() || plaintextBackend) throw new Error(NO_KEYRING_MESSAGE);
}

/**
 * Electron `safeStorage` cipher (OS keychain backed). Refuses to work with the
 * Linux `basic_text` backend, which would store tokens effectively in plain text.
 *
 * @returns The cipher.
 */
export function safeStorageCipher(): SecretCipher {
  return {
    encrypt: (plaintext) => (assertSecureBackend(), safeStorage.encryptString(plaintext)),
    decrypt: (ciphertext) => (assertSecureBackend(), safeStorage.decryptString(ciphertext)),
  };
}
