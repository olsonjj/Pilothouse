import type { Db } from './db'
import { rocks, people, quarters, rockStatuses, type Rock, type RockStatus } from './schema'
import { getCurrentUser } from './auth'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { normalizeWeek } from './week'

/**
 * Rocks domain module (ticket 17): quarter-scoped 3–7 priorities.
 *
 * Permissions (docs/specs/rocks.md + data-model.md access rules, ticket-17
 * decision): admins create company rocks (owner NULL) and personal rocks for
 * anyone; members create personal rocks for THEMSELVES only (a member's rock
 * must be owned by their linked person). Editing follows the same rule: admin
 * any, member own. Past quarters (end_date < today) are read-only history —
 * EOS quarter-end scoring (ticket 19) freezes them; pre-scoring writes are
 * rejected the same way to keep the freeze boundary at a single date.
 *
 * The 7-rock cap is a soft nudge (never a block): creating the 8th company
 * rock in a quarter or a person's 8th personal rock returns
 * { ok: true, warning: 'over_rock_cap' }.
 */

export const ROCK_CAP = 7

export type RockInput = {
  statement: string
  detail?: string | null
  ownerPersonId?: number | null
  quarterId: number
  target?: number | null
  direction?: 'gte' | 'lte' | null
}

export type RockError =
  | 'unauthenticated'
  | 'forbidden'
  | 'statement_required'
  | 'invalid_target'
  | 'invalid_direction'
  | 'target_direction_mismatch'
  | 'quarter_required'
  | 'quarter_not_found'
  | 'quarter_read_only'
  | 'owner_not_found'
  | 'rock_not_found'

export type RockResult<T> =
  | { ok: true; value: T; warning?: 'over_rock_cap' }
  | { ok: false; error: RockError }

export type RockWithOwner = Rock & {
  /** Full name from people; null for company rocks. */
  ownerName: string | null
}

export type RockList = {
  company: RockWithOwner[]
  personal: RockWithOwner[]
}

function trimStatement(statement: string | null | undefined): string | null {
  const trimmed = statement?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function validateTarget(
  target: number | null | undefined,
  direction: 'gte' | 'lte' | null | undefined,
):
  | { ok: true; target: number | null; direction: 'gte' | 'lte' | null }
  | { ok: false; error: RockError } {
  const hasTarget = target != null
  const hasDirection = direction != null
  if (hasTarget !== hasDirection) return { ok: false, error: 'target_direction_mismatch' }
  if (hasTarget) {
    if (!Number.isFinite(target)) return { ok: false, error: 'invalid_target' }
    if (direction !== 'gte' && direction !== 'lte') {
      return { ok: false, error: 'invalid_direction' }
    }
    return { ok: true, target, direction }
  }
  return { ok: true, target: null, direction: null }
}

/** The rock cap warning check: >7 company in quarter / >7 per person. */
async function capExceeded(
  db: Db,
  quarterId: number,
  ownerPersonId: number | null,
): Promise<boolean> {
  if (ownerPersonId == null) {
    const row = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(rocks)
      .where(and(eq(rocks.quarterId, quarterId), sql`${rocks.ownerPersonId} IS NULL`))
      .get()
    // count of existing company rocks >= 7 means the new one is the 8th.
    return Number(row?.n ?? 0) > ROCK_CAP
  }
  const row = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(rocks)
    .where(and(eq(rocks.quarterId, quarterId), eq(rocks.ownerPersonId, ownerPersonId)))
    .get()
  // Checked AFTER insert: warn when the new count is ABOVE the cap (8th rock).
  return Number(row?.n ?? 0) > ROCK_CAP
}

/** Whether writes are allowed: quarter must exist and not have ended. */
async function quarterWritable(
  db: Db,
  quarterId: number,
  today = todayIsoSafe(),
): Promise<{ ok: true } | { ok: false; error: RockError }> {
  const quarter = await db.select().from(quarters).where(eq(quarters.id, quarterId)).get()
  if (!quarter) return { ok: false, error: 'quarter_not_found' }
  // Past quarter = frozen history (spec: completed/closed quarters read-only).
  if (quarter.endDate < today) return { ok: false, error: 'quarter_read_only' }
  return { ok: true }
}

function todayIsoSafe(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Shared insert used by create paths after all validation. */
async function insertRock(
  db: Db,
  userId: number,
  input: RockInput,
  target: number | null,
  direction: 'gte' | 'lte' | null,
): Promise<Rock> {
  const [row] = await db
    .insert(rocks)
    .values({
      statement: input.statement.trim(),
      detail: input.detail?.trim() || null,
      ownerPersonId: input.ownerPersonId ?? null,
      quarterId: input.quarterId,
      target,
      direction,
      createdBy: userId,
    })
    .returning()
  return row!
}

export async function createRock(
  db: Db,
  token: string | undefined,
  input: RockInput,
  today = todayIsoSafe(),
): Promise<RockResult<Rock>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return { ok: false, error: 'unauthenticated' }
  const user = auth.user

  const statement = trimStatement(input.statement)
  if (!statement) return { ok: false, error: 'statement_required' }
  const validated = validateTarget(input.target, input.direction)
  if (!validated.ok) return validated

  const writable = await quarterWritable(db, input.quarterId, today)
  if (!writable.ok) return writable

  // Permission + owner resolution.
  let ownerPersonId: number | null
  if (input.ownerPersonId == null) {
    // Company rock: admins only.
    if (user.role !== 'admin') return { ok: false, error: 'forbidden' }
    ownerPersonId = null
  } else {
    if (user.role !== 'admin' && user.personId !== input.ownerPersonId) {
      return { ok: false, error: 'forbidden' }
    }
    const person = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, input.ownerPersonId))
      .get()
    if (!person) return { ok: false, error: 'owner_not_found' }
    ownerPersonId = input.ownerPersonId
  }

  const rock = await insertRock(db, user.id, { ...input, statement }, validated.target, validated.direction)

  // Soft cap nudge (never blocks — checked AFTER insert so the count includes it).
  const warned = await capExceeded(db, input.quarterId, ownerPersonId)
  return warned ? { ok: true, value: rock, warning: 'over_rock_cap' } : { ok: true, value: rock }
}

