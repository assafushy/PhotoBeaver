import { schema } from '@photobeaver/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../src/main/session/session-service';
import { openTempLibrary, type TempLibrary } from './helpers';

describe('SessionService', () => {
  let temp: TempLibrary;

  beforeEach(async () => {
    temp = await openTempLibrary();
  });

  afterEach(() => temp.cleanup());

  it('creates a single implicit admin on first run', () => {
    const user = new SessionService(temp.library.db).bootstrap();
    expect(user.role).toBe('admin');
    expect(user.permissions).toContain('users.manage');
    expect(temp.library.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('reuses the existing admin on later runs', () => {
    const first = new SessionService(temp.library.db).bootstrap();
    const second = new SessionService(temp.library.db).bootstrap();
    expect(second.id).toBe(first.id);
    expect(temp.library.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('throws when read before bootstrap', () => {
    expect(() => new SessionService(temp.library.db).current()).toThrow(/not initialized/);
  });
});
