import type { Db } from './db'
import { meetings, meetingSegments, people, users, type Meeting } from './schema'
import { getCurrentUser } from './auth'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { todayIso, weekStart, formatWeekLabel } from './week'
import { listEntriesForGrid } from './metrics'
import { listLatestStatuses, listRocks } from './rocks'
import { listTodosByWeek } from './todos'

/**
 * Level 10 meeting lifecycle (ticket 21). One OPEN meeting per company at a
 * time; anyone signed in starts/joins; any participant advances segments
 * (advisory facilitator — a label, no permissions attach). Concluding is
 * ticket 25; open meetings are deletable.
 *
 * SEGMENT STATE MACHINE (documented in data-model.md):
 * - startMeeting creates the 7 fixed segments in agenda order, all with
 *   elapsed_seconds = 0, notes = ''; the FIRST segment gets entered_at = now.
 * - The ACTIVE segment is the unique one with entered_at != null AND
 *   done_at IS NULL (a sub-second advance leaves elapsed_seconds = 0, so
 *   elapsed alone can't distinguish done from active).
 * - advanceSegment stamps the active segment (elapsed_seconds = now −
 *   entered_at) and starts the next (entered_at = now). Advancing a
 *   done/non-active segment → 'segment_not_active'; advancing 'conclude' is
 *   rejected — conclusion is ticket 25's explicit act, not a timer advance.
 * - Planned minutes are NOT stored (data-model has no column) — they come
 *   from SEGMENT_AGENDA below, keyed by segment_key.
 */

export const SEGMENT_AGENDA = [
  { key: 'segue', label: 'Segue', plannedMinutes: 5 },
  { key: 'scorecard', label: 'Scorecard', plannedMinutes: 5 },
  { key: 'rocks', label: 'Rocks', plannedMinutes: 5 },
  { key: 'headlines', label: 'Headlines', plannedMinutes: 5 },
  { key: 'todos', label: 'To-Dos', plannedMinutes: 5 },
  { key: 'ids', label: 'IDS', plannedMinutes: 60 },
  { key: 'conclude', label: 'Conclude', plannedMinutes: 5 },
] as const

export type SegmentKey = (typeof SEGMENT_AGENDA)[number]['key']

export type MeetingError =
  | 'unauthenticated'
  | 'forbidden'
  | 'meeting_not_found'
  | 'meeting_concluded'
  | 'open_meeting_exists'
  | 'segment_not_active'
  | 'segment_not_found'
  | 'conclude_is_ticket_25'
  | 'person_not_found'
  | 'notes_too_large'

export type MeetingResult<T> = { ok: true; value: T } | { ok: false; error: MeetingError }

export type SegmentView = {
  id: number
  segmentKey: SegmentKey
  label: string
  plannedMinutes: number
  elapsedSeconds: number
  enteredAt: string | null
  /** The active segment (entered, not yet advanced). */
  active: boolean
  done: boolean
  notes: string
}

export type MeetingSummary = {
  id: number
  date: string
  status: 'open' | 'concluded'
  facilitatorPersonId: number | null
  facilitatorName: string | null
  startedAt: string
  concludedAt: string | null
  createdBy: number
}

export type MeetingWithSegments = MeetingSummary & {
  segments: SegmentView[]
  /** Total elapsed seconds across advanced segments. */
  totalElapsedSeconds: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function activeIndex(segments: Array<{ enteredAt: string | null; doneAt: string | null }>): number {
  return segments.findIndex((s) => s.enteredAt != null && s.doneAt == null)
}

/** Any signed-in user; rejects when an open meeting already exists. */
export async function startMeeting(
  db: Db,
  token: string | undefined,
  today = todayIso(),
): Promise<MeetingResult<MeetingWithSegments>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.status, 'open'), isNull(meetings.concludedAt)))
    .get()
  if (open) return { ok: false, error: 'open_meeting_exists' }

  const now = nowIso()
  const [meeting] = await db
    .insert(meetings)
    .values({
      date: today,
      status: 'open',
      startedAt: now,
      createdBy: auth.user.id,
    })
    .returning()

  // First segment starts immediately; the rest wait their turn.
  for (let i = 0; i < SEGMENT_AGENDA.length; i++) {
    await db.insert(meetingSegments).values({
      meetingId: meeting!.id,
      segmentKey: SEGMENT_AGENDA[i].key,
      elapsedSeconds: 0,
      enteredAt: i === 0 ? now : null,
      notes: '',
    })
  }
  return getMeeting(db, token, meeting!.id)
}

