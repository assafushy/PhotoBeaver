import { schema, type LibraryDb } from '@photobeaver/db';
import type { UserSummary, UsersSettings } from '@photobeaver/shared';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { writeAudit } from '../audit';
import { systemClock, type Clock } from '../clock';
import {
  assertSecretShape,
  hashSecret,
  newRecoveryKey,
  normalizeRecoveryKey,
  verifySecret,
} from './passwords';
import { assertNotLastAdmin, requireUser, toSummary, type UserRow } from './user-rows';
import { userSettings } from './user-settings';

const { users, userScopes } = schema;

type Role = UserRow['role'];

export interface NewUser {
  displayName: string;
  role: Role;
  secret: string;
  secretKind: 'password' | 'pin';
}

export interface UserChanges {
  id: string;
  displayName?: string;
  role?: Role;
  secret?: string;
  secretKind?: 'password' | 'pin';
  biometric?: boolean;
  disabled?: boolean;
}

/**
 * Local accounts and the multiple-users switch (SPEC 3.3). Every change is
 * audited, and no change may leave the library without an enabled Admin.
 */
export class UserService {
  private readonly clock: Clock;

  constructor(
    private readonly db: LibraryDb,
    clock?: Clock,
  ) {
    this.clock = clock ?? systemClock;
  }

  list(): UserSummary[] {
    const rows = this.db.select().from(users).orderBy(asc(users.createdAt)).all();
    return rows.map((row) => toSummary(this.db, row));
  }

  /**
   * Creates an account.
   *
   * @param draft - Name, role and password or PIN.
   * @param actorId - Admin doing it.
   * @returns The new user.
   */
  async create(draft: NewUser, actorId: string): Promise<UserSummary> {
    assertSecretShape(draft.secret, draft.secretKind);
    const secretHash = await hashSecret(draft.secret);
    const id = ulid(this.clock());
    const { displayName, role, secretKind } = draft;
    this.db
      .insert(users)
      .values({ id, displayName, role, secretHash, secretKind, createdAt: this.clock() })
      .run();
    this.audit(actorId, 'user.create', id, { displayName, role });
    return toSummary(this.db, requireUser(this.db, id));
  }

  /**
   * Changes an account (name, role, password or PIN, Touch ID, disabled).
   *
   * @param changes - What to change.
   * @param actorId - Admin doing it.
   * @returns The updated user.
   */
  async update(changes: UserChanges, actorId: string): Promise<UserSummary> {
    const row = requireUser(this.db, changes.id);
    const secret = await this.secretChanges(row, changes);
    this.db.transaction((tx) => {
      const db = tx as unknown as LibraryDb;
      if ((changes.role && changes.role !== 'admin') || changes.disabled)
        assertNotLastAdmin(db, row);
      db.update(users)
        .set({ ...this.plainChanges(changes), ...secret })
        .where(eq(users.id, row.id))
        .run();
    });
    this.audit(actorId, 'user.update', row.id, this.auditable(changes));
    return toSummary(this.db, requireUser(this.db, row.id));
  }

  /**
   * Deletes an account (its scopes go with it).
   *
   * @param id - User id.
   * @param actorId - Admin doing it.
   */
  delete(id: string, actorId: string): void {
    this.db.transaction((tx) => {
      const db = tx as unknown as LibraryDb;
      const row = requireUser(db, id);
      assertNotLastAdmin(db, row);
      db.delete(users).where(eq(users.id, id)).run();
    });
    this.audit(actorId, 'user.delete', id);
  }

  /**
   * Limits a Viewer or Editor to sources and albums (empty lists remove the limit).
   *
   * @param id - User id.
   * @param scopes - Visible sources and albums.
   * @param actorId - Admin doing it.
   */
  setScopes(
    id: string,
    scopes: { sourceIds: string[]; albumIds: string[] },
    actorId: string,
  ): void {
    if (requireUser(this.db, id).role === 'admin') throw new Error('Admins see the whole library');
    this.db.transaction((tx) => {
      tx.delete(userScopes).where(eq(userScopes.userId, id)).run();
      const rows = [
        ...scopes.sourceIds.map((scopeId) => ({
          userId: id,
          scopeType: 'source' as const,
          scopeId,
        })),
        ...scopes.albumIds.map((scopeId) => ({ userId: id, scopeType: 'album' as const, scopeId })),
      ];
      if (rows.length > 0) tx.insert(userScopes).values(rows).run();
    });
    this.audit(actorId, 'user.scopes', id, scopes);
  }

  settings(biometricAvailable: boolean): UsersSettings {
    return {
      multiUser: userSettings.multiUser(this.db),
      autoLockMinutes: userSettings.autoLockMinutes(this.db),
      biometricAvailable,
    };
  }

  /**
   * Turns on multiple users: the acting Admin gets a password, and a one-time
   * recovery key is created (only its hash is kept).
   *
   * @param actorId - The Admin.
   * @param password - The Admin's new password.
   * @returns The recovery key, shown once.
   */
  async enableMultiUser(actorId: string, password: string): Promise<string> {
    assertSecretShape(password, 'password');
    const recoveryKey = newRecoveryKey();
    const [secretHash, recoveryHash] = await Promise.all([
      hashSecret(password),
      hashSecret(normalizeRecoveryKey(recoveryKey)),
    ]);
    this.db.transaction((tx) => {
      const db = tx as unknown as LibraryDb;
      db.update(users)
        .set({ secretHash, secretKind: 'password' })
        .where(eq(users.id, actorId))
        .run();
      userSettings.setRecoveryHash(db, recoveryHash);
      userSettings.setMultiUser(db, true);
    });
    this.audit(actorId, 'users.multi_on');
    return recoveryKey;
  }

  /**
   * Turns multiple users off (back to the implicit Admin); accounts are kept.
   *
   * @param actorId - The Admin.
   * @param password - The Admin's password, to confirm.
   */
  async disableMultiUser(actorId: string, password: string): Promise<void> {
    const row = requireUser(this.db, actorId);
    if (!row.secretHash || !(await verifySecret(password, row.secretHash)))
      throw new Error('Wrong password');
    userSettings.setMultiUser(this.db, false);
    this.audit(actorId, 'users.multi_off');
  }

  setAutoLock(minutes: number, actorId: string): void {
    userSettings.setAutoLockMinutes(this.db, minutes);
    this.audit(actorId, 'users.auto_lock', undefined, { minutes });
  }

  private async secretChanges(row: UserRow, changes: UserChanges) {
    if (changes.secret === undefined) return {};
    const kind = changes.secretKind ?? row.secretKind ?? 'password';
    assertSecretShape(changes.secret, kind);
    return { secretHash: await hashSecret(changes.secret), secretKind: kind };
  }

  private plainChanges(changes: UserChanges) {
    const set: Partial<UserRow> = {};
    if (changes.displayName !== undefined) set.displayName = changes.displayName;
    if (changes.role !== undefined) set.role = changes.role;
    if (changes.biometric !== undefined) set.biometricEnabled = changes.biometric ? 1 : 0;
    if (changes.disabled !== undefined) set.disabled = changes.disabled ? 1 : 0;
    return set;
  }

  private auditable(changes: UserChanges): Record<string, unknown> {
    const { id: _id, secret, ...rest } = changes;
    return { ...rest, ...(secret === undefined ? {} : { secretChanged: true }) };
  }

  private audit(actorId: string, action: string, targetId?: string, details?: object): void {
    writeAudit(
      this.db,
      { userId: actorId, action, targetType: 'user', targetId, details },
      this.clock(),
    );
  }
}
