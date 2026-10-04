import { schema } from '@photobeaver/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretsService } from '../../src/main/core/secrets/secrets-service';
import { fakeCipher, openTempLibrary, type TempLibrary } from './helpers';

describe('SecretsService', () => {
  let temp: TempLibrary;
  let secrets: SecretsService;

  beforeEach(async () => {
    temp = await openTempLibrary();
    secrets = new SecretsService(temp.library.db, fakeCipher);
  });

  afterEach(() => temp.cleanup());

  it('round-trips a secret and never stores it as plain JSON', () => {
    secrets.set('source:a', { accessToken: 'tok-123' });
    expect(secrets.get('source:a')).toEqual({ accessToken: 'tok-123' });
    const stored = temp.library.db.select().from(schema.secrets).get()!;
    expect(stored.ciphertext.toString()).not.toContain('tok-123');
  });

  it('replaces and deletes secrets', () => {
    secrets.set('source:a', { v: 1 });
    secrets.set('source:a', { v: 2 });
    expect(secrets.get('source:a')).toEqual({ v: 2 });
    secrets.delete('source:a');
    expect(secrets.get('source:a')).toBeUndefined();
    expect(() => secrets.delete('missing')).not.toThrow();
  });
});
