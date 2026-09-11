import type { Db } from './db'
import {
  issueResolutions,
  issues,
  metricEntries,
  metrics,
  people,
  quarters,
  rocks,
  todos,
  users,
  type Issue,
} from './schema'
import { getCurrentUser, requireRole } from './auth'
import { getCurrentQuarter } from './quarters'
import { formatWeekLabel, parseDate, todayIso, weekStart } from './week'
import { derivePass } from './metrics'
import { and, asc, eq, inArray } from 'drizzle-orm'

/**
 * Issues domain module (ticket 16): the team's long-term (quarter) and
 * short-term (week) Issues Lists. Issues are team property — everyone signed
 * in views everything, and any signed-in user adds/edits/resolves (decided
 * access model: "team list only", issues are not personal). Status is
 * DERIVED: open until an issue_resolutions row exists; the resolution row is
 * write-once and immutable (UNIQUE(issue_id)). Issues are never deleted —
 * solved items are kept forever (decided). Origin provenance columns exist
 * but only 'manual' is written here; from_rock/from_scorecard/from_todo/
 * from_meeting activate in ticket 20.
 *
 * added_by/added_at are implemented as created_by→users + the base
 * created_at (naming delta vs data-model.md's sketch, same decision as
 * todos' created_by: the login account acts, linked or not).
 *
 * List queries avoid joining people twice (the node:sqlite proxy collapses
 * duplicate output column names — see src/server/db.ts): names are fetched
 * with one batched IN query per role and merged in JS.
 */

export type IssueClassification = 'long_term' | 'short_term'
export type IssueOutcome = 'solved' | 'dropped'

export type IssueInput = {
  title: string
  classification: IssueClassification
  /** Long-term only; defaults to the current quarter when omitted. */
  quarterId?: number | null
}

export type IssueError =
  | 'unauthenticated'
  | 'title_required'
  | 'classification_required'
  | 'quarter_required'
  | 'quarter_not_allowed'
  | 'quarter_not_found'
  | 'note_required'
  | 'not_found'
  | 'already_resolved'
  | 'not_red'
  | 'todo_not_missed'
  | 'quarter_not_ended'
  | 'quarter_read_only'
  | 'forbidden'

export type IssueResult<T> = { ok: true; value: T } | { ok: false; error: IssueError }

/** A list row: the issue plus derived status, resolution info, and age. */
export type IssueView = {
  id: number
  title: string
  classification: IssueClassification
  quarterId: number | null
  origin: string
  /** 'open' until a resolution row exists, then that row's outcome. */
  status: 'open' | 'solved' | 'dropped'
  /** Whole weeks since the week the issue was added (derived, never stored). */
  ageWeeks: number
  createdAt: string
  addedByName: string | null
  resolution: {
    outcome: IssueOutcome
    note: string
    resolvedAt: string
    resolvedByName: string | null
  } | null
}

/**
 * Age in whole weeks, week-aligned: how many Monday boundaries have passed
 * since the week the issue was added (same derived-week discipline as the
 * rest of the app). Pure and pinned in tests.
 */
export function ageWeeksSince(addedDate: string, asOf: string): number {
  const addedMonday = parseDate(weekStart(addedDate)).getTime()
  const asOfMonday = parseDate(weekStart(asOf)).getTime()
  return Math.floor((asOfMonday - addedMonday) / (7 * 24 * 60 * 60 * 1000))
}

function issueDate(createdAt: string): string {
  return createdAt.slice(0, 10)
}

/**
 * Long-term issues default to the current quarter when quarterId is omitted
 * (the long-term list is quarter-scoped; an explicit id must exist).
 * Short-term issues must NOT carry a quarter — their context is the derived
 * week, and their carry-forward is aging, not quarter mechanics.
 */
async function resolveQuarterId(
  db: Db,
  input: { classification: IssueClassification; quarterId?: number | null },
): Promise<{ ok: true; quarterId: number | null } | { ok: false; error: IssueError }> {
  if (input.classification === 'short_term') {
    if (input.quarterId != null) return { ok: false, error: 'quarter_not_allowed' }
    return { ok: true, quarterId: null }
  }
  if (input.quarterId != null) {
    const quarter = await db
      .select({ id: quarters.id })
      .from(quarters)
      .where(eq(quarters.id, input.quarterId))
      .get()
    if (!quarter) return { ok: false, error: 'quarter_not_found' }
    return { ok: true, quarterId: input.quarterId }
  }
  const current = await getCurrentQuarter(db)
  if (!current) return { ok: false, error: 'quarter_required' }
  return { ok: true, quarterId: current.id }
}

