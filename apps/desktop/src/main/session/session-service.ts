import { ROLE_PERMISSIONS, type SessionUser } from '@photobeaver/shared';
import { schema, type LibraryDb } from '@photobeaver/db';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

const IMPLICIT_ADMIN_NAME = 'Admin';

type UserRow = typeof schema.users.$inferSelect;

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    permissions: [...ROLE_PERMISSIONS[row.role]],
  };
}

function findFirstAdmin(db: LibraryDb): UserRow | undefined {
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'))
    .orderBy(asc(schema.users.createdAt))
    .limit(1)
    .get();
}

function createImplicitAdmin(db: LibraryDb): UserRow {
  return db
    .insert(schema.users)
    .values({ id: ulid(), displayName: IMPLICIT_ADMIN_NAME, role: 'admin', createdAt: Date.now() })
    .returning()
    .get();
}

/**
 * Holds the signed-in user. In single-user mode (SPEC 3.3) this is always
 * the implicit Admin, created on first run without a password.
 */
export class SessionService {
  private user: SessionUser | null = null;

  constructor(private readonly db: LibraryDb) {}

  /**
   * Ensures an Admin exists and signs it in.
   *
   * @returns The signed-in user.
   */
  bootstrap(): SessionUser {
    const admin = this.db.transaction((tx) => findFirstAdmin(tx) ?? createImplicitAdmin(tx));
    this.user = toSessionUser(admin);
    return this.user;
  }

  /**
   * Returns the current session user.
   *
   * @returns The signed-in user.
   * @throws Error when called before bootstrap.
   */
  current(): SessionUser {
    if (!this.user) throw new Error('Session not initialized');
    return this.user;
  }
}
