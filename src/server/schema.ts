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

/**
 * V/TO (ticket 05): the single LIVE version of the Vision/Traction Organizer —
 * exactly one row (id 1), upserted on save. Ticket 06 turns this into the
 * `vto_versions` snapshot model (data-model.md); the column shape here mirrors
 * that table minus versioning fields (published_at, created_by), so the
 * migration is a copy-row-into-new-versions, not a reshape. List-shaped fields
 * are JSON text arrays. Core values are NOT here — first-class rows in ticket
 * 07. Financial figures are plain non-negative integers (whole dollars).
 */
export const vto = sqliteTable('vto', {
  ...mutableFields,
  /** Question 2: why we exist (required). */
  coreFocusWhy: text('core_focus_why'),
  /** Question 2: what we do — the tagline (required). */
  coreFocusWhat: text('core_focus_what'),
  /** Question 3: the big measurable goal. */
  tenYearTarget: text('ten_year_target'),
  /** Optional target date (YYYY-MM-DD). */
  tenYearTargetDate: text('ten_year_target_date'),
  /** Question 4 sub-fields (target market / proven process / guarantee as text; uniques as JSON list). */
  marketingTargetMarket: text('marketing_target_market'),
  /** JSON string array — exactly the three uniques (EOS prescribes three). */
  marketingThreeUniques: text('marketing_three_uniques').notNull().default(sql`'[]'`),
  marketingProvenProcess: text('marketing_proven_process'),
  marketingGuarantee: text('marketing_guarantee'),
  /** Question 5: 3-Year Picture (date + whole-dollar figures + "looks like" items). */
  threeYearDate: text('three_year_date'),
  threeYearRevenue: integer('three_year_revenue'),
  threeYearProfit: integer('three_year_profit'),
  threeYearItems: text('three_year_items').notNull().default(sql`'[]'`),
  /** Question 6: 1-Year Plan (label/year + figures + items + priorities). */
  oneYearLabel: text('one_year_label'),
  oneYearRevenue: integer('one_year_revenue'),
  oneYearProfit: integer('one_year_profit'),
  oneYearItems: text('one_year_items').notNull().default(sql`'[]'`),
  oneYearPriorities: text('one_year_priorities').notNull().default(sql`'[]'`),
},
(t) => [
  check(
    'vto_money_checks',
    sql`(${t.threeYearRevenue} IS NULL OR (${t.threeYearRevenue} >= 0 AND ${t.threeYearRevenue} = CAST(${t.threeYearRevenue} AS INTEGER)))
      AND (${t.threeYearProfit} IS NULL OR (${t.threeYearProfit} >= 0 AND ${t.threeYearProfit} = CAST(${t.threeYearProfit} AS INTEGER)))
      AND (${t.oneYearRevenue} IS NULL OR (${t.oneYearRevenue} >= 0 AND ${t.oneYearRevenue} = CAST(${t.oneYearRevenue} AS INTEGER)))
      AND (${t.oneYearProfit} IS NULL OR (${t.oneYearProfit} >= 0 AND ${t.oneYearProfit} = CAST(${t.oneYearProfit} AS INTEGER)))`,
  ),
],
)

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Quarter = typeof quarters.$inferSelect
export type Person = typeof people.$inferSelect
export type Seat = typeof seats.$inferSelect
export type SeatAssignment = typeof seatAssignments.$inferSelect
export type Vto = typeof vto.$inferSelect
export type Role = 'admin' | 'member'