export async function updateRock(
  db: Db,
  token: string | undefined,
  rockId: number,
  input: Partial<Omit<RockInput, 'quarterId'>>, // quarter is immutable (quarter-scoped rock)
  today = todayIsoSafe(),
): Promise<RockResult<Rock>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return { ok: false, error: 'unauthenticated' }
  const user = auth.user

  const existing = await db.select().from(rocks).where(eq(rocks.id, rockId)).get()
  if (!existing) return { ok: false, error: 'rock_not_found' }

  // Members edit only their own personal rocks; admins edit any.
  if (user.role !== 'admin' && user.personId !== existing.ownerPersonId) {
    return { ok: false, error: 'forbidden' }
  }

  const writable = await quarterWritable(db, existing.quarterId, today)
  if (!writable.ok) return writable

  const statement =
    input.statement !== undefined ? trimStatement(input.statement) : existing.statement
  if (!statement) return { ok: false, error: 'statement_required' }

  // Co-occurrence validated against the merged target/direction pair.
  const mergedTarget = input.target !== undefined ? input.target : existing.target
  const mergedDirection =
    input.direction !== undefined ? input.direction : (existing.direction as 'gte' | 'lte' | null)
  const validated = validateTarget(mergedTarget, mergedDirection)
  if (!validated.ok) return validated

  const [rock] = await db
    .update(rocks)
    .set({
      statement,
      detail:
        input.detail !== undefined ? (input.detail?.trim() || null) : existing.detail,
      target: validated.target,
      direction: validated.direction,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(rocks.id, rockId))
    .returning()
  return { ok: true, value: rock! }
}

/**
 * All rocks in a quarter with owner names (SQL-aliased join — see db.ts
 * constraint), grouped company vs personal. Everyone signed in can view.
 */
export async function listRocks(
  db: Db,
  token: string | undefined,
  quarterId: number,
): Promise<RockResult<RockList>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth

  const quarter = await db
    .select({ id: quarters.id })
    .from(quarters)
    .where(eq(quarters.id, quarterId))
    .get()
  if (!quarter) return { ok: false, error: 'quarter_not_found' }

  const rows = await db
    .select({
      id: sql<number>`"rocks"."id"`.as('r_id'),
      createdAt: sql<string>`"rocks"."created_at"`.as('r_created_at'),
      updatedAt: sql<string>`"rocks"."updated_at"`.as('r_updated_at'),
      statement: sql<string>`"rocks"."statement"`.as('r_statement'),
      detail: sql<string | null>`"rocks"."detail"`.as('r_detail'),
      ownerPersonId: sql<number | null>`"rocks"."owner_person_id"`.as('r_owner_person_id'),
      quarterId: sql<number>`"rocks"."quarter_id"`.as('r_quarter_id'),
      target: sql<number | null>`"rocks"."target"`.as('r_target'),
      direction: sql<string | null>`"rocks"."direction"`.as('r_direction'),
      carriedOverFromRockId: sql<number | null>`"rocks"."carried_over_from_rock_id"`.as(
        'r_carried_over',
      ),
      completed: sql<number | null>`"rocks"."completed"`.as('r_completed'),
      completedAt: sql<string | null>`"rocks"."completed_at"`.as('r_completed_at'),
      createdBy: sql<number>`"rocks"."created_by"`.as('r_created_by'),
      ownerName: sql<string | null>`"people"."full_name"`.as('p_full_name'),
    })
    .from(rocks)
    .leftJoin(people, eq(rocks.ownerPersonId, people.id))
    .where(eq(rocks.quarterId, quarterId))
    .orderBy(asc(sql`"rocks"."id"`))

  const withOwners: RockWithOwner[] = rows.map((r) => ({
    id: Number(r.id),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    statement: r.statement,
    detail: r.detail,
    ownerPersonId: r.ownerPersonId == null ? null : Number(r.ownerPersonId),
    quarterId: Number(r.quarterId),
    target: r.target == null ? null : Number(r.target),
    direction: (r.direction as 'gte' | 'lte' | null) ?? null,
    carriedOverFromRockId: r.carriedOverFromRockId == null ? null : Number(r.carriedOverFromRockId),
    completed: r.completed == null ? null : Number(r.completed),
    completedAt: r.completedAt,
    createdBy: Number(r.createdBy),
    ownerName: r.ownerName ?? null,
  }))

  return {
    ok: true,
    value: {
      company: withOwners.filter((r) => r.ownerPersonId == null),
      personal: withOwners.filter((r) => r.ownerPersonId != null),
    },
  }
}
// ---------------------------------------------------------------------------
// Weekly statuses (ticket 18)
// ---------------------------------------------------------------------------

