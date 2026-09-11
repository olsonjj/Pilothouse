import type { Db } from './db'
import {
  meetingIssues,
  meetingRatings,
  meetings,
  meetingSegments,
  people,
  rocks,
  todos,
  users,
  issueResolutions,
  issues,
  type Meeting,
} from './schema'
import { getCurrentUser } from './auth'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { todayIso, weekStart, formatWeekLabel } from './week'
import {
  addIssue,
  issueFromRock,
  issueFromScorecardEntry,
  issueFromTodo,
  resolveIssue,
  unresolvedIssueIds,
} from './issues'
import type { IssueError } from './issues'
import { listEntriesForGrid } from './metrics'
import { listLatestStatuses, listRocks, type StatusError, type RockError } from './rocks'
import { listTodosByWeek, type TodoInput } from './todos'
import { createTodo } from './todos'

/**
 * Weekly meeting lifecycle (ticket 21). One OPEN meeting per company at a
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
  { key: 'segue', label: 'Check-in', plannedMinutes: 5 },
  { key: 'scorecard', label: 'Data', plannedMinutes: 5 },
  { key: 'rocks', label: 'Goals', plannedMinutes: 5 },
  { key: 'headlines', label: 'Headlines', plannedMinutes: 5 },
  { key: 'todos', label: 'To-Dos', plannedMinutes: 5 },
  { key: 'ids', label: 'Issues', plannedMinutes: 60 },
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
  | 'conclude_explicit'
  | 'person_required'
  | 'invalid_score'
  | 'person_not_found'
  | 'notes_too_large'
  | 'issue_not_found'
  | 'issue_not_long_term'
  | 'issue_resolved'
  | 'issue_not_in_queue'
  | 'not_red'
  | 'not_off_track'
  | 'todo_not_missed'
  | 'title_required'
  | 'invalid_date'
  | 'invalid_assignee'
  | 'todo_title_required'
  | 'already_resolved'

export type MeetingResult<T> = { ok: true; value: T } | { ok: false; error: MeetingError }
/** solveMeetingIssue forwards resolveIssue's write-once errors (note_required/not_found/already_resolved). */
export type SolveError = MeetingError | Extract<IssueError, 'note_required' | 'not_found' | 'already_resolved' | 'issue_resolved'>
export type SolveResult = { ok: true; value: { issueId: number; todoIds: number[] } } | { ok: false; error: SolveError }

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
    // The last segment doesn't advance — concluding the meeting is the
    // explicit concludeMeeting act.
    return { ok: false, error: 'conclude_explicit' }
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
      /** metric_entries.id for the previous-week cell (null = no entry — nothing to push). */
      entryId: number | null
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
    items: Array<{ id: number; title: string; assigneeName: string; status: string; dueDate: string }>
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
              entryId: cells ? cells.entryId : null,
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
          id: t.id,
          title: t.title,
          assigneeName: t.assigneeName,
          status: t.status,
          dueDate: t.dueDate,
        })),
      }
    : null

  return { ok: true, value: { scorecard, rocks: rockRows, todos } }
}

// ---------------------------------------------------------------------------
// Ticket 23: the meeting's issue queue + one-click push from pre-loaded data.
// meeting_issues UNIQUE(meeting_id, issue_id) = in-meeting dedup; a duplicate
// push is IDEMPOTENT (ok:true, alreadyQueued) — pushing the same red cell
// twice queues one row. Push helpers are two-step (issue create, then queue
// insert) without a transaction — the proxy driver has no verified
// transaction wrapper; a crash between steps leaves an unqueued issue, which
// the team can push again (self-healing, same reasoning as V/TO saves).
// ---------------------------------------------------------------------------

export type PushOutcome = {
  issueId: number
  meetingIssueId: number
  /** true = the issue was ALREADY in this meeting's queue (idempotent re-push). */
  alreadyQueued: boolean
}

/**
 * Push helpers can fail with EITHER spelling: meeting-layer errors
 * (meeting_concluded, …) or the underlying issue-creation errors passed
 * through (not_red, todo_not_missed, title_required, …). Callers match on
 * the literal; documented in data-model.md (ticket 23).
 */
