import { sqliteTable, text, integer, check, uniqueIndex } from 'drizzle-orm/sqlite-core'
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

/** Login link lives on users.person_id (one direction only); people are the source of truth for names. */
export const people = sqliteTable(
  'people',
  {
    ...mutableFields,
    fullName: text('full_name').notNull(),
    email: text('email'),
    /** Date only (YYYY-MM-DD) — time-of-day is meaningless here. */
    startDate: text('start_date'),
  },
  (t) => [
    // Partial unique: emails are unique when present; unlinked/null allowed.
    uniqueIndex('people_email_unique_idx').on(t.email).where(sql`${t.email} IS NOT NULL`),
  ],
)

export const users = sqliteTable(
  'users',
  {
    ...mutableFields,
    email: text('email').notNull().unique(),
    /** scrypt hash in `salt:hash` hex form (node:crypto scrypt) */
    passwordHash: text('password_hash').notNull(),
    /** Denormalized fallback display name; once person_id is set, people.full_name wins. */
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    personId: integer('person_id').references(() => people.id),
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
export type Person = typeof people.$inferSelect
export type Role = 'admin' | 'member'