export async function addIssue(
  db: Db,
  token: string | undefined,
  input: IssueInput,
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const title = input.title?.trim() ?? ''
  if (!title) return { ok: false, error: 'title_required' }
  if (input.classification !== 'long_term' && input.classification !== 'short_term') {
    return { ok: false, error: 'classification_required' }
  }
  const quarter = await resolveQuarterId(db, input)
  if (!quarter.ok) return quarter
  const [issue] = await db
    .insert(issues)
    .values({
      title,
      classification: input.classification,
      quarterId: quarter.quarterId,
      origin: 'manual',
      createdBy: auth.user.id,
      sortOrder: 0,
    })
    .returning()
  return { ok: true, value: issue! }
}

/**
 * Edit title and/or classification (any signed-in user — team property).
 * Switching classification re-resolves the quarter by the same rules as
 * addIssue (long_term defaults to current; short_term clears it); keeping
 * the same classification keeps the existing quarter. Editing a resolved
 * issue is rejected — the record is settled (archive, not worklist).
 */
export async function updateIssue(
  db: Db,
  token: string | undefined,
  issueId: number,
  input: Partial<IssueInput>,
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const existing = await db.select().from(issues).where(eq(issues.id, issueId)).get()
  if (!existing) return { ok: false, error: 'not_found' }
  const resolved = await db
    .select({ id: issueResolutions.id })
    .from(issueResolutions)
    .where(eq(issueResolutions.issueId, issueId))
    .get()
  if (resolved) return { ok: false, error: 'already_resolved' }
  const classification = input.classification ?? existing.classification
  if (classification !== 'long_term' && classification !== 'short_term') {
    return { ok: false, error: 'classification_required' }
  }
  const title = input.title?.trim() ?? existing.title
  if (!title) return { ok: false, error: 'title_required' }
  const sameClassification = classification === existing.classification
  const quarter = await resolveQuarterId(db, {
    classification,
    quarterId:
      input.quarterId !== undefined
        ? input.quarterId
        : sameClassification
          ? existing.quarterId
          : null,
  })
  if (!quarter.ok) return quarter
  const [updated] = await db
    .update(issues)
    .set({
      title,
      classification,
      quarterId: quarter.quarterId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(issues.id, issueId))
    .returning()
  return { ok: true, value: updated! }
}

export type IssueResolutionView = {
  id: number
  issueId: number
  meetingId: number | null
  outcome: IssueOutcome
  note: string
  resolvedBy: number
  resolvedAt: string
  createdAt: string
  resolvedByName: string | null
}

/**
 * Write-once resolution: solved (decision note) or dropped (reason). Both
 * require a non-empty note — a solved issue without a captured decision and
 * a dropped issue without a reason both defeat the "kept forever" archive.
 * `input.meetingId` (ticket 24): set when the issue was solved in an L10's
 * solve — the resolution row then references that meeting (data-model:
 * "resolution rows reference the solving meeting").
 */
export async function resolveIssue(
  db: Db,
  token: string | undefined,
  issueId: number,
  input: { outcome: IssueOutcome; note: string; meetingId?: number },
): Promise<IssueResult<IssueResolutionView>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const issue = await db.select().from(issues).where(eq(issues.id, issueId)).get()
  if (!issue) return { ok: false, error: 'not_found' }
  const existing = await db
    .select({ id: issueResolutions.id })
    .from(issueResolutions)
    .where(eq(issueResolutions.issueId, issueId))
    .get()
  if (existing) return { ok: false, error: 'already_resolved' }
  if (input.outcome !== 'solved' && input.outcome !== 'dropped') {
    return { ok: false, error: 'note_required' }
  }
  const note = input.note?.trim() ?? ''
  if (!note) return { ok: false, error: 'note_required' }
  const [resolution] = await db
    .insert(issueResolutions)
    .values({
      issueId,
      outcome: input.outcome,
      note,
      meetingId: input.meetingId ?? null,
      resolvedBy: auth.user.id,
      resolvedAt: new Date().toISOString(),
    })
    .returning()
  return {
    ok: true,
    value: {
      ...resolution!,
      outcome: resolution!.outcome as IssueOutcome,
      resolvedByName: await userName(db, resolution!.resolvedBy),
    },
  }
}