export type PushError = MeetingError | IssueError | StatusError | RockError
export type PushResult = { ok: true; value: PushOutcome } | { ok: false; error: PushError }

/** Open meeting or reject — every queue mutation requires it. */
async function openMeetingById(db: Db, meetingId: number) {
  const meeting = await db.select().from(meetings).where(eq(meetings.id, meetingId)).get()
  if (!meeting) return { ok: false as const, error: 'meeting_not_found' as const }
  if (meeting.status === 'concluded')
    return { ok: false as const, error: 'meeting_concluded' as const }
  return { ok: true as const, meeting }
}

/**
 * Queue an EXISTING issue for this meeting's issue queue. Any participant; the
 * meeting must be open; the issue must be long-term and unresolved.
 */
export async function pushToMeeting(
  db: Db,
  token: string | undefined,
  meetingId: number,
  issueId: number,
): Promise<PushResult> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await openMeetingById(db, meetingId)
  if (!open.ok) return open
  const issue = await db.select().from(issues).where(eq(issues.id, issueId)).get()
  if (!issue) return { ok: false, error: 'issue_not_found' }
  if (issue.classification !== 'long_term') return { ok: false, error: 'issue_not_long_term' }
  const unresolved = await unresolvedIssueIds(db, [issueId])
  if (!unresolved.has(issueId)) return { ok: false, error: 'issue_resolved' }
  const existing = await db
    .select()
    .from(meetingIssues)
    .where(and(eq(meetingIssues.meetingId, meetingId), eq(meetingIssues.issueId, issueId)))
    .get()
  if (existing)
    return {
      ok: true,
      value: { issueId, meetingIssueId: existing.id, alreadyQueued: true },
    }
  const [row] = await db
    .insert(meetingIssues)
    .values({ meetingId, issueId, state: 'in_ids' })
    .returning()
  return { ok: true, value: { issueId, meetingIssueId: row!.id, alreadyQueued: false } }
}

/**
 * One-click: red scorecard cell → issue (origin from_scorecard, source =
 * entry id) → queue. Reuses ticket 20's issueFromScorecardEntry (green cell →
 * 'not_red'; both steps reject before either writes).
 */
export async function pushRedCell(
  db: Db,
  token: string | undefined,
  meetingId: number,
  entryId: number,
): Promise<PushResult> {
  // Guard the meeting BEFORE creating anything — a rejected push persists nothing.
  const meeting = await openMeetingById(db, meetingId)
  if (!meeting.ok) return meeting
  const created = await issueFromScorecardEntry(db, token, entryId)
  if (!created.ok) return created
  return pushToMeeting(db, token, meetingId, created.value.id)
}

/**
 * One-click: off-track rock → issue (origin from_rock, source = rock id) →
 * queue. ONLY explicitly off-track rocks push (latest weekly status
 * off_track, or the 2-consecutive flag): pushing an on-track rock is a
 * mistake → 'not_off_track'. Measuring rocks are not pushable in v1 — their
 * status is a number, not a verdict (documented).
 */
export async function pushOffTrackRock(
  db: Db,
  token: string | undefined,
  meetingId: number,
  rockId: number,
): Promise<PushResult> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  // Guard the meeting BEFORE creating anything — a rejected push persists nothing.
  const meeting = await openMeetingById(db, meetingId)
  if (!meeting.ok) return meeting
  const rock = await db.select().from(rocks).where(eq(rocks.id, rockId)).get()
  if (!rock) return { ok: false, error: 'rock_not_found' }
  const statuses = await listLatestStatuses(db, token, rock.quarterId)
  if (!statuses.ok) return statuses
  const st = statuses.value.find((s) => s.rockId === rockId)
  const offTrack = st !== undefined && (st.latestStatus === 'off_track' || st.twoConsecutiveOffTrack)
  if (!offTrack) return { ok: false, error: 'not_off_track' }
  const created = await issueFromRock(db, token, rockId)
  if (!created.ok) return created
  return pushToMeeting(db, token, meetingId, created.value.id)
}

/**
 * One-click: missed to-do → issue (origin from_todo, source = todo id) →
 * queue. Done to-dos are not misses ('todo_not_missed' via ticket 20); open
 * AND dropped to-dos push (the room decides).
 */
