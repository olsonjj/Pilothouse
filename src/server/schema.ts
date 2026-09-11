import { sqliteTable, text, integer, real, check, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
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
 * `endedAt` marks the end (NULL = current). GWC columns (ticket 09) ride on
 * the assignment: ratings belong to the person-in-seat, so history rows keep
 * theirs after ending. Nullable 0/1 ints validated at the seam (no DB CHECK —
 * ALTER TABLE ADD COLUMN CHECKs would desync drizzle-kit snapshots).
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
  /** GWC (ticket 09): null = unrated. */
  gwcGet: integer('gwc_get'),
  gwcWant: integer('gwc_want'),
  gwcCapacity: integer('gwc_capacity'),
  gwcNote: text('gwc_note'),
})

/**
 * V/TO (ticket 05): the single LIVE version of the Vision/Traction Organizer —
 * exactly one row (id 1), upserted on save. Every save also snapshots into
 * `vto_versions` (ticket 06); restoring copies a version back here AND appends
 * a new version (history is append-only). The column shape here mirrors that
 * table minus versioning fields (published_at, created_by). List-shaped fields
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

/**
 * Core values (ticket 07): first-class rows with STABLE IDs — the People
 * Analyzer (ticket 10) scores against core_values.id, so rows are never
 * deleted; deactivation flips `active` to 0 and they disappear from the
 * default (active-only) list while keeping their row and ID forever.
 */
export const coreValues = sqliteTable(
  'core_values',
  {
    ...mutableFields,
    name: text('name').notNull(),
    description: text('description'),
    /** Display order; managed via explicit reorder (0-based, contiguous). */
    sortOrder: integer('sort_order').notNull().default(0),
    /** 0/1: inactive values keep their ID (scores in ticket 10 reference them). */
    active: integer('active').notNull().default(1),
  },
  (t) => [
    check('core_values_active_check', sql`${t.active} IN (0, 1)`),
    check('core_values_sort_order_check', sql`${t.sortOrder} >= 0`),
    // Case-insensitive name uniqueness (COLLATE NOCASE) across ALL rows —
    // active and inactive — so a deactivated "Integrity" can't be shadowed by
    // a new "integrity" that would resurrect confusion. Documented decision.
    uniqueIndex('core_values_name_unique_idx').on(sql`${t.name} COLLATE NOCASE`),
  ],
)

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Quarter = typeof quarters.$inferSelect
export type Person = typeof people.$inferSelect
export type Seat = typeof seats.$inferSelect
export type SeatAssignment = typeof seatAssignments.$inferSelect
export type Vto = typeof vto.$inferSelect
export type VtoVersion = typeof vtoVersions.$inferSelect
export type CoreValue = typeof coreValues.$inferSelect
export type Role = 'admin' | 'member'

/**
 * People Analyzer scores (ticket 10): one row per (person, quarter, core
 * value). Scores are ADMIN-ONLY view + edit (sensitive — data-model.md access
 * rules). Re-entering a triple overwrites (unique index + upsert). Value IDs
 * are stable (ticket 07: rows never deleted) so scores survive renames and
 * deactivations; display joins core_values for names — never denormalized.
 */
export const peopleAnalyzerScores = sqliteTable(
  'people_analyzer_scores',
  {
    ...mutableFields,
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    quarterId: integer('quarter_id')
      .notNull()
      .references(() => quarters.id),
    coreValueId: integer('core_value_id')
      .notNull()
      .references(() => coreValues.id),
    /** '+' exemplifies, '-' mostly/needs work, '--' does not exemplify. */
    score: text('score').notNull(),
  },
  (t) => [
    check('people_analyzer_score_check', sql`${t.score} IN ('+', '-', '--')`),
    uniqueIndex('people_analyzer_unique_idx').on(t.personId, t.quarterId, t.coreValueId),
  ],
)

