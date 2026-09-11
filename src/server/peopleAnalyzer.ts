import type { Db } from './db'
import {
  coreValues,
  people,
  peopleAnalyzerScores,
  quarters,
  seatAssignments,
  seats,
  type CoreValue,
} from './schema'
import { requireRole } from './auth'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

/**
 * Employee Assessment (ticket 10). Per-person, per-quarter +/−/−− scoring against
 * each core value, plus the GWC summary column rolled up from active seat
 * assignments. ADMIN-ONLY view AND edit (decided: scores are sensitive —
 * data-model.md access rules; everyone sees everything EXCEPT these scores).
 *
 * Decisions documented here:
 * - Grid columns = active core values, PLUS inactive values that still have
 *   scores for the selected quarter (historical scores stay visible; ticket 07
 *   keeps their IDs stable).
 * - Display names are JOINED from core_values/people at read time — score rows
 *   never denormalize names.
 * - Verdict is derived from GWC first, then value scores (see verdict()).
 */

export type Score = '+' | '-' | '--'

export type AnalyzerError =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_score'

export type AnalyzerResult<T> = { ok: true; value: T } | { ok: false; error: AnalyzerError }

export type GwcSummary = {
  /** Active assignments with their GWC, seat name included. */
  seats: Array<{
    seatId: number
    seatName: string
    get: boolean | null
    want: boolean | null
    capacity: boolean | null
  }>
  /** true only when there is at least one seat and every GWC field is true. */
  allTrue: boolean
  /** true when every GWC field of every active seat is false. */
  allFalse: boolean
  /** true when any GWC field of any active seat is unrated (null). */
  incomplete: boolean
}

export type AnalyzerRow = {
  personId: number
  personName: string
  /** coreValueId → score (only values with a score for this quarter). */
  scores: Record<number, Score>
  gwc: GwcSummary
  /** "right person / right seat" verdict, derived — see verdict(). */
  verdict: string
}

export type AnalyzerValue = {
  id: number
  name: string
  description: string | null
  active: boolean
}

export type AnalyzerView = {
  quarterId: number
  quarterLabel: string
  /** Columns of the grid, in display order. */
  values: AnalyzerValue[]
  rows: AnalyzerRow[]
}

const SCORES: readonly Score[] = ['+', '-', '--']

function isScore(raw: unknown): raw is Score {
  return typeof raw === 'string' && (SCORES as readonly string[]).includes(raw)
}

/** Classic "right person / right seat" verdict from GWC + value scores. */
function verdict(
  gwc: GwcSummary,
  scores: Record<number, Score>,
  activeValueIds: number[],
): string {
  if (gwc.incomplete) return 'Rate GWC first'
  if (!gwc.allTrue) return 'Right person? Not yet'
  if (activeValueIds.length > 0 && activeValueIds.every((id) => scores[id] === '+')) {
    return 'Exemplifies the values'
  }
  if (activeValueIds.some((id) => scores[id] === '--')) {
    return 'Not exemplifying the values'
  }
  return 'Developing'
}

/**
 * GWC summary for one person, rolled up from their ACTIVE assignments (ticket
 * 09: ended assignments keep history but no longer contribute). Join columns
 * are SQL-aliased per the driver constraint (db.ts).
 */
async function gwcSummary(db: Db, personId: number): Promise<GwcSummary> {
  const rows = await db
    .select({
      seatId: sql<number>`"seats"."id"`.as('an_seat_id'),
      seatName: sql<string>`"seats"."name"`.as('an_seat_name'),
      gwcGet: sql<number | null>`"seat_assignments"."gwc_get"`.as('an_gwc_get'),
      gwcWant: sql<number | null>`"seat_assignments"."gwc_want"`.as('an_gwc_want'),
      gwcCapacity: sql<number | null>`"seat_assignments"."gwc_capacity"`.as('an_gwc_cap'),
    })
    .from(seatAssignments)
    .innerJoin(seats, eq(seatAssignments.seatId, seats.id))
    .where(and(eq(seatAssignments.personId, personId), isNull(seatAssignments.endedAt)))
    .orderBy(asc(seatAssignments.id))
  const seatRows = rows.map((r) => ({
    seatId: Number(r.seatId),
    seatName: r.seatName,
    get: r.gwcGet == null ? null : r.gwcGet === 1,
    want: r.gwcWant == null ? null : r.gwcWant === 1,
    capacity: r.gwcCapacity == null ? null : r.gwcCapacity === 1,
  }))
  const flags = seatRows.flatMap((s) => [s.get, s.want, s.capacity])
  return {
    seats: seatRows,
    allTrue: flags.length > 0 && flags.every((f) => f === true),
    allFalse: flags.length > 0 && flags.every((f) => f === false),
    incomplete: flags.some((f) => f == null),
  }
}