export async function pushMissedTodo(
  db: Db,
  token: string | undefined,
  meetingId: number,
  todoId: number,
): Promise<PushResult> {
  // Guard the meeting BEFORE creating anything — a rejected push persists nothing.
  const meeting = await openMeetingById(db, meetingId)
  if (!meeting.ok) return meeting
  const created = await issueFromTodo(db, token, todoId)
  if (!created.ok) return created
  return pushToMeeting(db, token, meetingId, created.value.id)
}

/**
 * One-click: typed headline → manual issue → queue. Headlines are free text
 * with no source row, so the issue's origin is the default 'manual'
 * (documented; origin 'from_meeting' stays unused in v1).
 */
export async function pushHeadline(
  db: Db,
  token: string | undefined,
  meetingId: number,
  title: string,
): Promise<PushResult> {
  // Guard the meeting BEFORE creating anything — a rejected push persists nothing.
  const meeting = await openMeetingById(db, meetingId)
  if (!meeting.ok) return meeting
  const created = await addIssue(db, token, { title, classification: 'long_term' })
  if (!created.ok) return created
  return pushToMeeting(db, token, meetingId, created.value.id)
}

export type MeetingIssueView = {
  meetingIssueId: number
  issueId: number
  state: string
  title: string
  origin: string
  status: 'open' | 'resolved'
  pushedAt: string
}

/**
 * The meeting's issue queue, oldest push first. Signed-in readable (any
 * participant — and the team outside the meeting too). Join columns are
 * SQL-aliased uniquely (node:sqlite proxy constraint, see db.ts).
 */
export async function listMeetingIssues(
  db: Db,
  token: string | undefined,
  meetingId: number,
): Promise<MeetingResult<MeetingIssueView[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const meeting = await db.select().from(meetings).where(eq(meetings.id, meetingId)).get()
  if (!meeting) return { ok: false, error: 'meeting_not_found' }
  const rows = await db
    .select({
      meetingIssueId: sql<number>`"meeting_issues"."id"`.as('mi_id'),
      state: sql<string>`"meeting_issues"."state"`.as('mi_state'),
      pushedAt: sql<string>`"meeting_issues"."created_at"`.as('mi_pushed_at'),
      issueId: sql<number>`"issues"."id"`.as('i_id'),
      title: sql<string>`"issues"."title"`.as('i_title'),
      origin: sql<string>`"issues"."origin"`.as('i_origin'),
      resolutionId: sql<number | null>`"issue_resolutions"."id"`.as('r_id'),
    })
    .from(meetingIssues)
    .innerJoin(issues, eq(issues.id, meetingIssues.issueId))
    .leftJoin(issueResolutions, eq(issueResolutions.issueId, issues.id))
    .where(eq(meetingIssues.meetingId, meetingId))
    .orderBy(asc(meetingIssues.createdAt), asc(meetingIssues.id))
  return {
    ok: true,
    value: rows.map((r) => ({
      meetingIssueId: Number(r.meetingIssueId),
      issueId: Number(r.issueId),
      state: r.state,
      title: r.title,
      origin: r.origin,
      status: r.resolutionId == null ? 'open' : 'resolved',
      pushedAt: r.pushedAt,
    })),
  }
}

/**
 * Remove an issue from the meeting's queue (the queue is editable by any
 * participant). Only 'in_ids' rows remove — 'solved_today'/'carried' rows
 * are conclude-state (ticket 25). The issue itself persists (issues are
 * never deleted).
 */
export async function removeMeetingIssue(
  db: Db,
  token: string | undefined,
  meetingId: number,
  issueId: number,
): Promise<MeetingResult<PushOutcome>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await openMeetingById(db, meetingId)
  if (!open.ok) return open
  const row = await db
    .select()
    .from(meetingIssues)
    .where(and(eq(meetingIssues.meetingId, meetingId), eq(meetingIssues.issueId, issueId)))
    .get()
  if (!row || row.state !== 'in_ids') return { ok: false, error: 'issue_not_in_queue' }
  await db.delete(meetingIssues).where(eq(meetingIssues.id, row.id))
  return { ok: true, value: { issueId, meetingIssueId: row.id, alreadyQueued: false } }
}