/** Alias every join column uniquely (node:sqlite object-row constraint). */
async function loadMeeting(
  db: Db,
  meetingId: number,
): Promise<{ meeting: Meeting; creatorEmail: string } | null> {
  const row = await db
    .select({
      id: sql<number>`"meetings"."id"`.as('m_id'),
      createdAt: sql<string>`"meetings"."created_at"`.as('m_created_at'),
      updatedAt: sql<string>`"meetings"."updated_at"`.as('m_updated_at'),
      date: sql<string>`"meetings"."date"`.as('m_date'),
      status: sql<string>`"meetings"."status"`.as('m_status'),
      facilitatorPersonId: sql<number | null>`"meetings"."facilitator_person_id"`.as('m_facilitator'),
      startedAt: sql<string>`"meetings"."started_at"`.as('m_started_at'),
      concludedAt: sql<string | null>`"meetings"."concluded_at"`.as('m_concluded'),
      createdBy: sql<number>`"meetings"."created_by"`.as('m_created_by'),
      creatorEmail: sql<string>`"users"."email"`.as('u_email'),
    })
    .from(meetings)
    .innerJoin(users, sql`"users"."id" = "meetings"."created_by"`)
    .where(sql`"meetings"."id" = ${meetingId}`)
    .get()
  if (!row) return null
  return {
    meeting: {
      id: Number(row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      date: row.date,
      status: row.status as 'open' | 'concluded',
      facilitatorPersonId: row.facilitatorPersonId != null ? Number(row.facilitatorPersonId) : null,
      startedAt: row.startedAt,
      concludedAt: row.concludedAt,
      createdBy: Number(row.createdBy),
    },
    creatorEmail: row.creatorEmail,
  }
}

function toSummary(
  meeting: Meeting,
  facilitatorName: string | null,
): MeetingSummary {
  return {
    id: meeting.id,
    date: meeting.date,
    status: meeting.status as 'open' | 'concluded',
    facilitatorPersonId: meeting.facilitatorPersonId,
    facilitatorName,
    startedAt: meeting.startedAt,
    concludedAt: meeting.concludedAt,
    createdBy: meeting.createdBy,
  }
}

export async function getMeeting(
  db: Db,
  token: string | undefined,
  meetingId: number,
): Promise<MeetingResult<MeetingWithSegments>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }

  let facilitatorName: string | null = null
  if (loaded.meeting.facilitatorPersonId != null) {
    const person = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(eq(people.id, loaded.meeting.facilitatorPersonId))
      .get()
    facilitatorName = person?.fullName ?? null
  }

  const rows = await db
    .select()
    .from(meetingSegments)
    .where(eq(meetingSegments.meetingId, meetingId))
    .orderBy(meetingSegments.id)
  const order = new Map(SEGMENT_AGENDA.map((s, i) => [s.key, i]))
  const sorted = [...rows].sort(
    (a, b) => (order.get(a.segmentKey as SegmentKey) ?? 99) - (order.get(b.segmentKey as SegmentKey) ?? 99),
  )

  const segments: SegmentView[] = sorted.map((s) => {
    const agenda = SEGMENT_AGENDA.find((a) => a.key === s.segmentKey)!
    const done = s.doneAt != null
    return {
      id: s.id,
      segmentKey: s.segmentKey as SegmentKey,
      label: agenda.label,
      plannedMinutes: agenda.plannedMinutes,
      elapsedSeconds: s.elapsedSeconds,
      enteredAt: s.enteredAt,
      active: s.enteredAt != null && s.doneAt == null,
      done,
      notes: s.notes,
    }
  })

  return {
    ok: true,
    value: {
      ...toSummary(loaded.meeting, facilitatorName),
      segments,
      totalElapsedSeconds: segments.reduce((sum, s) => sum + s.elapsedSeconds, 0),
    },
  }
}