export const STATUS_COMMENT_CAP = 200

export type RockStatusValue = 'on_track' | 'off_track' | 'measuring'

export type StatusInput = {
  status: RockStatusValue
  actual?: unknown
  comment?: string | null
}

export type StatusError =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_status'
  | 'invalid_week'
  | 'measuring_requires_target'
  | 'invalid_actual'
  | 'actual_not_allowed'
  | 'comment_too_long'
  | 'quarter_read_only'
  | 'quarter_not_found'

export type StatusResult<T> = { ok: true; value: T } | { ok: false; error: StatusError }

const STATUS_VALUES: readonly string[] = ['on_track', 'off_track', 'measuring']

function normalizeActualNumber(actual: unknown): number | null {
  if (typeof actual === 'number' && Number.isFinite(actual)) return actual
  if (typeof actual === 'string' && actual.trim() !== '') {
    const n = Number(actual)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Set (or overwrite) one rock's status for one week. Permissions mirror the
 * scorecard's setEntry (docs/specs/rocks.md + access rules): admin any rock,
 * the rock's owner their own, other members forbidden. Week normalizes to its
 * Monday via weekStart; the past-quarter freeze reuses quarterWritable.
 *
 * Decisions (documented in data-model.md):
 * - `actual` on on_track/off_track is REJECTED (not ignored) — silently
 *   dropping data would hide confusion; measuring-without-actual is likewise
 *   rejected.
 * - `comment` is one line, capped at 200 chars (STATUS_COMMENT_CAP).
 */
export async function setStatus(
  db: Db,
  token: string | undefined,
  rockId: number,
  week: unknown,
  input: StatusInput,
  today = todayIsoSafe(),
): Promise<StatusResult<RockStatus>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rock = await db.select().from(rocks).where(eq(rocks.id, rockId)).get()
  if (!rock) return { ok: false, error: 'not_found' }
  if (auth.user.role !== 'admin' && auth.user.personId !== rock.ownerPersonId) {
    return { ok: false, error: 'forbidden' }
  }
  if (!STATUS_VALUES.includes(input.status)) return { ok: false, error: 'invalid_status' }

  const weekMonday = normalizeWeek(week)
  if (!weekMonday) return { ok: false, error: 'invalid_week' }

  // Statuses live in the writable-quarter discipline: the freeze boundary is
  // the same single calendar date as rock creation/edits (ticket 17).
  const writable = await quarterWritable(db, rock.quarterId, today)
  if (!writable.ok) return { ok: false, error: writable.error as StatusError }

  let actual: number | null = null
  if (input.status === 'measuring') {
    // Measuring rocks need target AND direction (co-occurrence CHECK from
    // ticket 17) AND the week's actual number.
    if (rock.target == null || rock.direction == null) {
      return { ok: false, error: 'measuring_requires_target' }
    }
    const n = normalizeActualNumber(input.actual)
    if (n == null) return { ok: false, error: 'invalid_actual' }
    actual = n
  } else if (input.actual != null && input.actual !== '') {
    // Non-measuring statuses carry no number — reject rather than ignore.
    return { ok: false, error: 'actual_not_allowed' }
  }

  const comment = input.comment?.trim() ?? null
  if (comment != null && (comment.length > STATUS_COMMENT_CAP || comment.includes('\n'))) {
    return { ok: false, error: 'comment_too_long' }
  }

  const [row] = await db
    .insert(rockStatuses)
    .values({
      rockId,
      week: weekMonday,
      status: input.status,
      actual,
      comment,
      entryBy: auth.user.id,
    })
    .onConflictDoUpdate({
      target: [rockStatuses.rockId, rockStatuses.week],
      set: {
        status: input.status,
        actual,
        comment,
        entryBy: auth.user.id,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning()
  return { ok: true, value: row! }
}

export type RockStatusWithMeta = RockStatus & {
  /** True when the two most recent status weeks (latest + the week before) are both off_track. */
  twoConsecutiveOffTrack: boolean
}

export type RockStatusHistory = {
  rockId: number
  /** Oldest → newest by week. */
  statuses: RockStatusWithMeta[]
  /** Latest entry's week (null = no statuses yet). */
  latestWeek: string | null
  latestStatus: RockStatusValue | null
}

/**
 * Per-rock status history for a quarter's rocks, oldest → newest, with the
 * 2-consecutive-off-track flag per ENTRY (not per rock): an entry is flagged
 * when it AND the immediately preceding week's entry (W-1 and W-2 relative to
 * that entry's week, by weekStart keys — calendar gaps from carry-over don't
 * matter, only adjacent week keys) are both off_track. A rock is highlighted
 * when its LATEST entry is flagged.
 */
export async function listStatusesForRocks(
  db: Db,
  token: string | undefined,
  quarterId: number,
): Promise<StatusResult<RockStatusHistory[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth

  const rocksInQuarter = await db
    .select({ id: rocks.id })
    .from(rocks)
    .where(eq(rocks.quarterId, quarterId))
  const rockIds = rocksInQuarter.map((r) => Number(r.id))
  if (rockIds.length === 0) return { ok: true, value: [] }

  // Aliased join columns: unique output names (node:sqlite proxy constraint).
  const rows = await db
    .select({
      id: sql<number>`"rock_statuses"."id"`.as('rs_id'),
      createdAt: sql<string>`"rock_statuses"."created_at"`.as('rs_created_at'),
      updatedAt: sql<string>`"rock_statuses"."updated_at"`.as('rs_updated_at'),
      rockId: sql<number>`"rock_statuses"."rock_id"`.as('rs_rock_id'),
      week: sql<string>`"rock_statuses"."week"`.as('rs_week'),
      status: sql<string>`"rock_statuses"."status"`.as('rs_status'),
      actual: sql<number | null>`"rock_statuses"."actual"`.as('rs_actual'),
      comment: sql<string | null>`"rock_statuses"."comment"`.as('rs_comment'),
      entryBy: sql<number>`"rock_statuses"."entry_by"`.as('rs_entry_by'),
    })
    .from(rockStatuses)
    .where(inArray(rockStatuses.rockId, rockIds))
    .orderBy(asc(rockStatuses.week), asc(rockStatuses.id))

  const byRock = new Map<number, RockStatusWithMeta[]>()
  for (const r of rows) {
    const status: RockStatusWithMeta = {
      id: Number(r.id),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      rockId: Number(r.rockId),
      week: r.week,
      status: r.status as RockStatusValue,
      actual: r.actual == null ? null : Number(r.actual),
      comment: r.comment ?? null,
      entryBy: Number(r.entryBy),
      twoConsecutiveOffTrack: false,
    }
    const list = byRock.get(status.rockId) ?? []
    const prev = list[list.length - 1]
    // Adjacent week keys: prev.week must be exactly 7 days before status.week.
    const adjacent =
      prev != null &&
      Date.parse(status.week) - Date.parse(prev.week) === 7 * 86400000
    status.twoConsecutiveOffTrack =
      adjacent && prev.status === 'off_track' && status.status === 'off_track'
    list.push(status)
    byRock.set(status.rockId, list)
  }

  return {
    ok: true,
    value: rockIds.map((rockId) => {
      const statuses = byRock.get(rockId) ?? []
      const latest = statuses[statuses.length - 1] ?? null
      return {
        rockId,
        statuses,
        latestWeek: latest?.week ?? null,
        latestStatus: latest ? (latest.status as RockStatusValue) : null,
      }
    }),
  }
}

/**
 * Latest status per rock in a quarter (for the L10 pre-load, ticket 21):
 * same shape as listStatusesForRocks but the UI only needs the tail.
 */
export async function listLatestStatuses(
  db: Db,
  token: string | undefined,
  quarterId: number,
): Promise<StatusResult<Array<{ rockId: number; latestWeek: string | null; latestStatus: RockStatusValue | null; twoConsecutiveOffTrack: boolean }>>> {
  const history = await listStatusesForRocks(db, token, quarterId)
  if (!history.ok) return history
  return {
    ok: true,
    value: history.value.map((h) => ({
      rockId: h.rockId,
      latestWeek: h.latestWeek,
      latestStatus: h.latestStatus,
      twoConsecutiveOffTrack:
        h.statuses.length > 0 && h.statuses[h.statuses.length - 1].twoConsecutiveOffTrack,
    })),
  }
}