/* ------------------------------------------------------------------ */
/* IDS (ticket 24; segment now labeled Issues): pull long-term issues + solve in-session           */
/* ------------------------------------------------------------------ */

export type PullOutcome = {
  issueId: number
  ok: boolean
  meetingIssueId?: number
  alreadyQueued?: boolean
  error?: string
}

/**
 * Pull LONG-TERM issues from the team's list into this meeting's issue queue
 * (any participant; the meeting must be open). Each id rides pushToMeeting
 * semantics: long-term only, unresolved only, duplicate pull = idempotent
 * alreadyQueued (the ticket-23 dedup decision). Short-term issues age in
 * their week list and are never pulled. Bulk = per-issue results — one bad
 * id never blocks the others.
 */
export async function pullLongTermIssues(
  db: Db,
  token: string | undefined,
  meetingId: number,
  issueIds: number[],
): Promise<MeetingResult<PullOutcome[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await openMeetingById(db, meetingId)
  if (!open.ok) return open
  const results: PullOutcome[] = []
  for (const issueId of issueIds) {
    const pushed = await pushToMeeting(db, token, meetingId, issueId)
    if (pushed.ok) {
      results.push({
        issueId,
        ok: true,
        meetingIssueId: pushed.value.meetingIssueId,
        alreadyQueued: pushed.value.alreadyQueued,
      })
    } else {
      results.push({ issueId, ok: false, error: pushed.error })
    }
  }
  return { ok: true, value: results }
}

export type SolveTodoInput = Pick<TodoInput, 'title' | 'assigneePersonId'>

export type SolveInput = {
  note: string
  todos: SolveTodoInput[]
}

/**
 * Solve an in-queue issue: capture the resolution note and create the assigned
 * to-dos (7-day due via the shared rule), then flip the queue row to
 * 'solved_today'. Any participant; the meeting must be open; the row must
 * still be 'in_ids' (solved_today/carried rows are conclude-state).
 *
 * OPERATION ORDER (crash-safety, documented in data-model.md): validate
 * to-do inputs → resolveIssue FIRST (write-once: a crash after this leaves
 * the issue correctly solved, which conclude/queue reads handle) → create
 * to-dos → flip the queue row LAST. A crash mid-way never leaves the queue
 * row solved while the issue is open — the harmless direction is the queue
 * row lagging (still in_ids), never the opposite.
 */
export async function solveMeetingIssue(
  db: Db,
  token: string | undefined,
  meetingId: number,
  meetingIssueId: number,
  input: SolveInput,
): Promise<SolveResult> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const open = await openMeetingById(db, meetingId)
  if (!open.ok) return open
  const row = await db
    .select()
    .from(meetingIssues)
    .where(eq(meetingIssues.id, meetingIssueId))
    .get()
  if (!row || row.meetingId !== meetingId) return { ok: false, error: 'issue_not_in_queue' }
  if (row.state !== 'in_ids') return { ok: false, error: 'issue_not_in_queue' }
  const issue = await db.select().from(issues).where(eq(issues.id, row.issueId)).get()
  if (!issue) return { ok: false, error: 'issue_not_found' }

  // Pre-validate to-do inputs (titles + assignees) so a solve never lands
  // half-created: everything that can fail validation fails BEFORE the
  // write-once resolution.
  const createdTodoInputs: TodoInput[] = []
  for (const t of input.todos ?? []) {
    const title = t.title?.trim() ?? ''
    if (!title) return { ok: false, error: 'todo_title_required' }
    const assignee = await db.select({ id: people.id }).from(people).where(eq(people.id, t.assigneePersonId)).get()
    if (!assignee) return { ok: false, error: 'invalid_assignee' }
    createdTodoInputs.push({ title, assigneePersonId: t.assigneePersonId, sourceMeetingId: meetingId })
  }

  // 1) The write-once resolution (rejects a second solve via already_resolved).
  const resolved = await resolveIssue(db, token, row.issueId, {
    outcome: 'solved',
    note: input.note,
    meetingId,
  })
  if (!resolved.ok) return { ok: false, error: resolved.error as SolveError }

  // 2) The assigned to-dos (validated above; creation is now infallible).
  const todoIds: number[] = []
  for (const t of createdTodoInputs) {
    const created = await createTodo(db, token, t)
    if (created.ok) todoIds.push(created.value.id)
  }

  // 3) Flip the queue row LAST (crash before this = harmless lag; conclude
  //    treats lingering in_ids rows as carried, ticket 25).
  await db
    .update(meetingIssues)
    .set({ state: 'solved_today', updatedAt: new Date().toISOString() })
    .where(eq(meetingIssues.id, row.id))

  return { ok: true, value: { issueId: row.issueId, todoIds } }
}

