import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

/**
 * Shared base fields, spread into each table definition (per data-model.md).
 * Mutable tables get `updated_at`; immutable tables (sessions, vto_versions,
 * issue_resolutions) skip it. NOT a polymorphic base table.
 */
const baseFields = {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}

const mutableFields = {
  ...baseFields,
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}

export function nowIso(): string {
  return new Date().toISOString()
}

export const users = sqliteTable(
  'users',
  {
    ...mutableFields,
    email: text('email').notNull().unique(),
    /** scrypt hash in `salt:hash` hex form (node:crypto scrypt) */
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
  },
  (t) => [check('users_role_check', sql`${t.role} IN ('admin', 'member')`)],
)

/** Immutable: sessions skip `updated_at` per data-model.md. */
export const sessions = sqliteTable('sessions', {
  ...baseFields,
  token: text('token').notNull().unique(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: text('expires_at').notNull(),
})

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Role = 'admin' | 'member'