/**
 * V/TO version history (ticket 06): one immutable snapshot row per save.
 * Content columns mirror the live `vto` row (no id/created_at/updated_at of
 * their own meaning); plus published_at (snapshot time) and created_by (author
 * user). Immutable per data-model.md — baseFields only, no updated_at.
 * Current = newest by published_at, tie-broken by id. Restore = copy into the
 * live row + insert a NEW version row (never delete/overwrite).
 */
export const vtoVersions = sqliteTable('vto_versions', {
  ...baseFields,
  /** ISO timestamp the snapshot was published (== save time; restore time for restored snapshots). */
  publishedAt: text('published_at').notNull(),
  /** Author of the save (or restore) that produced this snapshot. */
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  // Content columns mirror the live `vto` row's columns exactly.
  coreFocusWhy: text('core_focus_why'),
  coreFocusWhat: text('core_focus_what'),
  tenYearTarget: text('ten_year_target'),
  tenYearTargetDate: text('ten_year_target_date'),
  marketingTargetMarket: text('marketing_target_market'),
  marketingThreeUniques: text('marketing_three_uniques').notNull().default(sql`'[]'`),
  marketingProvenProcess: text('marketing_proven_process'),
  marketingGuarantee: text('marketing_guarantee'),
  threeYearDate: text('three_year_date'),
  threeYearRevenue: integer('three_year_revenue'),
  threeYearProfit: integer('three_year_profit'),
  threeYearItems: text('three_year_items').notNull().default(sql`'[]'`),
  oneYearLabel: text('one_year_label'),
  oneYearRevenue: integer('one_year_revenue'),
  oneYearProfit: integer('one_year_profit'),
  oneYearItems: text('one_year_items').notNull().default(sql`'[]'`),
  oneYearPriorities: text('one_year_priorities').notNull().default(sql`'[]'`),
},
(t) => [
  check(
    'vto_versions_money_checks',
    sql`(${t.threeYearRevenue} IS NULL OR (${t.threeYearRevenue} >= 0 AND ${t.threeYearRevenue} = CAST(${t.threeYearRevenue} AS INTEGER)))
      AND (${t.threeYearProfit} IS NULL OR (${t.threeYearProfit} >= 0 AND ${t.threeYearProfit} = CAST(${t.threeYearProfit} AS INTEGER)))
      AND (${t.oneYearRevenue} IS NULL OR (${t.oneYearRevenue} >= 0 AND ${t.oneYearRevenue} = CAST(${t.oneYearRevenue} AS INTEGER)))
      AND (${t.oneYearProfit} IS NULL OR (${t.oneYearProfit} >= 0 AND ${t.oneYearProfit} = CAST(${t.oneYearProfit} AS INTEGER)))`,
  ),
],
)
export type PeopleAnalyzerScore = typeof peopleAnalyzerScores.$inferSelect

/**
 * To-dos (ticket 11): the 7-day action items. One line, one assignee; the due
 * date is FIXED at creation (+7 days, decided docs/specs/todos.md). `team_id`
 * from data-model.md is omitted (single company; teams table doesn't exist —
 * documented delta, add with team scoping if ever needed). The source columns
 * (`source_meeting_id`, `issue_source_id`) are plain nullable ints for now —
 * their referenced tables (meetings, issues) land in tickets 16/21, at which
 * point FKs can be added. Names follow data-model.md: `completed_at`,
 * `drop_reason` (required when dropped, seam-enforced).
 */
export const todos = sqliteTable(
  'todos',
  {
    ...mutableFields,
    title: text('title').notNull(),
    assigneePersonId: integer('assignee_person_id')
      .notNull()
      .references(() => people.id),
    /** Creator (contract: FK→users — any signed-in user can create, linked or not). */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** Date (YYYY-MM-DD), fixed at creation: created date + 7 days. */
    dueDate: text('due_date').notNull(),
    /** open / done / dropped. */
    status: text('status').notNull().default('open'),
    /** Set when status flips to done (immutable record thereafter). */
    completedAt: text('completed_at'),
    /** Required (non-empty) when status is 'dropped'. */
    dropReason: text('drop_reason'),
    /** Provenance (tickets 16/21+): FKs added when the target tables exist. */
    sourceMeetingId: integer('source_meeting_id'),
    issueSourceId: integer('issue_source_id'),
  },
  (t) => [check('todos_status_check', sql`${t.status} IN ('open', 'done', 'dropped')`)],
)
export type Todo = typeof todos.$inferSelect