/**
 * Admin sets/overwrites one score. One row per (person, quarter, value) —
 * re-entering overwrites. Admin-gated; unknown entities rejected. The score
 * shape is validated first ('+' | '-' | '--').
 */
export async function setScore(
  db: Db,
  token: string | undefined,
  input: { personId: number; quarterId: number; coreValueId: number; score: string },
): Promise<AnalyzerResult<true>> {
  if (!isScore(input.score)) return { ok: false, error: 'invalid_score' }
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const person = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.id, input.personId))
    .get()
  if (!person) return { ok: false, error: 'not_found' }
  const quarter = await db
    .select({ id: quarters.id })
    .from(quarters)
    .where(eq(quarters.id, input.quarterId))
    .get()
  if (!quarter) return { ok: false, error: 'not_found' }
  const value = await db
    .select({ id: coreValues.id })
    .from(coreValues)
    .where(eq(coreValues.id, input.coreValueId))
    .get()
  if (!value) return { ok: false, error: 'not_found' }
  const existing = await db
    .select()
    .from(peopleAnalyzerScores)
    .where(
      and(
        eq(peopleAnalyzerScores.personId, input.personId),
        eq(peopleAnalyzerScores.quarterId, input.quarterId),
        eq(peopleAnalyzerScores.coreValueId, input.coreValueId),
      ),
    )
    .get()
  if (existing) {
    await db
      .update(peopleAnalyzerScores)
      .set({ score: input.score, updatedAt: new Date().toISOString() })
      .where(eq(peopleAnalyzerScores.id, existing.id))
  } else {
    await db.insert(peopleAnalyzerScores).values({
      personId: input.personId,
      quarterId: input.quarterId,
      coreValueId: input.coreValueId,
      score: input.score,
    })
  }
  return { ok: true, value: true }
}

/**
 * Admin-only composite view for one quarter: people × core values grid with
 * scores, the GWC summary column, and the derived verdict. Members get
 * 'forbidden' at the seam (scores are sensitive).
 *
 * Grid columns: active values in sort_order, then inactive values that still
 * hold scores for this quarter (historical visibility; ticket 07 stable IDs).
 */
export async function listScores(
  db: Db,
  token: string | undefined,
  quarterId: number,
): Promise<AnalyzerResult<AnalyzerView>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const quarter = await db
    .select()
    .from(quarters)
    .where(eq(quarters.id, quarterId))
    .get()
  if (!quarter) return { ok: false, error: 'not_found' }

  const values = (await db
    .select()
    .from(coreValues)
    .orderBy(asc(coreValues.sortOrder), asc(coreValues.id))) as CoreValue[]
  const scoreRows = await db
    .select({
      personId: sql<number>`"people_analyzer_scores"."person_id"`.as('pas_person_id'),
      coreValueId: sql<number>`"people_analyzer_scores"."core_value_id"`.as('pas_value_id'),
      score: sql<string>`"people_analyzer_scores"."score"`.as('pas_score'),
    })
    .from(peopleAnalyzerScores)
    .where(eq(peopleAnalyzerScores.quarterId, quarterId))
  const scoreMap = new Map<string, Score>()
  for (const r of scoreRows) {
    if (isScore(r.score)) scoreMap.set(`${Number(r.personId)}:${Number(r.coreValueId)}`, r.score)
  }

  // People ordered by name; only uniquely-named people columns selected.
  const peopleRows = await db
    .select({
      id: sql<number>`"people"."id"`.as('an_people_id'),
      fullName: sql<string>`"people"."full_name"`.as('an_people_name'),
    })
    .from(people)
    .orderBy(asc(people.fullName))

  const activeValueIds = values.filter((v) => v.active === 1).map((v) => v.id)
  const rows: AnalyzerRow[] = []
  for (const p of peopleRows) {
    const scores: Record<number, Score> = {}
    for (const [key, score] of scoreMap) {
      const [pid, vid] = key.split(':').map(Number)
      if (pid === Number(p.id)) scores[vid] = score
    }
    const gwc = await gwcSummary(db, Number(p.id))
    rows.push({
      personId: Number(p.id),
      personName: p.fullName,
      scores,
      gwc,
      verdict: verdict(gwc, scores, activeValueIds),
    })
  }

  // Columns: active values first, then inactive values holding scores for
  // this quarter (historical scores must stay visible).
  const scoredValueIds = new Set(scoreRows.map((r) => Number(r.coreValueId)))
  const gridValues: AnalyzerValue[] = [
    ...values
      .filter((v) => v.active === 1)
      .map((v) => ({ id: v.id, name: v.name, description: v.description, active: true })),
    ...values
      .filter((v) => v.active !== 1 && scoredValueIds.has(v.id))
      .map((v) => ({ id: v.id, name: v.name, description: v.description, active: false })),
  ]

  return {
    ok: true,
    value: { quarterId, quarterLabel: quarter.label, values: gridValues, rows },
  }
}