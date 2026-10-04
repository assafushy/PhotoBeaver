import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const secrets = sqliteTable('secrets', {
  ref: text('ref').primaryKey(),
  ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
});