/**
 * Scorecard metric definitions (ticket 13): the team's weekly pulse metrics.
 * `team_id` from data-model.md is omitted (single company; documented delta,
 * same as todos). Targets are REAL numbers — any finite value is allowed,
 * including 0 and negatives (e.g. "defects" targeting 0, or deviation-from-
 * baseline metrics targeting below zero; specs/scorecard.md imposes no sign
 * restriction and the seam validates finiteness). Retire = flip `active` to 0,
 * never delete — weekly entries (ticket 14) keep referencing the row.
 */
export const metrics = sqliteTable(
  'metrics',
  {
    ...mutableFields,
    name: text('name').notNull(),
    ownerPersonId: integer('owner_person_id')
      .notNull()
      .references(() => people.id),
    /** Weekly numeric target; compared with `direction` at entry time. */
    target: real('target').notNull(),
    /** 'gte' = at/above target is good (default); 'lte' = lower is better. */
    direction: text('direction').notNull().default('gte'),
    /** Optional display suffix, e.g. '%', '$', 'h'. */
    unit: text('unit'),
    /** 0/1: retired metrics keep their row and entry history (ticket 14). */
    active: integer('active').notNull().default(1),
  },
  (t) => [
    check('metrics_direction_check', sql`${t.direction} IN ('gte', 'lte')`),
    check('metrics_active_check', sql`${t.active} IN (0, 1)`),
  ],
)
export type Metric = typeof metrics.$inferSelect

/**
 * Weekly metric entries (ticket 14). One row per metric per week
 * (UNIQUE(metric_id, week)); re-entering overwrites the actual and re-captures
 * target_at_entry. Column naming delta vs data-model.md's sketch
 * (`value`/`entered_by`/`entered_at` -> `actual`/`entry_by` + base fields):
 * the module API speaks "actual vs target"; entered_at is covered by
 * created_at/updated_at (a re-entry IS the update). `week` is always the
 * Monday ISO date of the entry's week (derived via weekStart, never stored
 * raw). Entry permissions: admins any metric; the metric's owner their own
 * (specs/scorecard.md "owner (or any admin) enters"; member access rule
 * "own assigned metrics").
 */