/**
 * Display name for a user id: people.full_name when the account is linked,
 * null otherwise (unlinked accounts like the seeded owner act without one).
 */
async function userName(db: Db, userId: number): Promise<string | null> {
  const user = await db
    .select({ personId: users.personId })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!user?.personId) return null
  const person = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, user.personId))
    .get()
  return person?.fullName ?? null
}

export type ListIssuesInput = {
  classification?: IssueClassification
  includeResolved?: boolean
}

/**
 * The team list: unresolved first, then by sort_order, created_at, id
 * (deterministic; v1 sort_order is always 0 so creation order rules).
 * Resolved rows appear only when includeResolved is set (default keeps the
 * worklist clean; solved items live forever and stay reachable).
 */
export async function listIssues(
  db: Db,
  token: string | undefined,
  input: ListIssuesInput = {},
): Promise<IssueResult<IssueView[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const where = input.classification ? eq(issues.classification, input.classification) : undefined
  const issueRows = await db
    .select()
    .from(issues)
    .where(where)
    .orderBy(asc(issues.sortOrder), asc(issues.createdAt), asc(issues.id))
  if (issueRows.length === 0) return { ok: true, value: [] }

  const resolutionRows = await db
    .select()
    .from(issueResolutions)
    .where(
      inArray(
        issueResolutions.issueId,
        issueRows.map((i) => i.id),
      ),
    )
  const byIssue = new Map(resolutionRows.map((r) => [r.issueId, r]))

  // Display names for adders and resolvers: users.person_id → people names,
  // batched (two IN queries merged in JS — avoids the double-people-join
  // column-collapse hazard entirely; see src/server/db.ts).
  const userIds = new Set<number>()
  for (const i of issueRows) userIds.add(i.createdBy)
  for (const r of resolutionRows) userIds.add(r.resolvedBy)
  const userRows =
    userIds.size > 0
      ? await db
          .select({ id: users.id, personId: users.personId })
          .from(users)
          .where(inArray(users.id, Array.from(userIds)))
      : []
  const personIds = userRows
    .map((u) => u.personId)
    .filter((id): id is number => id != null)
  const personRows =
    personIds.length > 0
      ? await db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          .where(inArray(people.id, personIds))
      : []
  const nameByUser = new Map(
    userRows.map((u) => {
      const person = u.personId != null ? personRows.find((p) => p.id === u.personId) : undefined
      return [u.id, person?.fullName ?? null]
    }),
  )

  const today = todayIso()
  const views: Array<IssueView & { resolved: boolean }> = issueRows.map((issue) => {
    const resolution = byIssue.get(issue.id)
    return {
      id: issue.id,
      title: issue.title,
      classification: issue.classification as IssueClassification,
      quarterId: issue.quarterId,
      origin: issue.origin,
      status: resolution ? (resolution.outcome as 'solved' | 'dropped') : 'open',
      ageWeeks: ageWeeksSince(issueDate(issue.createdAt), today),
      createdAt: issue.createdAt,
      addedByName: nameByUser.get(issue.createdBy) ?? null,
      resolution: resolution
        ? {
            outcome: resolution.outcome as IssueOutcome,
            note: resolution.note,
            resolvedAt: resolution.resolvedAt,
            resolvedByName: nameByUser.get(resolution.resolvedBy) ?? null,
          }
        : null,
      resolved: !!resolution,
    }
  })

  const filtered = input.includeResolved ? views : views.filter((v) => !v.resolved)
  // Unresolved first; the base query already ordered by sort_order →
  // created_at → id and Array.prototype.sort is stable, so the within-group
  // order is preserved.
  const result = filtered.sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1))
  return { ok: true, value: result }
}
// ================= Ticket 20: provenance + quarter-end carry =================

