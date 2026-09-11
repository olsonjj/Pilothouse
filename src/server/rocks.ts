import type { Db } from './db'
import { rocks, people, quarters, type Rock } from './schema'
import { getCurrentUser } from './auth'
import { and, asc, eq, sql } from 'drizzle-orm'

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