export const metricEntries = sqliteTable(
  'metric_entries',
  {
    ...mutableFields,
    metricId: integer('metric_id')
      .notNull()
      .references(() => metrics.id),
    /** Monday ISO date of the entry week (derived week key, never stored raw). */
    week: text('week').notNull(),
    /** The number the owner entered this week. */
    actual: real('actual').notNull(),
    /** The metric's target in force when this entry was written. */
    targetAtEntry: real('target_at_entry').notNull(),
    entryBy: integer('entry_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex('metric_entries_metric_week_unique_idx').on(t.metricId, t.week)],
)
export type MetricEntry = typeof metricEntries.$inferSelect

/**
 * Team Issues List (ticket 16): one-line problem statements, classified
 * long-term (quarter) or short-term (week). `team_id` omitted (single
 * company, documented delta like todos/metrics). Status is DERIVED: open
 * until an issue_resolutions row exists — the issues row itself is never
 * status-bearing. Origin provenance (origin/origin_source_id) exists now;
 * only 'manual' is written in this ticket (others activate in ticket 20).
 * added_by/added_at are implemented as created_by→users + base created_at
 * (naming delta vs data-model.md, same as todos' created_by decision).
 * sort_order defaults to 0 — v1 ordering is creation order via the
 * created_at tie-break; no reorder API yet (specs/issues.md v1 note).
 */
export const issues = sqliteTable(
  'issues',
  {
    ...mutableFields,
    title: text('title').notNull(),
    /** 'long_term' = quarter list; 'short_term' = week list (derived weeks). */
    classification: text('classification').notNull(),
    /** Quarter context for long_term issues; always null for short_term. */
    quarterId: integer('quarter_id').references(() => quarters.id),
    origin: text('origin').notNull().default('manual'),
    originSourceId: integer('origin_source_id'),
    /** Creator (FK→users, works for unlinked accounts — todos decision). */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** Manual ordering field (v1: always 0; created_at breaks ties). */
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check(
      'issues_classification_check',
      sql`${t.classification} IN ('long_term', 'short_term')`,
    ),
    check(
      'issues_origin_check',
      sql`${t.origin} IN ('manual', 'from_rock', 'from_scorecard', 'from_todo', 'from_meeting')`,
    ),
  ],
)
export type Issue = typeof issues.$inferSelect

/**
 * Write-once resolution records (ticket 16). The row IS the state: an issue
 * is open until a resolution exists; solved/dropped is the outcome here.
 * Immutable per data-model.md — no updated_at, never edited or deleted.
 * Note is required for BOTH outcomes: solved needs the decision captured,
 * dropped needs the reason (same honesty rule as dropped to-dos).
 * meeting_id stays a plain nullable int until the meetings table lands
 * (ticket 21/24), then becomes an FK.
 */
export const issueResolutions = sqliteTable(
  'issue_resolutions',
  {
    ...baseFields,
    issueId: integer('issue_id')
      .notNull()
      .references(() => issues.id),
    meetingId: integer('meeting_id'),
    /** 'solved' (decided) or 'dropped' (no longer an issue / expired). */
    outcome: text('outcome').notNull(),
    /** Required non-empty for both outcomes (decision note / drop reason). */
    note: text('note').notNull(),
    resolvedBy: integer('resolved_by')
      .notNull()
      .references(() => users.id),
    resolvedAt: text('resolved_at').notNull(),
  },
  (t) => [
    uniqueIndex('issue_resolutions_issue_unique_idx').on(t.issueId),
    check('issue_resolutions_outcome_check', sql`${t.outcome} IN ('solved', 'dropped')`),
  ],
)
export type IssueResolution = typeof issueResolutions.$inferSelect

/**
 * Rocks (ticket 17): the quarter-scoped 3–7 priorities. `owner_person_id`
 * NULL = company rock (team-scoped per data-model; single company so
 * `team_id` is omitted — same documented delta as todos). Target + direction
 * mirror metrics and must co-occur (measuring rocks need both; binary rocks
 * have neither). `carried_over_from_rock_id` is reserved for ticket 19's
 * explicit carry-over (self-FK). `completed`/`completed_at` are quarter-end
 * scoring columns (ticket 19); NULL until then. Delta: data-model sketches
 * `target_direction`; named `direction` to mirror metrics.
 */
export const rocks = sqliteTable(
  'rocks',
  {
    ...mutableFields,
    statement: text('statement').notNull(),
    detail: text('detail'),
    ownerPersonId: integer('owner_person_id').references(() => people.id),
    quarterId: integer('quarter_id')
      .notNull()
      .references(() => quarters.id),
    target: real('target'),
    direction: text('direction'),
    /** Self-FK set only by ticket 19's explicit carry-over. */
    carriedOverFromRockId: integer('carried_over_from_rock_id').references(
      (): AnySQLiteColumn => rocks.id,
    ),
    /** 0/1/null; set only at quarter end (ticket 19). */
    completed: integer('completed'),
    completedAt: text('completed_at'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    // Measuring rocks need target AND direction together; binary rocks neither.
    check(
      'rocks_target_direction_check',
      sql`(${t.target} IS NULL AND ${t.direction} IS NULL) OR (${t.target} IS NOT NULL AND ${t.direction} IS NOT NULL)`,
    ),
    check('rocks_direction_check', sql`${t.direction} IS NULL OR ${t.direction} IN ('gte', 'lte')`),
    check('rocks_completed_check', sql`${t.completed} IS NULL OR ${t.completed} IN (0, 1)`),
  ],
)
export type Rock = typeof rocks.$inferSelect
