import { schema, type LibraryDb } from '@photobeaver/db';
import {
  ROLE_PERMISSIONS,
  type PickerUser,
  type SessionState,
  type SessionUser,
} from '@photobeaver/shared';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { readScope, type AccessScope } from '../core/access/scope';
import { writeAudit } from '../core/audit';
import type { EventSink } from '../core/events/event-sink';
import { AttemptLimiter } from '../core/users/attempts';
import { hashSecret, normalizeRecoveryKey, verifySecret } from '../core/users/passwords';
import { requireUser, type UserRow } from '../core/users/user-rows';
import { userSettings } from '../core/users/user-settings';

const { users } = schema;
const IMPLICIT_ADMIN_NAME = 'Admin';

export interface SessionDeps {
  db: LibraryDb;
  events: EventSink;
  promptBiometric?: (reason: string) => Promise<boolean>;
  now?: () => number;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    permissions: [...ROLE_PERMISSIONS[row.role]],
  };
}

function firstAdmin(db: LibraryDb): UserRow | undefined {
  return db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, 0)))
    .orderBy(asc(users.createdAt))
    .get();
}

function createImplicitAdmin(db: LibraryDb): UserRow {
  return db
    .insert(users)
    .values({ id: ulid(), displayName: IMPLICIT_ADMIN_NAME, role: 'admin', createdAt: Date.now() })
    .returning()
    .get();
}

/**
 * Who is signed in (SPEC 3.3). In single-user mode that is always the implicit
 * Admin. With multiple users the app starts locked; signing in, locking and
 * switching change the current user, and with it the permissions and scope that
 * every IPC call and `pb-media` request is checked against.
 */
export class SessionService {
  private user: SessionUser | null = null;
  private currentScope: AccessScope | null = null;
  private readonly attempts = new AttemptLimiter();

  constructor(private readonly deps: SessionDeps) {}

  /**
   * Ensures an Admin exists; signs it in unless multiple users are on.
   *
   * @returns The admin row id.
   */
  bootstrap(): string {
    const admin = this.deps.db.transaction((tx) => firstAdmin(tx) ?? createImplicitAdmin(tx));
    if (!userSettings.multiUser(this.deps.db)) this.setUser(admin);
    return admin.id;
  }

  current(): SessionUser | null {
    return this.user;
  }

  scope(): AccessScope | null {
    return this.currentScope;
  }

  state(): SessionState {
    const multiUser = userSettings.multiUser(this.deps.db);
    return { state: this.user ? 'signedIn' : 'locked', user: this.user, multiUser };
  }

  /** People shown on the sign-in screen: enabled accounts that have a password or PIN. */
  pickerUsers(): PickerUser[] {
    return this.deps.db
      .select()
      .from(users)
      .where(and(eq(users.disabled, 0), isNotNull(users.secretHash)))
      .orderBy(asc(users.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        displayName: row.displayName,
        secretKind: row.secretKind ?? 'password',
        biometric: row.biometricEnabled === 1,
      }));
  }

  /**
   * Signs a user in with their password or PIN.
   *
   * @param userId - User id.
   * @param secret - Password or PIN.
   * @returns The signed-in user.
   */
  async signIn(userId: string, secret: string): Promise<SessionUser> {
    this.attempts.assertAllowed(userId);
    const row = requireUser(this.deps.db, userId);
    const ok =
      row.disabled === 0 && row.secretHash !== null && (await verifySecret(secret, row.secretHash));
    if (!ok) return this.rejectSignIn(userId);
    this.attempts.succeeded(userId);
    return this.completeSignIn(row, 'password');
  }

  /**
   * Signs a user in with Touch ID, when they turned it on.
   *
   * @param userId - User id.
   * @returns The signed-in user.
   */
  async signInBiometric(userId: string): Promise<SessionUser> {
    const row = requireUser(this.deps.db, userId);
    if (row.disabled === 1 || row.biometricEnabled !== 1 || !this.deps.promptBiometric)
      throw new Error('Touch ID is not set up for this account');
    if (!(await this.deps.promptBiometric(`sign in to Photo Beaver as ${row.displayName}`)))
      throw new Error('Touch ID did not confirm');
    return this.completeSignIn(row, 'biometric');
  }

  /**
   * Uses the recovery key to set a new password for the first Admin and sign in.
   *
   * @param recoveryKey - Key shown when multiple users were turned on.
   * @param newPassword - New Admin password.
   * @returns The signed-in Admin.
   */
  async recover(recoveryKey: string, newPassword: string): Promise<SessionUser> {
    this.attempts.assertAllowed('recovery');
    const hash = userSettings.recoveryHash(this.deps.db);
    if (!hash || !(await verifySecret(normalizeRecoveryKey(recoveryKey), hash)))
      return this.rejectSignIn('recovery');
    const admin = firstAdmin(this.deps.db);
    if (!admin) throw new Error('No Admin account');
    const secretHash = await hashSecret(newPassword);
    this.deps.db
      .update(users)
      .set({ secretHash, secretKind: 'password' })
      .where(eq(users.id, admin.id))
      .run();
    this.attempts.succeeded('recovery');
    return this.completeSignIn(requireUser(this.deps.db, admin.id), 'recovery');
  }

  /** Locks the app (multiple users only; single-user mode has nobody to switch to). */
  lock(): void {
    if (!userSettings.multiUser(this.deps.db) || !this.user) return;
    this.user = null;
    this.currentScope = null;
    this.deps.events.emit('session.changed', {});
  }

  /** Re-reads the signed-in user after an Admin changed their role, scope or status. */
  refresh(): void {
    if (!this.user) return;
    const row = this.deps.db.select().from(users).where(eq(users.id, this.user.id)).get();
    if (!row || row.disabled === 1) return this.forceLock();
    this.setUser(row);
    this.deps.events.emit('session.changed', {});
  }

  /** After multiple users are turned off, signs the implicit Admin back in. */
  resetToImplicitAdmin(): void {
    const admin = firstAdmin(this.deps.db);
    if (admin) this.setUser(admin);
    this.deps.events.emit('session.changed', {});
  }

  private forceLock(): void {
    this.user = null;
    this.currentScope = null;
    this.deps.events.emit('session.changed', {});
  }

  private rejectSignIn(key: string): never {
    this.attempts.failed(key);
    this.audit(key === 'recovery' ? null : key, 'auth.sign_in_failed');
    throw new Error('Wrong password, PIN or recovery key');
  }

  private completeSignIn(row: UserRow, method: string): SessionUser {
    const now = (this.deps.now ?? Date.now)();
    this.deps.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, row.id)).run();
    this.setUser(row);
    this.audit(row.id, 'auth.sign_in', { method });
    this.deps.events.emit('session.changed', {});
    return this.user!;
  }

  private setUser(row: UserRow): void {
    this.user = toSessionUser(row);
    this.currentScope = readScope(this.deps.db, row);
  }

  private audit(userId: string | null, action: string, details?: object): void {
    const entry = { userId, action, targetType: 'user', targetId: userId ?? undefined, details };
    writeAudit(this.deps.db, entry, (this.deps.now ?? Date.now)());
  }
}
