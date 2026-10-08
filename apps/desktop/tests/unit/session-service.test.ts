import { schema } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '../../src/main/core/users/user-service';
import { SessionService } from '../../src/main/session/session-service';
import { openTempLibrary, type TempLibrary } from './helpers';

describe('sessions and accounts', () => {
  let temp: TempLibrary;
  let events: string[];
  let biometricAnswer: boolean;
  const db = () => temp.library.db;
  const newSession = () =>
    new SessionService({
      db: db(),
      events: { emit: (name) => void events.push(name) },
      promptBiometric: async () => biometricAnswer,
    });

  beforeEach(async () => {
    temp = await openTempLibrary();
    events = [];
    biometricAnswer = true;
  });

  afterEach(() => temp.cleanup());

  it('signs the implicit admin in when there is a single user', () => {
    const session = newSession();
    const adminId = session.bootstrap();
    expect(session.state()).toMatchObject({
      state: 'signedIn',
      multiUser: false,
      user: { id: adminId, role: 'admin' },
    });
    expect(newSession().bootstrap()).toBe(adminId);
    expect(db().select().from(schema.users).all()).toHaveLength(1);
    session.lock();
    expect(session.current()?.id).toBe(adminId);
  });

  it('starts locked with multiple users, signs in with the password and locks again', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    const key = await new UserService(db()).enableMultiUser(adminId, 'correct horse');
    expect(key).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    const fresh = newSession();
    fresh.bootstrap();
    expect(fresh.state().state).toBe('locked');
    expect(fresh.pickerUsers().map((u) => u.id)).toEqual([adminId]);
    await expect(fresh.signIn(adminId, 'wrong pass')).rejects.toThrow(/Wrong/);
    expect((await fresh.signIn(adminId, 'correct horse')).role).toBe('admin');
    fresh.lock();
    expect(fresh.current()).toBeNull();
    expect(events).toContain('session.changed');
  });

  it('slows down repeated wrong guesses', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    await new UserService(db()).enableMultiUser(adminId, 'correct horse');
    for (let i = 0; i < 5; i++)
      await expect(session.signIn(adminId, 'nope nope')).rejects.toThrow(/Wrong/);
    await expect(session.signIn(adminId, 'correct horse')).rejects.toThrow(/Too many attempts/);
  });

  it('resets the admin password with the recovery key', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    const key = await new UserService(db()).enableMultiUser(adminId, 'correct horse');
    session.lock();
    await expect(session.recover('AAAA-BBBB', 'new password 1')).rejects.toThrow(/Wrong/);
    expect((await session.recover(key.toLowerCase().replace(/-/g, ' '), 'new password 1')).id).toBe(
      adminId,
    );
    session.lock();
    expect((await session.signIn(adminId, 'new password 1')).id).toBe(adminId);
  });

  it('uses Touch ID only for accounts that turned it on', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    const users = new UserService(db());
    await users.enableMultiUser(adminId, 'correct horse');
    session.lock();
    await expect(session.signInBiometric(adminId)).rejects.toThrow(/not set up/);
    await users.update({ id: adminId, biometric: true }, adminId);
    biometricAnswer = false;
    await expect(session.signInBiometric(adminId)).rejects.toThrow(/did not confirm/);
    biometricAnswer = true;
    expect((await session.signInBiometric(adminId)).id).toBe(adminId);
  });

  it('never leaves the library without an enabled admin', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    const users = new UserService(db());
    await expect(users.update({ id: adminId, role: 'editor' }, adminId)).rejects.toThrow(
      /at least one Admin/,
    );
    await expect(users.update({ id: adminId, disabled: true }, adminId)).rejects.toThrow(
      /at least one Admin/,
    );
    expect(() => users.delete(adminId, adminId)).toThrow(/at least one Admin/);
    const second = await users.create(
      { displayName: 'Dana', role: 'admin', secret: '1234', secretKind: 'pin' },
      adminId,
    );
    await users.update({ id: adminId, role: 'editor' }, adminId);
    expect(db().select().from(schema.users).where(eq(schema.users.id, adminId)).get()?.role).toBe(
      'editor',
    );
    expect(() => users.delete(second.id, adminId)).toThrow(/at least one Admin/);
  });

  it('validates PINs and passwords and keeps scopes for viewers only', async () => {
    const session = newSession();
    const adminId = session.bootstrap();
    const users = new UserService(db());
    await expect(
      users.create(
        { displayName: 'Kid', role: 'viewer', secret: '12a4', secretKind: 'pin' },
        adminId,
      ),
    ).rejects.toThrow(/PIN/);
    const kid = await users.create(
      { displayName: 'Kid', role: 'viewer', secret: '2468', secretKind: 'pin' },
      adminId,
    );
    users.setScopes(kid.id, { sourceIds: [], albumIds: ['family'] }, adminId);
    expect(users.list().find((u) => u.id === kid.id)?.scopes).toEqual({
      sourceIds: [],
      albumIds: ['family'],
    });
    expect(() => users.setScopes(adminId, { sourceIds: ['s'], albumIds: [] }, adminId)).toThrow(
      /Admins/,
    );
  });
});
