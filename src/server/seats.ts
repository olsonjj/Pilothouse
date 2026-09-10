import type { Db } from './db'
import { people, seats, seatAssignments, type Seat, type SeatAssignment } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { assertValidDate, todayIso } from './week'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

/**
 * Seats & assignments domain module (ticket 04): the Accountability Chart's
 * data. Admins manage seats and assignments; every signed-in user views.
 * History is append-only — reassignment sets `endedAt`, never deletes rows.
 * The small-company caps (≤2 active seats per person, one active occupant per
 * seat) are app-enforced here (SQLite can't express either as an index).
 */

export type SeatInput = {
  name: string
  description?: string | null
  /** Ordered responsibility bullets; stored as a JSON text array. */
  responsibilities?: string[]
  parentSeatId?: number | null
  sortOrder?: number
}

export type SeatError =
  | 'unauthenticated'
  | 'forbidden'
  | 'name_required'
  | 'not_found'
  | 'cycle'
  | 'invalid_date'
  | 'invalid_input'
  | 'person_seat_limit'
  | 'seat_occupied'
  | 'already_ended'

export type SeatResult<T> = { ok: true; value: T } | { ok: false; error: SeatError }

/** Seat row with responsibilities parsed to an ordered string[]. */
export type SeatView = Omit<Seat, 'responsibilities'> & { responsibilities: string[] }

export type SeatOccupant = {
  assignmentId: number
  personId: number
  personName: string
  startedAt: string
}

/** Seat row plus its active occupants (populated by listSeats/getSeat). */
export type SeatWithOccupants = SeatView & { occupants: SeatOccupant[] }

export type AssignmentRow = {
  id: number
  seatId: number
  seatName: string
  personId: number
  personName: string
  startedAt: string
  endedAt: string | null
}

