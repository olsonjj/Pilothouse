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

/**
 * Immutable once seeded: quarters skip `updated_at` — rows are inserted by the
 * seeder and never updated (quarter boundaries are calendar facts).
 */
export const quarters = sqliteTable(
  'quarters',
  {
    ...baseFields,
    label: text('label').notNull().unique(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
  },
  (t) => [check('quarters_label_check', sql`${t.label} GLOB '[0-9][0-9][0-9][0-9] Q[1-4]'`)],
)

/** Seats are the nodes of the Accountability Chart (ticket 04). */
export const seats = sqliteTable(
  'seats',
  {
    ...mutableFields,
    name: text('name').notNull(),
    description: text('description'),
    /** Ordered responsibility bullets as a JSON text array (data-model.md). */
    responsibilities: text('responsibilities').notNull().default(sql`'[]'`),
    /** Self-referencing FK; NULL = top seat. */
    parentSeatId: integer('parent_seat_id'),
    /** Ordering among siblings. */
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [check('seats_sort_order_check', sql`${t.sortOrder} >= 0`)],
)

/**
 * Person-in-seat history (ticket 04). Rows are never deleted on reassignment —
 * `endedAt` marks the end (NULL = current). GWC columns land with ticket 09.
 */
export const seatAssignments = sqliteTable('seat_assignments', {
  ...mutableFields,
  personId: integer('person_id')
    .notNull()
    .references(() => people.id),
  seatId: integer('seat_id')
    .notNull()
    .references(() => seats.id),
  /** Date (YYYY-MM-DD) the person took the seat. */
  startedAt: text('started_at').notNull(),
  /** Date the assignment ended; NULL = currently active. */
  endedAt: text('ended_at'),
})

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Quarter = typeof quarters.$inferSelect
export type Person = typeof people.$inferSelect
export type Seat = typeof seats.$inferSelect
export type SeatAssignment = typeof seatAssignments.$inferSelect
export type Role = 'admin' | 'member'