export { formatWeekLabel, weekStart }

// ---------------------------------------------------------------------------
// Ticket 25: conclude, ratings & frozen archive
// ---------------------------------------------------------------------------

export type MeetingRatingView = {
  personId: number
  personName: string
  score: number
}

export type MeetingRecap = {
  /** To-dos created in this meeting (source_meeting_id), with assignees. */
  newTodos: Array<{ id: number; title: string; assigneeName: string }>
  /** Number of queue rows flipped to 'carried' at conclude (0 while open). */
  carriedCount: number
  /** Ratings so far (one per person, overwrite semantics). */
  ratings: MeetingRatingView[]
  /** Average score, one decimal; null when no ratings yet. */
  avgRating: number | null
  /** Cascading messages (stored in the conclude segment's notes — documented delta). */
  cascadingMessages: string
}

/**
 * The conclude recap (ticket 25): new to-dos, ratings, carried count, and the
 * cascading-messages text. Read-only; works for open meetings (the Conclude
 * segment shows it live) and concluded archives alike.
 */
export async function listMeetingRecap(
  db: Db,
  token: string | undefined,
  meetingId: number,
): Promise<MeetingResult<MeetingRecap>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }

  // New to-dos: assignee name join — SQL-aliased uniquely (proxy constraint).
  const todoRows = await db
    .select({
      id: sql<number>`"todos"."id"`.as('t_id'),
      title: sql<string>`"todos"."title"`.as('t_title'),
      assigneeName: sql<string>`"people"."full_name"`.as('p_assignee'),
    })
    .from(todos)
    .innerJoin(people, eq(todos.assigneePersonId, people.id))
    .where(eq(todos.sourceMeetingId, meetingId))
    .orderBy(asc(todos.id))

  // Ratings with person names (aliased uniquely).
  const ratingRows = await db
    .select({
      personId: sql<number>`"meeting_ratings"."person_id"`.as('mr_person'),
      score: sql<number>`"meeting_ratings"."score"`.as('mr_score'),
      personName: sql<string>`"people"."full_name"`.as('p_rater'),
    })
    .from(meetingRatings)
    .innerJoin(people, eq(meetingRatings.personId, people.id))
    .where(eq(meetingRatings.meetingId, meetingId))
    .orderBy(asc(meetingRatings.id))

  const carriedRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(meetingIssues)
    .where(and(eq(meetingIssues.meetingId, meetingId), eq(meetingIssues.state, 'carried')))

  const concludeSeg = await db
    .select({ notes: meetingSegments.notes })
    .from(meetingSegments)
    .where(and(eq(meetingSegments.meetingId, meetingId), eq(meetingSegments.segmentKey, 'conclude')))
    .get()

  const scores = ratingRows.map((r) => Number(r.score))
  const avg = scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10

  return {
    ok: true,
    value: {
      newTodos: todoRows.map((t) => ({
        id: Number(t.id),
        title: t.title,
        assigneeName: t.assigneeName,
      })),
      carriedCount: Number(carriedRows[0]?.count ?? 0),
      ratings: ratingRows.map((r) => ({
        personId: Number(r.personId),
        personName: r.personName,
        score: Number(r.score),
      })),
      avgRating: avg,
      cascadingMessages: concludeSeg?.notes ?? '',
    },
  }
}

/**
 * Record the signed-in user's 1–10 rating for a meeting (ticket 25). One per
 * person (UNIQUE(meeting_id, person_id), overwrite on re-rate). ALLOWED on
 * open AND concluded meetings — the documented delta: EOS records ratings at
 * conclude, but a late rater shouldn't lose their trend datapoint; ratings
 * are the one post-conclude mutable surface. Unlinked accounts can't rate
 * (ratings belong to people per data-model) → 'person_required'.
 */