function parseResponsibilities(input: string[] | undefined): string[] | 'invalid' {
  if (input === undefined) return []
  if (!Array.isArray(input)) return 'invalid'
  const cleaned = input.map((r) => (typeof r === 'string' ? r.trim() : '')).filter((r) => r !== '')
  return cleaned
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Returns true if walking the parent chain from `parentId` reaches `seatId`
 * (which would make `parentId`'s subtree include the seat itself).
 */
async function wouldCycle(db: Db, seatId: number, parentSeatId: number | null): Promise<boolean> {
  if (parentSeatId == null) return false
  if (parentSeatId === seatId) return true
  let cursor: number | null = parentSeatId
  const seen = new Set<number>()
  while (cursor != null && !seen.has(cursor)) {
    seen.add(cursor)
    if (cursor === seatId) return true
    const row = await db
      .select({ parentSeatId: seats.parentSeatId })
      .from(seats)
      .where(eq(seats.id, cursor))
      .get()
    cursor = row?.parentSeatId ?? null
  }
  return false
}

async function getSeatOrError(db: Db, seatId: number): Promise<Seat | undefined> {
  return db.select().from(seats).where(eq(seats.id, seatId)).get()
}

export async function createSeat(
  db: Db,
  token: string | undefined,
  input: SeatInput,
): Promise<SeatResult<Seat>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const name = input.name?.trim() ?? ''
  if (!name) return { ok: false, error: 'name_required' }
  const responsibilities = parseResponsibilities(input.responsibilities)
  if (responsibilities === 'invalid') return { ok: false, error: 'invalid_input' }
  const parentSeatId = input.parentSeatId ?? null
  if (parentSeatId != null && !(await getSeatOrError(db, parentSeatId))) {
    return { ok: false, error: 'not_found' }
  }
  // A brand-new seat has no id yet, so no parent chain can loop through it;
  // updateSeat performs the real cycle guard.
  const [seat] = await db
    .insert(seats)
    .values({
      name,
      description: input.description?.trim() ?? null,
      responsibilities: JSON.stringify(responsibilities),
      parentSeatId,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning()
  return { ok: true, value: seat! }
}

export async function updateSeat(
  db: Db,
  token: string | undefined,
  seatId: number,
  input: SeatInput,
): Promise<SeatResult<Seat>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const existing = await getSeatOrError(db, seatId)
  if (!existing) return { ok: false, error: 'not_found' }
  const name = input.name?.trim() ?? ''
  if (!name) return { ok: false, error: 'name_required' }
  const responsibilities = parseResponsibilities(input.responsibilities)
  if (responsibilities === 'invalid') return { ok: false, error: 'invalid_input' }
  const parentSeatId = input.parentSeatId ?? null
  if (parentSeatId != null && !(await getSeatOrError(db, parentSeatId))) {
    return { ok: false, error: 'not_found' }
  }
  // Cycle guard: the new parent chain must not pass through this seat.
  if (await wouldCycle(db, seatId, parentSeatId)) {
    return { ok: false, error: 'cycle' }
  }
  const [seat] = await db
    .update(seats)
    .set({
      name,
      description: input.description?.trim() ?? null,
      responsibilities: JSON.stringify(responsibilities),
      parentSeatId,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(seats.id, seatId))
    .returning()
  return { ok: true, value: seat! }
}

export type AssignmentInput = {
  personId: number
  seatId: number
  /** Defaults to today (UTC) when omitted. */
  startDate?: string
}

/**
 * Assigns a person to a seat, enforcing the two app-level caps:
 * a person holds at most 2 active seats, and a seat has at most 1 active
 * occupant. History is preserved — ending an assignment sets `endedAt`.
 */
export async function createAssignment(
  db: Db,
  token: string | undefined,
  input: AssignmentInput,
): Promise<SeatResult<SeatAssignment>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const person = await db.select().from(people).where(eq(people.id, input.personId)).get()
  if (!person) return { ok: false, error: 'not_found' }
  const seat = await getSeatOrError(db, input.seatId)
  if (!seat) return { ok: false, error: 'not_found' }
  const startDate = input.startDate?.trim() || todayIso()
  if (!DATE_RE.test(startDate)) return { ok: false, error: 'invalid_date' }
  try {
    assertValidDate(startDate)
  } catch {
    return { ok: false, error: 'invalid_date' }
  }
  // Cap 1: ≤2 active seats per person.
  const activeForPerson = await db
    .select({ id: seatAssignments.id })
    .from(seatAssignments)
    .where(and(eq(seatAssignments.personId, input.personId), isNull(seatAssignments.endedAt)))
    .all()
  if (activeForPerson.length >= 2) return { ok: false, error: 'person_seat_limit' }
  // Cap 2: one active occupant per seat.
  const activeForSeat = await db
    .select({ id: seatAssignments.id })
    .from(seatAssignments)
    .where(and(eq(seatAssignments.seatId, input.seatId), isNull(seatAssignments.endedAt)))
    .get()
  if (activeForSeat) return { ok: false, error: 'seat_occupied' }
  const [assignment] = await db
    .insert(seatAssignments)
    .values({
      personId: input.personId,
      seatId: input.seatId,
      startedAt: startDate,
    })
    .returning()
  return { ok: true, value: assignment! }
}

export async function endAssignment(
  db: Db,
  token: string | undefined,
  assignmentId: number,
  endDate?: string,
): Promise<SeatResult<SeatAssignment>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const existing = await db
    .select()
    .from(seatAssignments)
    .where(eq(seatAssignments.id, assignmentId))
    .get()
  if (!existing) return { ok: false, error: 'not_found' }
  if (existing.endedAt != null) return { ok: false, error: 'already_ended' }
  const endedAt = endDate?.trim() || todayIso()
  if (!DATE_RE.test(endedAt)) return { ok: false, error: 'invalid_date' }
  if (endedAt < existing.startedAt) return { ok: false, error: 'invalid_date' }
  const [assignment] = await db
    .update(seatAssignments)
    .set({ endedAt, updatedAt: new Date().toISOString() })
    .where(eq(seatAssignments.id, assignmentId))
    .returning()
  return { ok: true, value: assignment! }
}

function parseResponsibilitiesColumn(seat: Seat): SeatView {
  let responsibilities: string[] = []
  try {
    const parsed: unknown = JSON.parse(seat.responsibilities)
    if (Array.isArray(parsed)) {
      responsibilities = parsed.filter((r): r is string => typeof r === 'string')
    }
  } catch {
    // Corrupt JSON column: treat as empty rather than crash the chart.
  }
  const { responsibilities: _raw, ...rest } = seat
  return { ...rest, responsibilities }
}

async function withOccupants(db: Db, seat: Seat): Promise<SeatWithOccupants> {
  const view = parseResponsibilitiesColumn(seat)
  return { ...view, occupants: await activeOccupants(db, seat.id) }
}

/** Active occupants of one seat (join-aliased per the driver constraint). */
async function activeOccupants(db: Db, seatId: number): Promise<SeatOccupant[]> {
  const rows = await db
    .select({
      assignmentId: sql<number>`"seat_assignments"."id"`.as('sa_id'),
      personId: sql<number>`"people"."id"`.as('o_person_id'),
      personName: sql<string>`"people"."full_name"`.as('o_person_name'),
      startedAt: sql<string>`"seat_assignments"."started_at"`.as('o_started_at'),
    })
    .from(seatAssignments)
    .innerJoin(people, eq(seatAssignments.personId, people.id))
    .where(and(eq(seatAssignments.seatId, seatId), isNull(seatAssignments.endedAt)))
    .orderBy(asc(seatAssignments.startedAt))
  return rows.map((r) => ({
    assignmentId: Number(r.assignmentId),
    personId: Number(r.personId),
    personName: r.personName,
    startedAt: r.startedAt,
  }))
}

/** All seats for the chart tree, each with its current occupants. Signed-in. */
export async function listSeats(
  db: Db,
  token: string | undefined,
): Promise<SeatResult<SeatWithOccupants[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const seatRows = await db.select().from(seats).orderBy(asc(seats.sortOrder), asc(seats.id))
  const result: SeatWithOccupants[] = []
  for (const seat of seatRows) {
    result.push(await withOccupants(db, seat))
  }
  return { ok: true, value: result }
}

export async function getSeat(
  db: Db,
  token: string | undefined,
  seatId: number,
): Promise<SeatResult<SeatWithOccupants & { history: AssignmentRow[] }>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const seat = await getSeatOrError(db, seatId)
  if (!seat) return { ok: false, error: 'not_found' }
  return {
    ok: true,
    value: {
      ...(await withOccupants(db, seat)),
      history: await seatHistory(db, seatId),
    },
  }
}

