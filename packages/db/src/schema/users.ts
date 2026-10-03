import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarPath: text('avatar_path'),
  role: text('role', { enum: ['viewer', 'editor', 'admin'] }).notNull(),
  secretHash: text('secret_hash'),
  secretKind: text('secret_kind', { enum: ['password', 'pin'] }),
  biometricEnabled: integer('biometric_enabled').default(0),
  disabled: integer('disabled').default(0),
  createdAt: integer('created_at'),
  lastLoginAt: integer('last_login_at'),
});

export const userScopes = sqliteTable(
  'user_scopes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type', { enum: ['source', 'album'] }).notNull(),
    scopeId: text('scope_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scopeType, t.scopeId] })],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detailsJson: text('details_json'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt)],
);