/**
 * Internal origin-setting creator (public addIssue keeps origin='manual').
 * Origin issues are always long_term and land in the CURRENT quarter — the
 * list where the meeting works — regardless of the source row's own quarter (a rock
 * or entry from any quarter can be pushed; decided ticket 20, documented).
 * Duplicates are ALLOWED: the room may push the same red cell twice and
 * the team decides in the room (the L10's meeting_issues UNIQUE handles
 * in-meeting dedup at ticket 23). Any signed-in user — issues are team
 * property.
 */
async function createIssueWithOrigin(
  db: Db,
  token: string | undefined,
  input: {
    origin: 'from_rock' | 'from_scorecard' | 'from_todo'
    originSourceId: number
    title: string
  },
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const quarter = await resolveQuarterId(db, { classification: 'long_term' })
  if (!quarter.ok) return quarter
  const [issue] = await db
    .insert(issues)
    .values({
      title: input.title,
      classification: 'long_term',
      quarterId: quarter.quarterId,
      origin: input.origin,
      originSourceId: input.originSourceId,
      createdBy: auth.user.id,
      sortOrder: 0,
    })
    .returning()
  return { ok: true, value: issue! }
}

/**
 * Push an off-track rock onto the long-term list. Any signed-in user; the
 * rock must exist (its own status doesn't matter here — the room decides
 * what's worth an issue; the L10's Rocks segment only offers the button on
 * off-track/measuring rows). Title derives from the rock statement.
 */
export async function issueFromRock(
  db: Db,
  token: string | undefined,
  rockId: number,
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rock = await db.select().from(rocks).where(eq(rocks.id, rockId)).get()
  if (!rock) return { ok: false, error: 'not_found' }
  return createIssueWithOrigin(db, token, {
    origin: 'from_rock',
    originSourceId: rock.id,
    title: `Goal off track: ${rock.statement}`,
  })
}

/**
 * Push a red scorecard cell onto the long-term list. Red is verified with
 * the metric's CURRENT direction against the entry's stored actual and
 * target_at_entry (the same derivation the grid renders — metrics.derivePass,
 * now exported). A green cell is rejected ('not_red'): pushing a passing
 * number as an issue is a mistake, not a workflow.
 */
export async function issueFromScorecardEntry(
  db: Db,
  token: string | undefined,
  entryId: number,
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const entry = await db.select().from(metricEntries).where(eq(metricEntries.id, entryId)).get()
  if (!entry) return { ok: false, error: 'not_found' }
  const metric = await db.select().from(metrics).where(eq(metrics.id, entry.metricId)).get()
  if (!metric) return { ok: false, error: 'not_found' }
  const pass = derivePass(
    metric.direction as 'gte' | 'lte',
    entry.actual,
    entry.targetAtEntry,
  )
  if (pass) return { ok: false, error: 'not_red' }
  return createIssueWithOrigin(db, token, {
    origin: 'from_scorecard',
    originSourceId: entry.id,
    title: `Red metric: ${metric.name} — ${formatWeekLabel(entry.week)}: ${entry.actual} vs target ${entry.targetAtEntry}`,
  })
}

/**
 * Push a missed to-do onto the long-term list. A completed to-do is NOT a
 * miss ('todo_not_missed'); open (past due or not) and dropped to-dos are
 * pushable — the room decides.
 */
export async function issueFromTodo(
  db: Db,
  token: string | undefined,
  todoId: number,
): Promise<IssueResult<Issue>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const todo = await db.select().from(todos).where(eq(todos.id, todoId)).get()
  if (!todo) return { ok: false, error: 'not_found' }
  if (todo.status === 'done') return { ok: false, error: 'todo_not_missed' }
  return createIssueWithOrigin(db, token, {
    origin: 'from_todo',
    originSourceId: todo.id,
    title: `Missed to-do: ${todo.title}`,
  })
}

/** An issue is unresolved when no write-once resolution row exists. */
/**
 * Which of `ids` have no write-once resolution row (exported for ticket 23's
 * meeting-queue push guard — pushing a resolved issue is a mistake).
 */
export async function unresolvedIssueIds(db: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ issueId: issueResolutions.issueId })
    .from(issueResolutions)
    .where(inArray(issueResolutions.issueId, ids))
  const resolved = new Set(rows.map((r) => r.issueId))
  return new Set(ids.filter((id) => !resolved.has(id)))
}