export async function setRating(
  db: Db,
  token: string | undefined,
  meetingId: number,
  score: number,
): Promise<MeetingResult<MeetingRecap>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  const user = auth.user
  if (user.personId == null) return { ok: false, error: 'person_required' }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    return { ok: false, error: 'invalid_score' }
  }
  const person = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.id, user.personId))
    .get()
  if (!person) return { ok: false, error: 'person_required' }

  const existing = await db
    .select({ id: meetingRatings.id })
    .from(meetingRatings)
    .where(and(eq(meetingRatings.meetingId, meetingId), eq(meetingRatings.personId, user.personId)))
    .get()
  const now = nowIso()
  if (existing) {
    await db
      .update(meetingRatings)
      .set({ score, updatedAt: now })
      .where(eq(meetingRatings.id, existing.id))
  } else {
    await db.insert(meetingRatings).values({ meetingId, personId: user.personId, score })
  }
  return listMeetingRecap(db, token, meetingId)
}

/**
 * Conclude the meeting (ticket 25): any signed-in user may conclude (the
 * facilitator is advisory — same decided rule as segment advancement;
 * documented). The meeting must be open. The conclude act:
 *   1. Flip ALL lingering in_ids queue rows to 'carried' — per the ticket-24
 *      crash-window contract, lingering in_ids is conclude's business. The
 *      ISSUE itself is untouched: unresolved long-term issues are already on
 *      the team's long-term list (keep-row model — "carried back" needs no
 *      issue writes), and a crash-window resolved issue stays solved.
 *   2. Freeze: status='concluded', concluded_at=now. Notes, queue, to-dos and
 *      durations become immutable (every write path rejects on concluded);
 *      ratings remain the one mutable surface (setRating decision).
 * Cascading messages are NOT stored here — they live in the conclude
 * segment's notes (edited during the meeting via the normal notes path).
 */
export async function concludeMeeting(
  db: Db,
  token: string | undefined,
  meetingId: number,
): Promise<MeetingResult<{ carriedCount: number }>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const loaded = await loadMeeting(db, meetingId)
  if (!loaded) return { ok: false, error: 'meeting_not_found' }
  if (loaded.meeting.status === 'concluded') return { ok: false, error: 'meeting_concluded' }

  const now = nowIso()
  const flipped = await db
    .update(meetingIssues)
    .set({ state: 'carried', updatedAt: now })
    .where(and(eq(meetingIssues.meetingId, meetingId), eq(meetingIssues.state, 'in_ids')))
    .returning({ id: meetingIssues.id })

  await db
    .update(meetings)
    .set({ status: 'concluded', concludedAt: now, updatedAt: now })
    .where(eq(meetings.id, meetingId))

  return { ok: true, value: { carriedCount: flipped.length } }
}

export type MeetingTrendPoint = {
  meetingId: number
  date: string
  status: 'open' | 'concluded'
  avgRating: number | null
}

/**
 * Rating trend (ticket 25): meetings ordered oldest→newest with their average
 * rating (null when unrated). Open meetings appear too (live datapoint).
 */
export async function ratingTrend(
  db: Db,
  token: string | undefined,
): Promise<MeetingResult<MeetingTrendPoint[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const all = await db
    .select({ id: meetings.id, date: meetings.date, status: meetings.status })
    .from(meetings)
    .orderBy(asc(meetings.id))
  const ratingRows = await db
    .select({
      meetingId: meetingRatings.meetingId,
      score: meetingRatings.score,
    })
    .from(meetingRatings)
  const byMeeting = new Map<number, number[]>()
  for (const r of ratingRows) {
    const list = byMeeting.get(r.meetingId) ?? []
    list.push(r.score)
    byMeeting.set(r.meetingId, list)
  }
  return {
    ok: true,
    value: all.map((m) => {
      const scores = byMeeting.get(m.id)
      return {
        meetingId: m.id,
        date: m.date,
        status: m.status as 'open' | 'concluded',
        avgRating:
          scores && scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
            : null,
      }
    }),
  }
}