export async function advanceSegment(
  db: Db,
  token: string | undefined,
  meetingId: number,
  segmentId: number,
): Promise<MeetingResult<MeetingWithSegments>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  if (loaded.meeting.status === 'concluded') return { ok: false, error: 'meeting_concluded' }

  const rows = await db
    .select()
    .from(meetingSegments)
    .where(eq(meetingSegments.meetingId, meetingId))
    .orderBy(meetingSegments.id)
  const order = new Map(SEGMENT_AGENDA.map((s, i) => [s.key as string, i]))
  const sorted = [...rows].sort(
    (a, b) => (order.get(a.segmentKey) ?? 99) - (order.get(b.segmentKey as string) ?? 99),
  )
  const idx = sorted.findIndex((s) => s.id === segmentId)
  if (idx === -1) return { ok: false, error: 'segment_not_found' }
  const target = sorted[idx]
  if (target.segmentKey === 'conclude') {
    // Concluding the meeting is ticket 25's explicit action, not an advance.
    return { ok: false, error: 'conclude_is_ticket_25' }
  }
  const ai = activeIndex(sorted)
  if (ai !== idx) return { ok: false, error: 'segment_not_active' }

  const now = nowIso()
  const elapsed = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(target.enteredAt!)) / 1000),
  )
  await db
    .update(meetingSegments)
    .set({ elapsedSeconds: elapsed, doneAt: now, updatedAt: now })
    .where(eq(meetingSegments.id, target.id))
  // Start the next segment (exists by construction: conclude rejects first).
  const next = sorted[idx + 1]
  await db
    .update(meetingSegments)
    .set({ enteredAt: now, updatedAt: now })
    .where(eq(meetingSegments.id, next.id))

  return getMeeting(db, token, meetingId)
}

/**
 * Per-segment meeting notes (ticket 22): any participant (any signed-in user —
 * the meeting is shared) saves a segment's notes on OPEN meetings only.
 * Last-write-wins: no merge, no versioning — the newest write is the content
 * (decided). A 100KB cap bounds abuse without constraining real notes.
 * Polling clients re-fetch via getMeeting (cheap: summary + segments only;
 * pre-loads are a separate call and are NOT re-run per poll).
 */
export const SEGMENT_NOTES_MAX = 100_000

export async function saveSegmentNotes(
  db: Db,
  token: string | undefined,
  meetingId: number,
  segmentId: number,
  notes: string,
): Promise<MeetingResult<true>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  if (typeof notes !== 'string' || notes.length > SEGMENT_NOTES_MAX) {
    return { ok: false, error: 'notes_too_large' }
  }
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  if (loaded.meeting.status === 'concluded') return { ok: false, error: 'meeting_concluded' }
  const segment = await db
    .select({ id: meetingSegments.id })
    .from(meetingSegments)
    .where(and(eq(meetingSegments.id, segmentId), eq(meetingSegments.meetingId, meetingId)))
    .get()
  if (!segment) return { ok: false, error: 'segment_not_found' }
  const now = nowIso()
  await db
    .update(meetingSegments)
    .set({ notes, updatedAt: now })
    .where(eq(meetingSegments.id, segmentId))
  await db.update(meetings).set({ updatedAt: now }).where(eq(meetings.id, meetingId))
  return { ok: true, value: true }
}

/** Open meetings only; hard delete of the meeting + its segments (v1). */
export async function deleteMeeting(
  db: Db,
  token: string | undefined,
  meetingId: number,
): Promise<MeetingResult<true>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  if (loaded.meeting.status === 'concluded') return { ok: false, error: 'meeting_concluded' }
  await db.delete(meetingSegments).where(eq(meetingSegments.meetingId, meetingId))
  await db.delete(meetings).where(eq(meetings.id, meetingId))
  return { ok: true, value: true }
}

/** Advisory label: anyone signed-in sets it on an open meeting. */
export async function setFacilitator(
  db: Db,
  token: string | undefined,
  meetingId: number,
  personId: number | null,
): Promise<MeetingResult<MeetingWithSegments>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  if (loaded.meeting.status === 'concluded') return { ok: false, error: 'meeting_concluded' }
  if (personId != null) {
    const person = await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get()
    if (!person) return { ok: false, error: 'person_not_found' }
  }
  await db
    .update(meetings)
    .set({ facilitatorPersonId: personId, updatedAt: nowIso() })
    .where(eq(meetings.id, meetingId))
  return getMeeting(db, token, meetingId)
}

export async function listMeetings(
  db: Db,
  token: string | undefined,
): Promise<MeetingResult<MeetingSummary[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rows = await db
    .select({
      meeting: meetings,
      facilitatorName: sql<string | null>`"people"."full_name"`.as('p_name'),
    })
    .from(meetings)
    .leftJoin(people, eq(meetings.facilitatorPersonId, people.id))
    .orderBy(desc(meetings.id))
  return {
    ok: true,
    value: rows.map((r) => toSummary(r.meeting, r.facilitatorName ?? null)),
  }
}