async function quarterById(db: Db, id: number) {
  return db.select().from(quarters).where(eq(quarters.id, id)).get()
}

/**
 * The carry-or-drop prompt's payload: unresolved long-term issues currently
 * sitting in an ended quarter. Signed-in readable (the list is team
 * property); the carry/drop ACTIONS are admin-gated below.
 */
export async function listUnresolvedForCarry(
  db: Db,
  token: string | undefined,
  fromQuarterId: number,
): Promise<IssueResult<Issue[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.classification, 'long_term'), eq(issues.quarterId, fromQuarterId)))
    .orderBy(asc(issues.createdAt), asc(issues.id))
  const unresolved = await unresolvedIssueIds(db, rows.map((r) => r.id))
  return { ok: true, value: rows.filter((r) => unresolved.has(r.id)) }
}

/**
 * Carry ONE unresolved long-term issue into another quarter (the lean
 * keep-row decision: same row, quarter_id updated — nothing is copied or
 * closed). Admin-gated. The issue's CURRENT quarter must be ENDED (strict
 * `<` on end_date, the single app-wide freeze boundary — a quarter ending
 * today is not yet carryable); the target quarter must exist and must NOT
 * be ended (carrying into history would hide the issue). Short-term issues
 * age in place and are never carried.
 */
export async function carryLongTermIssue(
  db: Db,
  token: string | undefined,
  issueId: number,
  toQuarterId: number,
): Promise<IssueResult<Issue>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const issue = await db.select().from(issues).where(eq(issues.id, issueId)).get()
  if (!issue || issue.classification !== 'long_term' || issue.quarterId == null) {
    return { ok: false, error: 'not_found' }
  }
  const toQuarter = await quarterById(db, toQuarterId)
  if (!toQuarter) return { ok: false, error: 'quarter_not_found' }
  const fromQuarter = await quarterById(db, issue.quarterId)
  if (!fromQuarter) return { ok: false, error: 'quarter_not_found' }
  if (fromQuarter.endDate >= todayIso()) return { ok: false, error: 'quarter_not_ended' }
  if (toQuarter.endDate < todayIso()) return { ok: false, error: 'quarter_read_only' }
  const unresolved = await unresolvedIssueIds(db, [issue.id])
  if (!unresolved.has(issue.id)) return { ok: false, error: 'already_resolved' }
  const [updated] = await db
    .update(issues)
    .set({ quarterId: toQuarterId, updatedAt: new Date().toISOString() })
    .where(eq(issues.id, issueId))
    .returning()
  return { ok: true, value: updated! }
}

/**
 * Bulk carry: every unresolved long-term issue in an ENDED from-quarter
 * moves to the target quarter (keep-row). Returns the count for the UI's
 * "Carry all" toast; resolved issues are untouched (they are history).
 * Admin-gated; same boundary rules as carryLongTermIssue.
 */
export async function carryUnresolvedLongTermIssues(
  db: Db,
  token: string | undefined,
  fromQuarterId: number,
  toQuarterId: number,
): Promise<IssueResult<{ carried: number }>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const fromQuarter = await quarterById(db, fromQuarterId)
  if (!fromQuarter) return { ok: false, error: 'quarter_not_found' }
  if (fromQuarter.endDate >= todayIso()) return { ok: false, error: 'quarter_not_ended' }
  const toQuarter = await quarterById(db, toQuarterId)
  if (!toQuarter) return { ok: false, error: 'quarter_not_found' }
  if (toQuarter.endDate < todayIso()) return { ok: false, error: 'quarter_read_only' }
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.classification, 'long_term'), eq(issues.quarterId, fromQuarterId)))
  const unresolved = await unresolvedIssueIds(db, rows.map((r) => r.id))
  const toCarry = rows.filter((r) => unresolved.has(r.id))
  const now = new Date().toISOString()
  for (const issue of toCarry) {
    await db
      .update(issues)
      .set({ quarterId: toQuarterId, updatedAt: now })
      .where(eq(issues.id, issue.id))
  }
  return { ok: true, value: { carried: toCarry.length } }
}