/**
 * Full assignment history for one seat (current first, then newest first),
 * with person names joined through the aliased pattern.
 */
async function seatHistory(db: Db, seatId: number): Promise<AssignmentRow[]> {
  const rows = await db
    .select({
      assignmentId: sql<number>`"seat_assignments"."id"`.as('h_sa_id'),
      seatId: sql<number>`"seat_assignments"."seat_id"`.as('h_sa_seat'),
      seatName: sql<string>`"seats"."name"`.as('h_seat_name'),
      personId: sql<number>`"people"."id"`.as('h_person_id'),
      personName: sql<string>`"people"."full_name"`.as('h_person_name'),
      startedAt: sql<string>`"seat_assignments"."started_at"`.as('h_started'),
      endedAt: sql<string | null>`"seat_assignments"."ended_at"`.as('h_ended'),
    })
    .from(seatAssignments)
    .innerJoin(people, eq(seatAssignments.personId, people.id))
    .innerJoin(seats, eq(seatAssignments.seatId, seats.id))
    .where(eq(seatAssignments.seatId, seatId))
    .orderBy(asc(seatAssignments.startedAt), asc(seatAssignments.id))
  return rows.map(mapAssignmentRow)
}

/** Assignment history for one person across all seats (signed-in viewers). */
export async function getPersonAssignments(
  db: Db,
  token: string | undefined,
  personId: number,
): Promise<SeatResult<AssignmentRow[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const person = await db.select().from(people).where(eq(people.id, personId)).get()
  if (!person) return { ok: false, error: 'not_found' }
  const rows = await db
    .select({
      assignmentId: sql<number>`"seat_assignments"."id"`.as('pa_sa_id'),
      seatId: sql<number>`"seats"."id"`.as('pa_seat_id'),
      seatName: sql<string>`"seats"."name"`.as('pa_seat_name'),
      personId: sql<number>`"people"."id"`.as('pa_person_id'),
      personName: sql<string>`"people"."full_name"`.as('pa_person_name'),
      startedAt: sql<string>`"seat_assignments"."started_at"`.as('pa_started'),
      endedAt: sql<string | null>`"seat_assignments"."ended_at"`.as('pa_ended'),
    })
    .from(seatAssignments)
    .innerJoin(people, eq(seatAssignments.personId, people.id))
    .innerJoin(seats, eq(seatAssignments.seatId, seats.id))
    .where(eq(seatAssignments.personId, personId))
    .orderBy(asc(seatAssignments.startedAt), asc(seatAssignments.id))
  return { ok: true, value: rows.map(mapAssignmentRow) }
}

function mapAssignmentRow(r: {
  assignmentId: unknown
  seatId: unknown
  seatName: string
  personId: unknown
  personName: string
  startedAt: string
  endedAt: string | null
}): AssignmentRow {
  return {
    id: Number(r.assignmentId),
    seatId: Number(r.seatId),
    seatName: r.seatName,
    personId: Number(r.personId),
    personName: r.personName,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  }
}