/** The open meeting, if any (join view). */
export async function getOpenMeeting(
  db: Db,
  token: string | undefined,
): Promise<MeetingResult<MeetingWithSegments | null>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.status, 'open'), isNull(meetings.concludedAt)))
    .get()
  if (!open) return { ok: true, value: null }
  return getMeeting(db, token, open.id)
}

// ---------------------------------------------------------------------------
// Pre-loaded segment data (ticket 21): previous week scorecard, current rock
// statuses, last week's to-dos — read-only displays; push-to-issue is 23.
// ---------------------------------------------------------------------------

export type PreloadedData = {
  scorecard: {
    weeks: Array<{ monday: string; label: string }>
    metrics: Array<{
      name: string
      target: number
      pass: boolean | null
      actual: number | null
    }>
    /** The previous week's Monday key (null when the grid has <2 weeks). */
    previousWeekMonday: string | null
    previousWeekLabel: string | null
  }
  rocks: Array<{
    id: number
    statement: string
    ownerName: string | null
    latestStatus: string | null
    twoConsecutiveOffTrack: boolean
  }>
  todos: {
    weekMonday: string
    label: string
    open: number
    done: number
    dropped: number
    items: Array<{ title: string; assigneeName: string; status: string; dueDate: string }>
  } | null
}

/**
 * The read-only segment data the meeting renders: scorecard cells for the
 * week BEFORE the current one, latest rock statuses for the current quarter,
 * and the to-dos due LAST week (done/not-done). Derived on every call.
 */
export async function getPreloadedData(
  db: Db,
  token: string | undefined,
  today = todayIso(),
): Promise<MeetingResult<PreloadedData>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth

  const grid = await listEntriesForGrid(db, token, 8, today)
  const scorecard = grid.ok
    ? (() => {
        const weeks = grid.value.weeks
        // Previous week = the column before the current week (last in grid).
        const prev = weeks.length >= 2 ? weeks[weeks.length - 2] : null
        return {
          weeks: prev ? [prev] : [],
          metrics: grid.value.metrics.map((m) => {
            const cells = prev ? m.cells[weeks.indexOf(prev)] : null
            return {
              name: m.name,
              target: m.target,
              pass: cells ? cells.pass : null,
              actual: cells ? cells.actual : null,
            }
          }),
          previousWeekMonday: prev?.monday ?? null,
          previousWeekLabel: prev?.label ?? null,
        }
      })()
    : { weeks: [], metrics: [], previousWeekMonday: null, previousWeekLabel: null }

  // Current quarter = quarter containing today; rocks module reads per quarter.
  const { getCurrentQuarter } = await import('./quarters')
  const currentQuarter = await getCurrentQuarter(db, today)
  const rocksList = currentQuarter
    ? await listRocks(db, token, currentQuarter.id)
    : ({ ok: true as const, value: { company: [], personal: [] } } as const)
  const statuses = rocksList.ok
    ? await listLatestStatuses(db, token, currentQuarter!.id)
    : { ok: true as const, value: [] }
  const rockRows = rocksList.ok
    ? [...rocksList.value.company, ...rocksList.value.personal].map((r) => {
        const st = statuses.ok ? statuses.value.find((s) => s.rockId === r.id) : undefined
        return {
          id: r.id,
          statement: r.statement,
          ownerName: r.ownerName,
          latestStatus: st?.latestStatus ?? null,
          twoConsecutiveOffTrack: st?.twoConsecutiveOffTrack ?? false,
        }
      })
    : []

  // Last week's to-dos = the bucket whose Monday is weekStart(today) − 7d.
  const buckets = await listTodosByWeek(db, token)
  const lastMonday = new Date(`${weekStart(today)}T12:00:00Z`)
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7)
  const lastKey = lastMonday.toISOString().slice(0, 10)
  const bucket = buckets.ok ? buckets.value.find((b) => b.weekMonday === lastKey) : undefined
  const todos = bucket
    ? {
        weekMonday: bucket.weekMonday,
        label: bucket.label,
        open: bucket.todos.filter((t) => t.status === 'open').length,
        done: bucket.todos.filter((t) => t.status === 'done').length,
        dropped: bucket.todos.filter((t) => t.status === 'dropped').length,
        items: bucket.todos.map((t) => ({
          title: t.title,
          assigneeName: t.assigneeName,
          status: t.status,
          dueDate: t.dueDate,
        })),
      }
    : null

  return { ok: true, value: { scorecard, rocks: rockRows, todos } }
}

export { formatWeekLabel, weekStart }